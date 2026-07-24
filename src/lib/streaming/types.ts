import "server-only";
import type { Device } from "@/lib/db/devices";

/**
 * Shared contract for streaming-service providers (Amazon Music, and future
 * ones). A provider knows how to search its catalog and how to start
 * playback on a given WiiM device — everything else (routes, Zod validation,
 * the SSRF-guarded device transports) is provider-agnostic.
 */

/**
 * A playable/browsable catalog entity. "user-playlist" is a community/library
 * playlist identified by an opaque hash (not an ASIN), resolved via the web
 * player's showLibraryPlaylist endpoint rather than /catalog — it lists tracks
 * by ASIN, which then play through the normal pipeline.
 */
export type StreamKind = "track" | "album" | "artist" | "playlist" | "user-playlist";

/**
 * Which backend a search hits. "device" = the provider's authenticated
 * backend via the device's session (music-api for Amazon). "web" = the
 * provider's anonymous public web endpoint. Default everywhere is "device"
 * (pre-existing behavior).
 */
export type StreamSource = "device" | "web";

/** One normalized, displayable hit from a provider search. */
export interface StreamItem {
  id: string;
  kind: StreamKind;
  title: string;
  subtitle: string | null;
  art: string | null;
}

/** Search results bucketed by kind, as returned to the UI. */
export interface SearchResults {
  tracks: StreamItem[];
  albums: StreamItem[];
  artists: StreamItem[];
  playlists: StreamItem[];
  /** Community/library playlists (opaque-hash ids, kind "user-playlist"). */
  userPlaylists: StreamItem[];
}

/** What the user picked to play. */
export interface PlaySelection {
  id: string;
  kind: StreamKind;
  /**
   * 1-based position to start playback at within a container (album / playlist
   * / user-playlist) — the whole container is queued on the device, playing
   * from this track. Omitted/1 starts at the top. Ignored for a lone track.
   */
  startIndex?: number;
}

/** One track row inside a detail view (album / playlist / community playlist). */
export interface StreamTrack {
  /** Track ASIN — playable as a `{ kind: "track" }` selection. */
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  art: string | null;
  /** Human-readable duration (e.g. "4:44"), or null when the source omits it. */
  duration: string | null;
}

/**
 * A resolved detail page for a playable container: its header fields plus the
 * ordered tracklist. `id`/`kind` echo the container so the UI can offer
 * "Play all" through the normal play route.
 */
export interface StreamDetail {
  id: string;
  kind: StreamKind;
  title: string;
  subtitle: string | null;
  art: string | null;
  tracks: StreamTrack[];
}

export interface StreamingProvider {
  /** Registry key, e.g. "amazon". */
  id: string;
  /** Account/source label as the device's PlayQueue service expects it, e.g. "Prime". */
  accountSource: string;
  search(device: Device, query: string, opts?: { source?: StreamSource }): Promise<SearchResults>;
  play(device: Device, selection: PlaySelection): Promise<void>;
}

/** Provider-level failure, carrying a stable code the route layer maps to an HTTP status. */
export class StreamingError extends Error {
  code: string;
  constructor(message: string, code = "STREAMING_ERROR") {
    super(message);
    this.name = "StreamingError";
    this.code = code;
  }
}

/** Map a StreamingError code to the HTTP status a route should respond with. */
export function streamingErrorStatus(code?: string): number {
  switch (code) {
    case "FORBIDDEN_HOST":
    case "NOT_CONFIGURED":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "TIMEOUT":
      return 504;
    default:
      return 502;
  }
}
