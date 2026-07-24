import "server-only";
import { amazonWebFetch } from "./web-http";
import { webHeadersBlob } from "./web-headers";
import { asArray, asRecord, parseWebItem } from "./web-item";
import { StreamingError, type SearchResults, type StreamItem, type StreamKind } from "../types";

/**
 * Amazon Music search via the anonymous public web-player endpoint
 * (showSearch), as an alternative to the authenticated device-session search
 * in `search.ts`. This needs no Device/bearer token at all: the endpoint
 * accepts an empty `accessToken` and a stale, hard-coded CSRF token/nonce
 * (see `web-headers.ts`) — verified against a live probe.
 *
 * The response is a template-rendering document for the web player's own UI
 * (`root.methods[0].template.widgets[]`), not a clean search API. Items are
 * classified by their `primaryLink.deeplink` shape (see `web-item.ts`), never
 * by the localized widget `header`.
 */

const MAX_PER_BUCKET = 50;

function buildRequestBody(query: string): string {
  return JSON.stringify({
    keyword: JSON.stringify({
      interface:
        "Web.TemplatesInterface.v1_0.Touch.SearchTemplateInterface.SearchKeywordClientInformation",
      keyword: query,
    }),
    userHash: JSON.stringify({ level: "LIBRARY_MEMBER" }),
    headers: webHeadersBlob(),
  });
}

function bucketFor(results: SearchResults, kind: StreamKind): StreamItem[] {
  if (kind === "track") return results.tracks;
  if (kind === "album") return results.albums;
  if (kind === "artist") return results.artists;
  if (kind === "user-playlist") return results.userPlaylists;
  return results.playlists;
}

export async function webSearchAmazon(query: string): Promise<SearchResults> {
  const res = await amazonWebFetch(buildRequestBody(query));

  if (res.status >= 400) {
    throw new StreamingError(`Amazon web search returned HTTP ${res.status}`, "SEARCH_FAILED");
  }

  const results: SearchResults = { tracks: [], albums: [], artists: [], playlists: [], userPlaylists: [] };

  let root: Record<string, unknown>;
  try {
    root = asRecord(JSON.parse(res.text));
  } catch {
    return results; // unconfirmed body shape shouldn't be a hard error
  }

  const methods = asArray(root.methods);
  const widgets = asArray(asRecord(asRecord(methods[0]).template).widgets);

  // The same item can appear in more than one widget (e.g. Top Results repeats
  // items from Songs/Albums); first occurrence wins, so widget order is kept.
  const seen = new Set<string>();

  for (const rawWidget of widgets) {
    const widget = asRecord(rawWidget);
    for (const rawItem of asArray(widget.items)) {
      const parsed = parseWebItem(rawItem);
      if (!parsed) continue;

      const dedupeKey = `${parsed.kind}:${parsed.id}`;
      if (seen.has(dedupeKey)) continue;

      const bucket = bucketFor(results, parsed.kind);
      if (bucket.length >= MAX_PER_BUCKET) continue;

      seen.add(dedupeKey);
      bucket.push(parsed);
    }
  }

  return results;
}
