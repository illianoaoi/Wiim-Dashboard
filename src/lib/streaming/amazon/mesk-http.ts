import "server-only";
import https from "node:https";
import { gunzipSync } from "node:zlib";
import { resolveTarget, pinnedLookup } from "@/lib/wiim/client";
import { StreamingError } from "../types";
import { WEB_USER_AGENT } from "./web-headers";
import { withRetry } from "./retry";

/**
 * Transport for Amazon Music's public web-player "mesk" skill host
 * (na.mesk.skill.music.a2z.com) — the sibling of na.web.skill.music.a2z.com
 * used by the paginated per-category search endpoints (searchCatalogAlbums,
 * searchCatalogTracks, searchCommunityPlaylists, …) and the library-playlist
 * detail endpoint (showLibraryPlaylist).
 *
 * Like the other Amazon transports this host is PUBLIC (not on the LAN):
 * normal TLS verification applies. We resolve + pin the IP (reusing the WiiM
 * client's resolveTarget/pinnedLookup) so a DNS answer can't change between
 * resolve and connect, but there is no private-IP check.
 *
 * Host allowlist: this module may ONLY ever contact AMAZON_MESK_HOST. Callers
 * supply a request PATH (endpoint + query, e.g. "/api/searchCatalogAlbums?…")
 * and a body — never a host. The path must be root-relative; anything with a
 * scheme/host is rejected so a caller can't redirect this off-allowlist.
 */

export const AMAZON_MESK_HOST = "na.mesk.skill.music.a2z.com";

/** GZIP magic bytes (RFC 1952) — a gzip body always starts with these. */
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

export interface MeskResponse {
  status: number;
  text: string;
}

export async function meskFetch(
  path: string,
  body: string,
  opts?: { timeoutMs?: number },
): Promise<MeskResponse> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new StreamingError("mesk path must be root-relative", "NETWORK");
  }
  const target = await resolveTarget(AMAZON_MESK_HOST);
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const bodyBuf = Buffer.from(body, "utf8");

  // Retry transient 5xx / connection failures (the mesk skill host 500s
  // intermittently under load); 4xx passes through without retry.
  const attempt = () =>
    new Promise<MeskResponse>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        "User-Agent": WEB_USER_AGENT,
        Accept: "*/*",
        Referer: "https://music.amazon.com/",
        Origin: "https://music.amazon.com",
        "Content-Type": "text/plain;charset=UTF-8",
        "Content-Length": String(bodyBuf.length),
      };

      const reqOpts: https.RequestOptions = {
        host: AMAZON_MESK_HOST,
        port: 443,
        path,
        method: "POST",
        headers,
        signal: controller.signal,
        // Public host: default agent, full certificate verification.
        servername: AMAZON_MESK_HOST,
      };
      if (!target.isLiteral)
        reqOpts.lookup = pinnedLookup(target.ip, target.family);

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
          const raw = Buffer.concat(chunks);
          const encoding = String(
            res.headers["content-encoding"] ?? "",
          ).toLowerCase();
          const isGzip =
            encoding === "gzip" || raw.subarray(0, 2).equals(GZIP_MAGIC);
          let text: string;
          try {
            text = (isGzip ? gunzipSync(raw) : raw).toString("utf8");
          } catch (err) {
            reject(
              new StreamingError(
                `mesk response gunzip failed: ${err instanceof Error ? err.message : String(err)}`,
                "NETWORK",
              ),
            );
            return;
          }
          resolve({ status: res.statusCode ?? 0, text });
        });
      });

      req.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        const code = err.name === "AbortError" ? "TIMEOUT" : "NETWORK";
        reject(new StreamingError(`mesk request failed: ${err.message}`, code));
      });

      req.write(bodyBuf);
      req.end();
    });

  return withRetry(attempt);
}
