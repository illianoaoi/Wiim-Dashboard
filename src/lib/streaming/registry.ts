import "server-only";
import { AmazonProvider } from "./amazon/provider";
import type { StreamingProvider } from "./types";

/**
 * Provider registry: routes look up a `StreamingProvider` by its id (e.g. the
 * `provider` path/body param) without needing to know which service module
 * implements it. Returns `null` for an unknown id so the caller can respond
 * with a normal 400/404 instead of throwing.
 */
export function getProvider(id: string): StreamingProvider | null {
  switch (id) {
    case "amazon":
      return AmazonProvider;
    default:
      return null;
  }
}
