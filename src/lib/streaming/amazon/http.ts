import "server-only";
import https from "node:https";
import { resolveTarget, pinnedLookup } from "@/lib/wiim/client";
import { StreamingError } from "../types";
import { withRetry } from "./retry";

/**
 * Transport for Amazon Music's cloud API. Unlike the WiiM/DLNA transports,
 * this host is PUBLIC (not on the LAN) — normal TLS certificate verification
 * applies. We still resolve + pin the IP (reusing resolveTarget/pinnedLookup
 * from the WiiM client) so a DNS answer can't change between the resolve and
 * the connect, but there is no private-IP check here: music-api.amazon.com is
 * expected to resolve to a public address.
 *
 * Host allowlist: this module may ONLY ever contact AMAZON_API_HOST. There is
 * no way to pass a different host in — callers only supply a path.
 */

export const AMAZON_API_HOST = "music-api.amazon.com";

export interface AmazonApiResponse {
  status: number;
  text: string;
}

export async function amazonApiFetch(
  path: string,
  opts: {
    bearer: string;
    method?: "GET" | "POST";
    body?: string;
    timeoutMs?: number;
  },
): Promise<AmazonApiResponse> {
  const target = await resolveTarget(AMAZON_API_HOST);
  const timeoutMs = opts.timeoutMs ?? 8000;
  const method = opts.method ?? "GET";
  const bodyBuf =
    opts.body != null ? Buffer.from(opts.body, "utf8") : undefined;

  // Retry transient 5xx / connection failures (music-api is flaky under load);
  // 4xx (e.g. 401 expired bearer) passes through without retry.
  const attempt = () =>
    new Promise<AmazonApiResponse>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${opts.bearer}`,
        Accept: "application/json",
      };
      if (method === "POST") headers["Content-Type"] = "application/json";
      if (bodyBuf) headers["Content-Length"] = String(bodyBuf.length);

      const reqOpts: https.RequestOptions = {
        host: AMAZON_API_HOST,
        port: 443,
        path,
        method,
        headers,
        signal: controller.signal,
        // Public host: default agent, full certificate verification (no
        // rejectUnauthorized override — this is NOT the LAN device transport).
        servername: AMAZON_API_HOST,
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
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      });

      req.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        const code = err.name === "AbortError" ? "TIMEOUT" : "NETWORK";
        reject(
          new StreamingError(`Amazon API request failed: ${err.message}`, code),
        );
      });

      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });

  return withRetry(attempt);
}
