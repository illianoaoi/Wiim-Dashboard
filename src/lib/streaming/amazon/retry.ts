import "server-only";
import { StreamingError } from "../types";

/**
 * Retry wrapper for the Amazon upstream transports. The web-player skill hosts
 * (na.web / na.mesk .skill.music.a2z.com) and music-api intermittently return
 * 5xx or drop the connection under load; a single retry with backoff clears
 * almost all of these.
 *
 * Retries ONLY transient failures:
 *  - a thrown StreamingError with code TIMEOUT or NETWORK, or
 *  - a resolved response with a 5xx status.
 * A 4xx (401 expired bearer, 400 bad request, …) is deterministic — it is
 * returned/thrown immediately without retry. On exhaustion the last 5xx
 * response is returned as-is so the caller's existing status handling maps it
 * to an error the same way it would without retries.
 */

interface Resp {
  status: number;
  text: string;
}

const RETRYABLE_ERROR_CODES = new Set(["TIMEOUT", "NETWORK"]);

function isRetryableError(e: unknown): boolean {
  return e instanceof StreamingError && RETRYABLE_ERROR_CODES.has(e.code);
}

function backoffMs(attempt: number, base: number): number {
  // Exponential (base, 2×base, …) plus up to 120ms jitter to avoid a
  // thundering herd when many track resolves fail at once.
  return base * 2 ** attempt + Math.floor(Math.random() * 120);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T extends Resp>(
  attempt: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number },
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const base = opts?.baseDelayMs ?? 250;

  for (let i = 0; ; i++) {
    try {
      const res = await attempt();
      if (res.status >= 500 && i < retries) {
        await delay(backoffMs(i, base));
        continue;
      }
      return res; // success, any 4xx, or a final (exhausted) 5xx
    } catch (e) {
      if (isRetryableError(e) && i < retries) {
        await delay(backoffMs(i, base));
        continue;
      }
      throw e; // non-transient, or retries exhausted
    }
  }
}
