import "server-only";
import type { StreamItem, StreamKind } from "../types";

/**
 * Shared parsing for Amazon Music web-player result items. Both the anonymous
 * search (`web-search.ts`, showSearch) and the paginated per-category browse
 * (`web-browse.ts`, searchCatalog*) return the same item shape, so item
 * classification and field extraction live here once.
 *
 * Items are classified by the URL shape of their own `primaryLink.deeplink`,
 * which encodes the catalog type directly and is stable across locales — never
 * by the (localized, display-only) widget header text.
 */

const ASIN_RE = /^[A-Z0-9]{10}$/i;

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** `secondaryText`/`primaryText` show up as either a plain string or a `{ text }` TextElement. */
function textOf(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object") return str((v as Record<string, unknown>).text);
  return null;
}

/**
 * Classify one item by its deeplink path and resolve its id — only the kinds
 * the play pipeline supports:
 *  - /artists/<ASIN>/…                          → artist
 *  - /albums/<ASIN>?trackAsin=<T>               → track (id = trackAsin)
 *  - /albums/<ASIN>                             → album
 *  - /playlists/<ASIN>                          → playlist (catalog)
 *  - /user-playlists/<hash>                     → user-playlist (community/library)
 * Anything else (stations, podcasts, audiobooks) returns null and is skipped.
 */
export function classifyDeeplink(deeplink: string): { kind: StreamKind; id: string } | null {
  let url: URL;
  try {
    url = new URL(deeplink, "https://music.amazon.com");
  } catch {
    return null;
  }
  const path = url.pathname;

  const artistMatch = /^\/artists\/([^/]+)/.exec(path);
  if (artistMatch) {
    const id = artistMatch[1];
    return ASIN_RE.test(id) ? { kind: "artist", id } : null;
  }

  const albumMatch = /^\/albums\/([^/]+)$/.exec(path);
  if (albumMatch) {
    const trackAsin = url.searchParams.get("trackAsin");
    if (trackAsin) return ASIN_RE.test(trackAsin) ? { kind: "track", id: trackAsin } : null;
    const id = albumMatch[1];
    return ASIN_RE.test(id) ? { kind: "album", id } : null;
  }

  const playlistMatch = /^\/playlists\/([^/]+)$/.exec(path);
  if (playlistMatch) {
    const id = playlistMatch[1];
    return ASIN_RE.test(id) ? { kind: "playlist", id } : null;
  }

  // Community/library playlists: opaque hash id (not an ASIN), resolved later
  // via showLibraryPlaylist.
  const userPlaylistMatch = /^\/user-playlists\/([A-Za-z0-9]{16,})$/.exec(path);
  if (userPlaylistMatch) {
    return { kind: "user-playlist", id: userPlaylistMatch[1] };
  }

  return null;
}

/**
 * Turn one raw widget item into a normalized StreamItem, or null if it isn't a
 * playable/browsable kind or has no usable title. Playlist items in their
 * dedicated widgets carry an empty primaryText.text — imageAltText (a plain
 * string) is the real title there.
 */
export function parseWebItem(rawItem: unknown): StreamItem | null {
  const item = asRecord(rawItem);
  const deeplink = str(asRecord(item.primaryLink).deeplink);
  if (!deeplink) return null;
  const classified = classifyDeeplink(deeplink);
  if (!classified) return null;

  const title = textOf(item.primaryText) ?? str(item.imageAltText);
  if (!title) return null;

  return {
    id: classified.id,
    kind: classified.kind,
    title,
    subtitle: textOf(item.secondaryText),
    art: str(item.image),
  };
}
