import "server-only";
import type { Device } from "@/lib/db/devices";
import { amazonApiFetch } from "./http";
import { getAmazonUser } from "./token";
import { asRecord } from "./web-item";
import { parseTracks, type AmazonTrack } from "./queue";
import { fetchLibraryPlaylistTracks } from "./library-playlist";
import {
  StreamingError,
  type StreamDetail,
  type StreamKind,
  type StreamTrack,
} from "../types";

/**
 * Detail (tracklist) resolution for playable containers, per kind:
 *  - album / playlist (catalog): the SAME music-api node the play path uses
 *    (/catalog/albums/<id>/ or /catalog/playlists/<id>/, device bearer),
 *    parsed with queue.ts's parseTracks.
 *  - user-playlist: the anonymous showLibraryPlaylist web endpoint via
 *    library-playlist.ts (no bearer), which already returns ordered tracks.
 *  - track / artist: not supported here (artist detail is a later iteration).
 *
 * Header fields (title/subtitle/art) are best-effort — the UI already knows
 * them from the tapped tile; the important payload is `tracks`.
 */

/** Numeric seconds (as a string) → "M:SS" (e.g. "287" → "4:47"), or null. */
function formatDuration(seconds: string | null): string | null {
  if (!seconds) return null;
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const total = Math.round(n);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function toStreamTrack(t: AmazonTrack): StreamTrack {
  return {
    id: t.asin,
    title: t.title ?? "",
    artist: t.artist,
    album: t.album,
    art: t.art,
    duration: formatDuration(t.duration),
  };
}

/** Album / catalog-playlist detail off the music-api node the play path uses. */
async function fetchCatalogDetail(
  device: Device,
  kind: "album" | "playlist",
  id: string,
): Promise<StreamDetail> {
  const user = await getAmazonUser(device);
  const path =
    kind === "album"
      ? `/catalog/albums/${encodeURIComponent(id)}/`
      : `/catalog/playlists/${encodeURIComponent(id)}/`;
  const res = await amazonApiFetch(path, { bearer: user.bearer });

  if (res.status === 401) {
    throw new StreamingError("Amazon rejected the bearer token", "UNAUTHORIZED");
  }
  if (res.status >= 400) {
    throw new StreamingError(`Amazon catalog request failed (HTTP ${res.status})`, "CATALOG");
  }

  let root: Record<string, unknown>;
  try {
    root = asRecord(JSON.parse(res.text));
  } catch {
    throw new StreamingError("Amazon catalog response was not valid JSON", "CATALOG");
  }

  const amazonTracks = parseTracks(root);
  const first = amazonTracks[0];
  return {
    id,
    kind,
    title: (kind === "album" ? first?.album : null) ?? "",
    subtitle: first?.artist ?? null,
    art: first?.art ?? null,
    tracks: amazonTracks.map(toStreamTrack),
  };
}

/** Community/library playlist detail off the anonymous showLibraryPlaylist endpoint. */
async function fetchUserPlaylistDetail(id: string): Promise<StreamDetail> {
  const { name, tracks: libraryTracks } = await fetchLibraryPlaylistTracks(id);
  const tracks: StreamTrack[] = libraryTracks.map((t) => ({
    id: t.asin,
    title: t.title ?? "",
    artist: t.artist,
    album: null,
    art: t.art,
    duration: t.duration, // already display-formatted ("M:SS") by library-playlist.ts
  }));
  return {
    id,
    kind: "user-playlist",
    title: name ?? "",
    subtitle: tracks[0]?.artist ?? null,
    art: tracks[0]?.art ?? null,
    tracks,
  };
}

/** Resolve the ordered tracklist (plus best-effort header) for a container. */
export async function fetchAmazonDetail(
  device: Device,
  kind: StreamKind,
  id: string,
): Promise<StreamDetail> {
  switch (kind) {
    case "album":
    case "playlist":
      return fetchCatalogDetail(device, kind, id);
    case "user-playlist":
      return fetchUserPlaylistDetail(id);
    case "track":
    case "artist":
      throw new StreamingError("Detail not available for this kind", "BAD_KIND");
  }
}
