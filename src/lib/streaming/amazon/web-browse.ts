import "server-only";
import { meskFetch } from "./mesk-http";
import { webHeadersBlob } from "./web-headers";
import { asArray, asRecord, parseWebItem } from "./web-item";
import { StreamingError, type StreamItem } from "../types";

/**
 * Paginated per-category Amazon Music catalog listing via the anonymous
 * "mesk" skill host (see `mesk-http.ts`). Where `web-search.ts` (showSearch)
 * returns one mixed page of everything, these endpoints list a single
 * category — tracks, albums, artists, catalog playlists, or community
 * playlists — ten-or-so items at a time with a continuation token, which is
 * what backs the UI's "See all" expanded views.
 *
 * Response shapes (verified against live probes, 2026-07-23):
 *  - FIRST page (no `next` param): items at
 *    `root.methods[0].template.widgets[0].items[]`; the continuation token is
 *    a `next=` query param inside
 *    `root.methods[0].template.widgets[0].onEndOfWidget[0].url`.
 *  - CONTINUATION page (`next=` sent): the method is
 *    `Web.PageInterface.v1_0.AddVerticalItemsToLastWidgetMethod` and items sit
 *    DIRECTLY at `root.methods[0].items[]`; the next token is again in
 *    `root.methods[0].onEndOfWidget[0].url`.
 * A page with no onEndOfWidget url (or no `next` param in it) is the last one.
 */

export type BrowseCategory = "tracks" | "albums" | "artists" | "playlists" | "userPlaylists";

export interface BrowsePage {
  items: StreamItem[];
  /** Opaque continuation token (`tztok-v2_…`), or null when this is the last page. */
  nextToken: string | null;
}

const CATEGORY_PATH: Record<BrowseCategory, string> = {
  tracks: "/api/searchCatalogTracks",
  albums: "/api/searchCatalogAlbums",
  artists: "/api/searchCatalogArtists",
  playlists: "/api/searchCatalogPlaylists",
  userPlaylists: "/api/searchCommunityPlaylists",
};

/** Fixed anonymous membership tier — the same blob web-search.ts sends in its body. */
const USER_HASH = encodeURIComponent(JSON.stringify({ level: "LIBRARY_MEMBER" }));

/**
 * Pull the `next` continuation token out of an `onEndOfWidget` entry list:
 * the first entry carrying a `url` string whose query has a `next` param wins.
 */
function nextTokenFrom(onEndOfWidget: unknown): string | null {
  for (const raw of asArray(onEndOfWidget)) {
    const url = asRecord(raw).url;
    if (typeof url !== "string" || !url) continue;
    try {
      const token = new URL(url, "https://na.mesk.skill.music.a2z.com").searchParams.get("next");
      if (token) return token;
    } catch {
      // Malformed URL — keep scanning the remaining entries.
    }
  }
  return null;
}

/** Fetch one page of a category listing; pass the previous page's token as `next` to continue. */
export async function browseCategory(
  query: string,
  category: BrowseCategory,
  next?: string,
): Promise<BrowsePage> {
  const path =
    `${CATEGORY_PATH[category]}?keyword=${encodeURIComponent(query)}&userHash=${USER_HASH}` +
    (next ? `&next=${encodeURIComponent(next)}` : "");
  const res = await meskFetch(path, JSON.stringify({ headers: webHeadersBlob() }));

  if (res.status >= 400) {
    throw new StreamingError(`Amazon browse HTTP ${res.status}`, "SEARCH_FAILED");
  }

  let root: Record<string, unknown>;
  try {
    root = asRecord(JSON.parse(res.text));
  } catch {
    // Tolerant of an unconfirmed body shape, mirroring web-search.ts.
    return { items: [], nextToken: null };
  }

  const method = asRecord(asArray(root.methods)[0]);
  const firstWidget = asRecord(asArray(asRecord(method.template).widgets)[0]);

  // Continuation pages (AddVerticalItemsToLastWidgetMethod) carry items
  // directly on the method; first pages nest them under template.widgets[0].
  const directItems = asArray(method.items);
  const rawItems = directItems.length > 0 ? directItems : asArray(firstWidget.items);

  const seen = new Set<string>();
  const items: StreamItem[] = [];
  for (const rawItem of rawItems) {
    const parsed = parseWebItem(rawItem);
    if (!parsed) continue;
    const key = `${parsed.kind}:${parsed.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(parsed);
  }

  const nextToken = nextTokenFrom(method.onEndOfWidget) ?? nextTokenFrom(firstWidget.onEndOfWidget);

  return { items, nextToken };
}
