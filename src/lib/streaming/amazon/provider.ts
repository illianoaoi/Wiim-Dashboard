import "server-only";
import { searchAmazon } from "./search";
import { webSearchAmazon } from "./web-search";
import { playAmazon } from "./queue";
import type { StreamingProvider } from "../types";

/**
 * Amazon Music provider: wires the search/play implementations into the
 * shared `StreamingProvider` contract. `accountSource` is the value the
 * device's PlayQueue service expects (see `token.ts`'s `GetUserInfo` call
 * and `queue.ts`'s `CreateQueue` document, both hard-coded to "Prime" today).
 *
 * `opts.source` picks the search backend: "web" hits Amazon's anonymous
 * public endpoint and needs no device token (works even with no Amazon
 * account linked); the default, "device", uses the device's authenticated
 * music-api session. Play always requires the device's session regardless
 * of which source produced the result.
 */
export const AmazonProvider: StreamingProvider = {
  id: "amazon",
  accountSource: "Prime",
  search: (device, query, opts) =>
    opts?.source === "web" ? webSearchAmazon(query) : searchAmazon(device, query),
  play: playAmazon,
};
