import "server-only";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { readFileSync } from "node:fs";
import { config } from "@/lib/config";
import { LINKPLAY_CLIENT_CERT, LINKPLAY_CLIENT_KEY } from "./linkplay-cert";
import { HTTPAPI_PATH } from "./constants";

/**
 * Low-level transport to a WiiM/LinkPlay device on the LAN.
 *
 * - HTTPS on port 443 with a self-signed cert → verification disabled.
 * - Presents the shared LinkPlay client cert (mTLS) for newer firmware.
 * - SSRF-hardened: hostnames are resolved to an IP, the IP is checked against
 *   private ranges, and the connection is PINNED to that resolved IP (so DNS
 *   can't rebind to a different target between the check and the connect).
 * - The device is NEVER exposed publicly; only this server talks to it.
 */

export class WiimError extends Error {
  code: string;
  constructor(message: string, code = "WIIM_ERROR") {
    super(message);
    this.name = "WiimError";
    this.code = code;
  }
}

let deviceAgent: https.Agent | null = null;

/** TLS agent for the device: verification disabled + LinkPlay client cert. */
function getDeviceAgent(): https.Agent {
  if (deviceAgent) return deviceAgent;
  let cert: string = LINKPLAY_CLIENT_CERT;
  let key: string = LINKPLAY_CLIENT_KEY;
  if (config.wiimClientCertPath && config.wiimClientKeyPath) {
    try {
      cert = readFileSync(config.wiimClientCertPath, "utf8");
      key = readFileSync(config.wiimClientKeyPath, "utf8");
    } catch (e) {
      console.error("[wiim] failed reading WIIM_CLIENT_CERT/KEY, using embedded cert:", e);
    }
  }
  deviceAgent = new https.Agent({
    rejectUnauthorized: false, // device uses a self-signed cert on the trusted LAN
    cert,
    key,
    keepAlive: true,
    maxSockets: 8,
    timeout: 10_000,
  });
  return deviceAgent;
}

/** True for loopback / RFC1918 / link-local / ULA addresses. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    const mapped = l.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    if (/^fe[89ab]/.test(l)) return true; // link-local
    if (/^f[cd]/.test(l)) return true; // unique-local
    return false;
  }
  return false;
}

/** String-level acceptance used when ADDING a device (hostnames allowed). The
 *  authoritative SSRF enforcement happens at request time after DNS resolution. */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return false;
  if (net.isIP(h)) return isPrivateIp(h);
  if (!h.includes(".")) return true; // single-label LAN name
  return /\.(local|lan|home|internal)$/.test(h);
}

export function assertAllowedHost(host: string): void {
  if (!isPrivateHost(host)) {
    throw new WiimError(`Refusing to contact non-LAN host: ${host}`, "FORBIDDEN_HOST");
  }
}

export interface ResolvedTarget {
  ip: string;
  family: 4 | 6;
  isLiteral: boolean;
  isPrivate: boolean;
}

/** Resolve a host to a concrete IP we can pin the connection to. */
export async function resolveTarget(host: string): Promise<ResolvedTarget> {
  const literalFamily = net.isIP(host);
  if (literalFamily) {
    return { ip: host, family: literalFamily as 4 | 6, isLiteral: true, isPrivate: isPrivateIp(host) };
  }
  let res;
  try {
    res = await dns.lookup(host, { all: true });
  } catch {
    throw new WiimError(`Cannot resolve host: ${host}`, "DNS");
  }
  const first = res[0];
  if (!first) throw new WiimError(`Cannot resolve host: ${host}`, "DNS");
  return {
    ip: first.address,
    family: first.family as 4 | 6,
    isLiteral: false,
    // every resolved address must be private for the host to count as private
    isPrivate: res.every((r) => isPrivateIp(r.address)),
  };
}

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Custom lookup that pins every connection attempt to one validated IP. */
export function pinnedLookup(ip: string, family: 4 | 6) {
  return (_hostname: string, options: unknown, callback?: LookupCb): void => {
    const cb = (typeof options === "function" ? options : callback) as LookupCb;
    const opts = typeof options === "object" && options ? (options as { all?: boolean }) : null;
    if (opts?.all) return cb(null, [{ address: ip, family }]);
    return cb(null, ip, family);
  };
}

