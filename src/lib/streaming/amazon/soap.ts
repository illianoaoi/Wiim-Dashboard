import "server-only";
import http from "node:http";
import { resolveTarget, pinnedLookup, WiimError } from "@/lib/wiim/client";

/**
 * Minimal UPnP control-point for the WiiM device's "PlayQueue" service
 * (urn:schemas-wiimu-com:service:PlayQueue:1) — a WiiM/LinkPlay-proprietary
 * extension used to drive Amazon Music (and possibly other cloud services)
 * playback via CreateQueue, distinct from the standard AVTransport service.
 *
 * Mirrors src/lib/dlna/avtransport.ts closely: plain HTTP, no mTLS, the
 * connection resolved + pinned via the shared WiiM transport helpers.
 *
 * NOTE: PlayQueue lives on port 59152, NOT 49152 (AVTransport's port) — but
 * we still resolve its control URL from the device's UPnP description
 * wherever possible rather than hard-coding a control path.
 */

const PLAYQUEUE_PORT = 59152;
const PLAYQUEUE_SERVICE = "urn:schemas-wiimu-com:service:PlayQueue:1";

export function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const ctrlCache = new Map<string, string>(); // deviceHost -> PlayQueue control URL

async function request(
  host: string,
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<{ status: number; text: string }> {
  const target = await resolveTarget(host);
  if (!target.isPrivate) {
    throw new WiimError(`Refusing non-LAN device target: ${host} (${target.ip})`, "FORBIDDEN_HOST");
  }
  const bodyBuf = opts.body != null ? Buffer.from(opts.body, "utf8") : undefined;
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    const reqOpts: http.RequestOptions = {
      host,
      port,
      path,
      method: opts.method ?? "GET",
      signal: controller.signal,
      headers: { ...opts.headers, ...(bodyBuf ? { "Content-Length": String(bodyBuf.length) } : {}) },
    };
    if (!target.isLiteral) reqOpts.lookup = pinnedLookup(target.ip, target.family);
    const req = http.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const code = err.name === "AbortError" ? "TIMEOUT" : err.code || "NETWORK";
      reject(new WiimError(`PlayQueue request to ${host} failed: ${err.message}`, code));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

/** Try one description.xml port, returning the PlayQueue controlURL if present. */
async function findControlUrl(host: string, descPort: number): Promise<string | null> {
  const desc = await request(host, descPort, "/description.xml", { method: "GET" });
  if (desc.status >= 400) return null;
  for (const svc of desc.text.match(/<service\b[\s\S]*?<\/service>/gi) ?? []) {
    const serviceType = /<serviceType>([\s\S]*?)<\/serviceType>/i.exec(svc)?.[1] ?? "";
    const serviceId = /<serviceId>([\s\S]*?)<\/serviceId>/i.exec(svc)?.[1] ?? "";
    if (/PlayQueue/i.test(serviceType) || /PlayQueue/i.test(serviceId)) {
      const c = /<controlURL>([\s\S]*?)<\/controlURL>/i.exec(svc)?.[1]?.trim();
      if (c) return new URL(c, `http://${host}:${descPort}/`).toString();
    }
  }
  return null;
}

/** Resolve (and cache) the device's PlayQueue control URL from its UPnP description. */
export async function getPlayQueueControl(host: string): Promise<string> {
  const cached = ctrlCache.get(host);
  if (cached) return cached;

  // PlayQueue's own port first, then fall back to the AVTransport port in
  // case a given firmware serves one combined description.xml.
  for (const port of [PLAYQUEUE_PORT, 49152]) {
    try {
      const found = await findControlUrl(host, port);
      if (found) {
        ctrlCache.set(host, found);
        return found;
      }
    } catch {
      /* try the next port */
    }
  }

  // Last resort: the conventional control path, unconfirmed against a real
  // description.xml (needs device validation).
  const fallback = `http://${host}:${PLAYQUEUE_PORT}/upnp/control/PlayQueue1`;
  ctrlCache.set(host, fallback);
  return fallback;
}

/** POST one PlayQueue SOAP action and return the raw response body. */
export async function playQueueSoap(host: string, action: string, innerXml: string): Promise<string> {
  const ctrl = await getPlayQueueControl(host);
  const path = new URL(ctrl).pathname;
  const env =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${PLAYQUEUE_SERVICE}">${innerXml}</u:${action}></s:Body></s:Envelope>`;
  const res = await request(host, PLAYQUEUE_PORT, path, {
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPACTION: `"${PLAYQUEUE_SERVICE}#${action}"`,
    },
    body: env,
  });
  if (res.status >= 400) {
    throw new WiimError(`PlayQueue ${action} returned HTTP ${res.status}`, "PLAYQUEUE");
  }
  return res.text;
}
