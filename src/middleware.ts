import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "wiim_session";
const PUBLIC_PATHS = ["/login", "/setup"];

/** Generate a base64 CSP nonce using Web Crypto (edge-runtime safe). */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Parse a boolean env var exactly like `src/lib/config.ts` does. */
function envBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/**
 * Did THIS request arrive over https?
 *
 * HSTS and CSP `upgrade-insecure-requests` may only be sent on an https
 * response. Sent over plain http they tell the browser to re-fetch every
 * subresource over TLS from a port that speaks none — a white page, or
 * `SSL_ERROR_RX_RECORD_TOO_LONG` in Firefox.
 *
 * Deriving this from the request itself (rather than from the COOKIE_SECURE env
 * string, which only counted the exact text "false" as http) removes a footgun:
 * `COOKIE_SECURE=0`, `=no` or `=False` silently re-enabled both headers on a
 * plain-http deployment. See issue #12.
 */
function isHttpsRequest(req: NextRequest): boolean {
  // Behind a trusted reverse proxy the edge scheme only shows up in the header.
  if (envBool(process.env.TRUST_PROXY, true)) {
    const fwd = req.headers.get("x-forwarded-proto");
    if (fwd) return fwd.split(",")[0]!.trim().toLowerCase() === "https";
  }
  return req.nextUrl.protocol === "https:";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV !== "production";
  const httpsMode = isHttpsRequest(request);
  const nonce = makeNonce();

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: ${isDev ? "'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://challenges.cloudflare.com ${isDev ? "ws:" : ""}`,
    `frame-src https://challenges.cloudflare.com`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    ...(httpsMode ? ["upgrade-insecure-requests"] : []),
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  // ---- page auth gate (cookie presence only; real check is server-side) ----
  const isApi = pathname.startsWith("/api");
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (!isApi && !isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return applySecurity(NextResponse.redirect(url), csp, httpsMode);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurity(response, csp, httpsMode);
}

function applySecurity(res: NextResponse, csp: string, httpsMode: boolean): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  // HSTS only makes sense (and is only honoured) over https.
  if (httpsMode) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return res;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt).*)",
  ],
};
