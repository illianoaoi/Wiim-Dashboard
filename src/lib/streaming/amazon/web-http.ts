import "server-only";
import https from "node:https";
import { gunzipSync } from "node:zlib";
import { resolveTarget, pinnedLookup } from "@/lib/wiim/client";
import { StreamingError } from "../types";
import { withRetry } from "./retry";

/**
 * Transport for Amazon Music's public web-player search endpoint
 * (na.web.skill.music.a2z.com/api/showSearch). Like `http.ts`'s
 * music-api.amazon.com, this host is PUBLIC (not on the LAN) — normal TLS
 * certificate verification applies. We still resolve + pin the IP (reusing
 * resolveTarget/pinnedLookup from the WiiM client) so a DNS answer can't
 * change between the resolve and the connect, but there is no private-IP
 * check here: this is expected to resolve to a public address.
 *
 * Unlike music-api.amazon.com, this endpoint needs no device bearer token —
 * it accepts an empty accessToken and a stale, hard-coded CSRF blob (see
 * `web-search.ts`), so this transport takes only a request body.
 *
 * Host allowlist: this module may ONLY ever contact AMAZON_WEB_HOST, and
 * only at the fixed showSearch path. There is no way to pass a different
 * host or path in — callers only supply a body.
 */

export const AMAZON_WEB_HOST = "na.web.skill.music.a2z.com";

const SHOW_SEARCH_PATH = "/api/showSearch";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";

/** GZIP magic bytes (RFC 1952): a gzip-compressed body always starts with these two bytes. */
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

export interface AmazonWebResponse {
  status: number;
  text: string;
}

export async function amazonWebFetch(
  body: string,
  opts?: { timeoutMs?: number },
): Promise<AmazonWebResponse> {
  const target = await resolveTarget(AMAZON_WEB_HOST);
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const bodyBuf = Buffer.from(body, "utf8");

  // Retry transient 5xx / connection failures (showSearch 500s intermittently);
  // 4xx passes through without retry.
  const attempt = () =>
    new Promise<AmazonWebResponse>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Mirrors the real web player's request as captured: no Accept-Encoding
      // (the server can still reply gzipped regardless; see decodeBody below),
      // and the Referer/Origin the endpoint expects from music.amazon.com.
      const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        Accept: "*/*",
        Referer: "https://music.amazon.com/",
        Origin: "https://music.amazon.com",
        "Content-Type": "text/plain;charset=UTF-8",
        "Content-Length": String(bodyBuf.length),
      };

      const reqOpts: https.RequestOptions = {
        host: AMAZON_WEB_HOST,
        port: 443,
        path: SHOW_SEARCH_PATH,
        method: "POST",
        headers,
        signal: controller.signal,
        // Public host: default agent, full certificate verification (no
        // rejectUnauthorized override — this is NOT the LAN device transport).
        servername: AMAZON_WEB_HOST,
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
                `Amazon web-search response gunzip failed: ${err instanceof Error ? err.message : String(err)}`,
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
        reject(
          new StreamingError(
            `Amazon web-search request failed: ${err.message}`,
            code,
          ),
        );
      });

      req.write(bodyBuf);
      req.end();
    });

  return withRetry(attempt);
}