function encodeCommand(command: string): string {
  return command
    .replace(/ /g, "%20")
    .replace(/#/g, "%23")
    .replace(/&/g, "%26")
    .replace(/\?/g, "%3F");
}

export interface WiimResponse {
  status: number;
  text: string;
}

/**
 * Per-device request gate. The embedded LinkPlay box drops or garbles requests
 * when hit with too many at once — one snapshot poll fans out ~9 reads in
 * parallel — so we cap concurrent in-flight httpapi calls PER DEVICE. Tune with
 * WIIM_DEVICE_CONCURRENCY (default 4; set 1–2 for older / flaky devices).
 */
const MAX_DEVICE_CONCURRENCY = Math.max(1, Number(process.env.WIIM_DEVICE_CONCURRENCY) || 4);

class DeviceGate {
  private active = 0;
  private waiters: Array<() => void> = [];

  acquire(): Promise<() => void> {
    return new Promise<() => void>((grant) => {
      let released = false;
      const release = () => {
        if (released) return; // idempotent — safe to call once per acquire
        released = true;
        this.active--;
        this.pump();
      };
      this.waiters.push(() => grant(release));
      this.pump();
    });
  }

  // Grant slots to queued waiters while under the cap. active is incremented
  // synchronously before each grant, so the cap can never be exceeded.
  private pump(): void {
    while (this.active < MAX_DEVICE_CONCURRENCY && this.waiters.length > 0) {
      this.active++;
      this.waiters.shift()!();
    }
  }
}

const deviceGates = new Map<string, DeviceGate>();
function deviceGate(host: string): DeviceGate {
  const key = host.trim().toLowerCase();
  let gate = deviceGates.get(key);
  if (!gate) {
    gate = new DeviceGate();
    deviceGates.set(key, gate);
  }
  return gate;
}

/** Send one httpapi.asp command. Host is resolved, IP-checked (must be LAN), and pinned. */
export async function wiimRequest(
  host: string,
  command: string,
  opts: { timeoutMs?: number; port?: number } = {},
): Promise<WiimResponse> {
  const target = await resolveTarget(host);
  if (!target.isPrivate) {
    throw new WiimError(`Refusing non-LAN device target: ${host} (${target.ip})`, "FORBIDDEN_HOST");
  }
  const timeoutMs = opts.timeoutMs ?? 8000;
  const port = opts.port ?? 443;
  const path = `${HTTPAPI_PATH}?command=${encodeCommand(command)}`;

  // Hold a per-device slot for the lifetime of this request (released on
  // success, error, OR timeout via .finally below).
  const release = await deviceGate(host).acquire();
  const p = new Promise<WiimResponse>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const reqOpts: https.RequestOptions = {
      host,
      port,
      path,
      method: "GET",
      agent: getDeviceAgent(),
      servername: "www.linkplay.com",
      signal: controller.signal,
      headers: { "User-Agent": "wiim-dashboard" },
    };
    if (!target.isLiteral) reqOpts.lookup = pinnedLookup(target.ip, target.family);

    const req = https.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 5_000_000) {
          controller.abort();
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
      });
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const code = err.name === "AbortError" ? "TIMEOUT" : err.code || "NETWORK";
      reject(new WiimError(`Request to ${host} failed: ${err.message}`, code));
    });
    req.end();
  });

  // Release the device slot once the request settles (resolve/reject/timeout).
  return p.finally(release);
}

/** Detect an image MIME type from the leading magic bytes (some sources — e.g.
 *  WiiM's cloud CDN — mislabel images as application/octet-stream). */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return null;
}

/**
 * Fetch album art. SSRF policy:
 *  - A PRIVATE/LAN target is only allowed if it is the device's own host
 *    (its art server) — blocks pivoting to other internal hosts / metadata.
 *  - A PUBLIC target (streaming-service cover art) is allowed with normal TLS
 *    verification. Either way the connection is pinned to the validated IP.
 */
export async function wiimFetchRaw(
  url: string,
  opts: { deviceHost: string; timeoutMs?: number },
): Promise<{ status: number; body: Buffer; contentType: string }> {
  const u = new URL(url);
  const target = await resolveTarget(u.hostname);

  if (target.isPrivate) {
    if (u.hostname.toLowerCase() !== opts.deviceHost.trim().toLowerCase()) {
      throw new WiimError(`Refusing internal art host: ${u.hostname}`, "FORBIDDEN_HOST");
    }
  }

  const timeoutMs = opts.timeoutMs ?? 8000;
  const isHttp = u.protocol === "http:";
  const lib = isHttp ? http : https;

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const reqOpts: https.RequestOptions = {
      host: u.hostname,
      port: u.port || (isHttp ? 80 : 443),
      path: u.pathname + u.search,
      method: "GET",
      signal: controller.signal,
    };
    // The device's own https art is self-signed → device agent. Public https
    // cover art uses the default agent with full certificate verification.
    if (!isHttp) reqOpts.agent = target.isPrivate ? getDeviceAgent() : undefined;
    if (!target.isLiteral) reqOpts.lookup = pinnedLookup(target.ip, target.family);

    const req = lib.request(reqOpts, (res: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 10_000_000) {
          controller.abort();
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        clearTimeout(timer);
        const body = Buffer.concat(chunks);
        let contentType = (res.headers["content-type"] as string) || "";
        // Correct mislabeled images (octet-stream / missing type) by sniffing
        // the bytes, so cloud-CDN artwork isn't dropped by the image/* check.
        if (!contentType.startsWith("image/")) {
          contentType = sniffImageType(body) ?? (contentType || "image/jpeg");
        }
        resolve({ status: res.statusCode ?? 0, body, contentType });
      });
    });
    req.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new WiimError(`Asset fetch failed: ${err.message}`));
    });
    req.end();
  });
}
