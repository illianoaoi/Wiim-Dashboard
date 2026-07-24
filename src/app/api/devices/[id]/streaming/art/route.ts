import { NextResponse } from "next/server";
import { guard, apiError } from "@/lib/api";
import { resolveDevice } from "@/lib/device-route";
import { wiimFetchRaw } from "@/lib/wiim/client";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Public Amazon art hosts only — this proxy exists so the browser never talks
// to Amazon directly, not to become an open proxy for arbitrary URLs.
const ALLOWED_SUFFIXES = [
  "media-amazon.com",
  "images-amazon.com",
  "ssl-images-amazon.com",
  "amazon.com",
];

function isAllowedArtHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return ALLOWED_SUFFIXES.some((suf) => h === suf || h.endsWith(`.${suf}`));
}

/** Stream Amazon Music cover art through the server so the browser never hits
 *  Amazon directly. The target URL is allowlisted to known Amazon art hosts. */
export async function GET(req: Request, { params }: Params) {
  const g = await guard(req);
  if (g instanceof NextResponse) return g;
  const r = resolveDevice((await params).id);
  if ("res" in r) return r.res;

  const u = new URL(req.url).searchParams.get("u");
  if (!u) return apiError(400, "Missing url", "BAD_URL");

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return apiError(400, "Missing url", "BAD_URL");
  }
  if (!isAllowedArtHost(target.hostname)) {
    return apiError(400, "Forbidden art host", "FORBIDDEN_HOST");
  }

  try {
    const { status, body, contentType } = await wiimFetchRaw(u, { deviceHost: r.device.host });
    if (status >= 400) return apiError(502, "Art fetch failed", "ART");
    return new Response(new Uint8Array(body), {
      headers: { "content-type": contentType, "cache-control": "public, max-age=86400" },
    });
  } catch {
    return apiError(502, "Art fetch failed", "ART");
  }
}
