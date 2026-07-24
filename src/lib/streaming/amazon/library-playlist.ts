import "server-only";
import { meskFetch } from "./mesk-http";
import { webHeadersBlob } from "./web-headers";
import { asArray, asRecord, classifyDeeplink } from "./web-item";
import { StreamingError } from "../types";

/**
 * Resolve a community/library playlist ("user-playlist", identified by an
 * opaque hash — not an ASIN) into its ordered tracks via the web player's
 * anonymous showLibraryPlaylist endpoint on the mesk host. No device session
 * or bearer token is involved; like showSearch, the endpoint accepts the
 * stale replayed header blob from `web-headers.ts`.
 *
 * The response is a template-rendering document for the web player's own UI
 * (same family as showSearch / searchCatalog*): the track list lives at
 * `root.methods[0].template.widgets[]`, one item per track, each carrying a
 * `primaryLink.deeplink` of the shape `/albums/<albumAsin>?trackAsin=<T>`,
 * which `classifyDeeplink` turns into `{ kind: "track", id: <trackAsin> }`.
 * Widget/item order is the playlist order and is preserved.
 *
 * v1 reads the FIRST page only — the endpoint paginates via onEndOfWidget like
 * the search endpoints, but we deliberately do not page here — and caps at
 * MAX_TRACKS, so very long playlists play their first 50 tracks.
 */

const MAX_TRACKS = 50;

export interface LibraryPlaylistTrack {
  asin: string;
  title: string | null;
  artist: string | null;
  art: string | null;
  /** Human-readable duration ("M:SS" / "H:MM:SS") when the item exposes one, else null. */
  duration: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

// A display duration as the web player renders it: "M:SS" or "H:MM:SS".
const DURATION_RE = /^\d{1,3}:\d{2}(?::\d{2})?$/;

/**
 * Tolerant duration read: playlist rows carry it as an extra text slot
 * (secondaryText3 in captured responses; tertiaryText on some templates). Only
 * a value that actually looks like a duration is accepted — anything else in
 * those slots (album name, badge text) yields null.
 */
function durationOf(item: Record<string, unknown>): string | null {
  for (const field of ["secondaryText3", "tertiaryText"] as const) {
    const v = textOf(item[field])?.trim();
    if (v && DURATION_RE.test(v)) return v;
  }
  return null;
}

/** Template text fields show up as either a plain string or a `{ text }` TextElement. */
function textOf(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object") return str((v as Record<string, unknown>).text);
  return null;
}

/**
 * Fetch a library playlist's first page and return its (tolerantly read,
 * possibly null) display name plus the full ordered tracks. An empty `tracks`
 * is NOT an error here — the caller decides what that means.
 */
export async function fetchLibraryPlaylistTracks(
  hash: string,
): Promise<{ name: string | null; tracks: LibraryPlaylistTrack[] }> {
  const userHash = encodeURIComponent(JSON.stringify({ level: "LIBRARY_MEMBER" }));
  const path = `/api/showLibraryPlaylist?id=${encodeURIComponent(hash)}&userHash=${userHash}`;
  const res = await meskFetch(path, JSON.stringify({ headers: webHeadersBlob() }));

  if (res.status >= 400) {
    throw new StreamingError(`showLibraryPlaylist returned HTTP ${res.status}`, "CATALOG");
  }

  let root: Record<string, unknown>;
  try {
    root = asRecord(JSON.parse(res.text));
  } catch {
    throw new StreamingError("showLibraryPlaylist response was not valid JSON", "CATALOG");
  }

  const template = asRecord(asRecord(asArray(root.methods)[0]).template);

  // Playlist title: tolerant read — the header shape varies across templates,
  // and a missing name is fine (the caller falls back to a generic label).
  const name = textOf(template.headerText) ?? textOf(template.header) ?? null;

  const tracks: LibraryPlaylistTrack[] = [];
  for (const rawWidget of asArray(template.widgets)) {
    if (tracks.length >= MAX_TRACKS) break;
    for (const rawItem of asArray(asRecord(rawWidget).items)) {
      if (tracks.length >= MAX_TRACKS) break;
      const item = asRecord(rawItem);
      const deeplink = str(asRecord(item.primaryLink).deeplink);
      if (!deeplink) continue;
      const classified = classifyDeeplink(deeplink);
      if (!classified || classified.kind !== "track") continue;
      tracks.push({
        asin: classified.id,
        title: textOf(item.primaryText) ?? str(item.imageAltText),
        artist: textOf(item.secondaryText),
        art: str(item.image),
        duration: durationOf(item),
      });
    }
  }

  return { name, tracks };
}
