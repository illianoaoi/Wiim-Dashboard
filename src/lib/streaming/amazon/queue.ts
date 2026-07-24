import "server-only";
import type { Device } from "@/lib/db/devices";
import { amazonApiFetch, AMAZON_API_HOST } from "./http";
import { getAmazonUser } from "./token";
import { playQueueSoap, xmlEsc } from "./soap";
import { fetchLibraryPlaylistTracks } from "./library-playlist";
import { StreamingError, type PlaySelection } from "../types";

/**
 * Amazon Music playback via the device's PlayQueue "CreateQueue" action.
 *
 * Flow (mirrors the WiiM app / AMParseModel + lpmdpkit PlayList builder):
 *  1. Resolve the selection's node URL on music-api.amazon.com:
 *       track    → /catalog/tracks/<ASIN>/
 *       album    → /catalog/albums/<ASIN>/     (node embeds its track chunk)
 *       playlist → /catalog/playlists/<ASIN>/
 *       artist   → /catalog/artists/<ASIN>/
 *     ("user-playlist" is the exception: no catalog node — its ordered track
 *      ASINs come from the anonymous showLibraryPlaylist web endpoint, then each
 *      is resolved via /catalog/tracks/<ASIN>/ like a single track; see
 *      playUserPlaylist.)
 *  2. Read the ordered tracks from trackContainerChunkDescriptions →
 *     trackInstances → trackDefinitions (stream URL in `audio.uri`, ASIN in
 *     `trackTag`, plus title/artist/album/art/duration/headers/expires).
 *  3. Build the <QueueContext> PlayList XML and hand it to the device. Each
 *     track carries a RefreshUrl (=/catalog/tracks/<ASIN>/) so the device
 *     re-resolves an expired/absent stream URL itself using its own session.
 */

export interface AmazonTrack {
  asin: string;
  streamUrl: string; // audio.uri (HLS/DASH manifest; may be empty at album browse)
  refreshUrl: string; // /catalog/tracks/<ASIN>/ — device re-resolves from here
  playEventUrl: string | null;
  amazonHeaders: string | null; // JSON of audio.headers, replayed by the renderer
  expires: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumId: string | null;
  duration: string | null; // verbatim from trackDefinition.duration
  art: string | null;
}

const MAX_QUEUE_TRACKS = 500;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function numStr(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return str(v);
}
function noHashKey(s: string): string {
  return s.replace(/^#/, "");
}

/** music-api node path for a selection — catalog kinds only. */
function nodePathFor(selection: PlaySelection): string {
  const id = encodeURIComponent(selection.id);
  switch (selection.kind) {
    case "track":
      return `/catalog/tracks/${id}/`;
    case "album":
      return `/catalog/albums/${id}/`;
    case "playlist":
      return `/catalog/playlists/${id}/`;
    case "artist":
      return `/catalog/artists/${id}/`;
    case "user-playlist":
      // Never reached: playAmazon dispatches user-playlists to
      // playUserPlaylist before calling this. The case keeps the switch
      // exhaustive so the function provably always returns.
      throw new StreamingError("user-playlist has no catalog node", "CATALOG");
  }
}

/** Ordered track-instance keys: chunk order if present, else all instances. */
function orderedInstanceKeys(root: Record<string, unknown>): string[] {
  const chunks = asRecord(root.trackContainerChunkDescriptions);
  const keys: string[] = [];
  for (const chunk of Object.values(chunks)) {
    for (const k of asArray(asRecord(chunk).trackInstances))
      keys.push(noHashKey(String(k)));
  }
  if (keys.length > 0) return keys;
  return Object.keys(asRecord(root.trackInstances));
}

/** Ordered tracks off a music-api catalog node (also reused by detail.ts). */
export function parseTracks(root: Record<string, unknown>): AmazonTrack[] {
  const trackInstances = asRecord(root.trackInstances);
  const trackDefinitions = asRecord(root.trackDefinitions);
  const out: AmazonTrack[] = [];

  // Resolve via instances when available, else straight off trackDefinitions.
  const instanceKeys = orderedInstanceKeys(root);
  const entries: Array<{
    td: Record<string, unknown>;
    playEvent: string | null;
  }> =
    instanceKeys.length > 0
      ? instanceKeys.map((ik) => {
          const inst = asRecord(trackInstances[ik]);
          const tdKey = str(inst.trackDefinition);
          return {
            td: tdKey ? asRecord(trackDefinitions[noHashKey(tdKey)]) : {},
            playEvent: str(inst.playbackEventCollector),
          };
        })
      : Object.values(trackDefinitions).map((td) => ({
          td: asRecord(td),
          playEvent: null,
        }));

  for (const { td, playEvent } of entries) {
    if (out.length >= MAX_QUEUE_TRACKS) break;
    const asin = str(td.trackTag);
    if (!asin) continue; // ASIN is the minimum needed to build a playable entry
    const audio = asRecord(td.audio);
    const headers =
      td.audio && typeof td.audio === "object" ? asRecord(audio.headers) : {};
    out.push({
      asin,
      streamUrl: str(audio.uri) ?? "",
      refreshUrl: `https://${AMAZON_API_HOST}/catalog/tracks/${asin}/`,
      playEventUrl: playEvent,
      amazonHeaders:
        Object.keys(headers).length > 0 ? JSON.stringify(headers) : null,
      expires: numStr(audio.expires),
      title: str(td.title),
      artist: str(asRecord(td.artist).name),
      album: str(asRecord(td.album).name),
      albumId: str(asRecord(td.album).asin),
      duration: numStr(td.duration),
      art: str(asRecord(td.image).uri),
    });
  }
  return out;
}

/** DIDL-Lite <Metadata>, using LinkPlay's song: namespace (per the app builder). */
function buildDidl(t: AmazonTrack): string {
  const el = (tag: string, val: string | null) =>
    val ? `<${tag}>${xmlEsc(val)}</${tag}>` : `<${tag}></${tag}>`;
  return (
    `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ` +
    `xmlns:song="www.linkplay.com/song/" ` +
    `xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">` +
    `<upnp:class>object.item.audioItem.musicTrack</upnp:class>` +
    `<item id="${xmlEsc(t.asin)}">` +
    `<song:id>${xmlEsc(t.asin)}</song:id>` +
    el("song:singerid", null) +
    el("song:albumid", t.albumId) +
    `<res protocolInfo="http-get:*:audio/mpeg:DLNA.ORG_PN=MP3;DLNA.ORG_OP=01;" duration="${xmlEsc(t.duration ?? "0")}">${xmlEsc(t.refreshUrl)}</res>` +
    el("dc:title", t.title) +
    el("upnp:artist", t.artist) +
    el("upnp:album", t.album) +
    el("upnp:albumArtURI", t.art) +
    `</item></DIDL-Lite>`
  );
}

/** One <Track{i}> block. RefreshUrl is always set so the device can re-resolve. */
function buildTrackBlock(t: AmazonTrack, index: number): string {
  const opt = (tag: string, val: string | null) =>
    val ? `<${tag}>${xmlEsc(val)}</${tag}>` : "";
  return (
    `<Track${index}>` +
    `<Source>Prime</Source>` +
    `<Id>${xmlEsc(t.asin)}</Id>` +
    `<URL>${xmlEsc(t.streamUrl)}</URL>` +
    opt("Expires", t.expires) +
    opt("PlayEventUrl", t.playEventUrl) +
    `<RefreshUrl>${xmlEsc(t.refreshUrl)}</RefreshUrl>` +
    opt("AmazonHeaders", t.amazonHeaders) +
    `<Metadata>${xmlEsc(buildDidl(t))}</Metadata>` +
    `</Track${index}>`
  );
}

function buildPlaylistXml(
  tracks: AmazonTrack[],
  opts: {
    listName: string;
    searchUrl: string;
    userId: string;
    /** 1-based track to start playback at; clamped to [1, tracks.length]. */
    startIndex?: number;
  },
): string {
  const trackBlocks = tracks.map((t, i) => buildTrackBlock(t, i + 1)).join("");
  // Clamp defensively: the UI's index is 1-based against the same parseTracks
  // order these blocks were built from, but an out-of-range value must never
  // produce an unplayable queue.
  const startIndex = Math.min(
    Math.max(Math.trunc(opts.startIndex ?? 1), 1),
    Math.max(tracks.length, 1),
  );
  return (
    `<PlayList>` +
    `<ListName>${xmlEsc(opts.listName)}</ListName>` +
    `<ListInfo>` +
    `<SourceName>Prime</SourceName>` +
    `<SearchUrl>${xmlEsc(opts.searchUrl)}</SearchUrl>` +
    `<TrackNumber>${tracks.length}</TrackNumber>` +
    `<TotalNumber>${tracks.length}</TotalNumber>` +
    `<UserId>${xmlEsc(opts.userId)}</UserId>` +
    `<Type>0</Type>` +
    `<Quality>0</Quality>` +
    `<StartPlayIndex>${startIndex}</StartPlayIndex>` +
    `<RealIndex>${startIndex}</RealIndex>` +
    `</ListInfo>` +
    `<Tracks>${trackBlocks}</Tracks>` +
    `</PlayList>`
  );
}

/** Build the PlayList XML and hand it to the device's PlayQueue service. */
async function pushQueue(
  device: Device,
  tracks: AmazonTrack[],
  opts: {
    listName: string;
    searchUrl: string;
    userId: string;
    startIndex?: number;
  },
): Promise<void> {
  const playlistXml = buildPlaylistXml(tracks, opts);
  await playQueueSoap(
    device.host,
    "CreateQueue",
    `<QueueContext>${xmlEsc(playlistXml)}</QueueContext><QueuePolicy>0</QueuePolicy>`,
  );
}

// User-playlist limit: 50 matches library-playlist.ts's first-page cap (well
// under MAX_QUEUE_TRACKS).
const USER_PLAYLIST_MAX_TRACKS = 50;

// How many track ASINs to resolve against music-api at once. A queued track
// only plays if its <URL> is a real resolved stream (an empty URL relying on
// device-side RefreshUrl resolution does NOT play for these hand-built
// queues — catalog/individual-track plays work precisely because they resolve
// here first). We resolve every track up front, but in parallel so a 50-track
// playlist takes a few round-trip waves, not 50 serial ones.
const TRACK_RESOLVE_CONCURRENCY = 12;

/**
 * Resolve one track ASIN to its playable form via /catalog/tracks/<ASIN>/ —
 * the same node a single-track play uses, so the queue gets a real stream URL.
 * Returns [] when the node fails or parses empty so the caller skips just that
 * track; a 401 is rethrown because every remaining resolve would fail the same.
 */
async function resolveTrackAsin(
  asin: string,
  bearer: string,
): Promise<AmazonTrack[]> {
  try {
    const res = await amazonApiFetch(
      `/catalog/tracks/${encodeURIComponent(asin)}/`,
      { bearer },
    );
    if (res.status === 401) {
      throw new StreamingError(
        "Amazon rejected the bearer token",
        "UNAUTHORIZED",
      );
    }
    if (res.status >= 400) return [];
    return parseTracks(asRecord(JSON.parse(res.text)));
  } catch (e) {
    if (e instanceof StreamingError && e.code === "UNAUTHORIZED") throw e;
    return []; // skip this track, keep the rest of the playlist
  }
}

/**
 * Play a community/library playlist. It has no /catalog node — the anonymous
 * showLibraryPlaylist endpoint yields its ordered track ASINs, each of which
 * is then resolved to a real stream URL via /catalog/tracks/<ASIN>/ (in
 * parallel, order preserved) and accumulated into one CreateQueue. Resolution
 * is required: a queued track with an empty URL does not play on the device.
 *
 * `startIndex` is 1-based against the library's track order — the same order
 * the detail view lists — and is clamped in buildPlaylistXml, so it stays in
 * range even when unresolvable tracks were skipped.
 */
async function playUserPlaylist(
  device: Device,
  hash: string,
  startIndex?: number,
): Promise<void> {
  const user = await getAmazonUser(device);
  const { name, tracks: libraryTracks } =
    await fetchLibraryPlaylistTracks(hash);
  const asins = libraryTracks
    .slice(0, USER_PLAYLIST_MAX_TRACKS)
    .map((t) => t.asin);

  // Resolve in order-preserving waves of bounded concurrency; failures skip.
  const resolved: AmazonTrack[][] = [];
  for (let i = 0; i < asins.length; i += TRACK_RESOLVE_CONCURRENCY) {
    const wave = asins.slice(i, i + TRACK_RESOLVE_CONCURRENCY);
    resolved.push(
      ...(await Promise.all(
        wave.map((asin) => resolveTrackAsin(asin, user.bearer)),
      )),
    );
  }
  const tracks = resolved.flat().slice(0, MAX_QUEUE_TRACKS);

  if (tracks.length === 0) {
    throw new StreamingError("No playable tracks in playlist", "NO_TRACKS");
  }

  await pushQueue(device, tracks, {
    listName: name ?? "Amazon Music",
    searchUrl: `https://music.amazon.com/user-playlists/${encodeURIComponent(hash)}`,
    userId: user.userId,
    startIndex,
  });
}

export async function playAmazon(
  device: Device,
  selection: PlaySelection,
): Promise<void> {
  // Community/library playlists have no catalog node — resolve their track
  // ASINs via the web endpoint instead, then join the same queue pipeline.
  if (selection.kind === "user-playlist") {
    return playUserPlaylist(device, selection.id, selection.startIndex);
  }

  const user = await getAmazonUser(device);
  const path = nodePathFor(selection);
  const res = await amazonApiFetch(path, { bearer: user.bearer });

  if (res.status === 401) {
    throw new StreamingError(
      "Amazon rejected the bearer token",
      "UNAUTHORIZED",
    );
  }
  if (res.status >= 400) {
    throw new StreamingError(
      `Amazon catalog request failed (HTTP ${res.status})`,
      "CATALOG",
    );
  }

  let root: Record<string, unknown>;
  try {
    root = asRecord(JSON.parse(res.text));
  } catch {
    throw new StreamingError(
      "Amazon catalog response was not valid JSON",
      "CATALOG",
    );
  }

  const tracks = parseTracks(root);
  if (tracks.length === 0) {
    throw new StreamingError("No playable tracks", "NO_TRACKS");
  }

  const listName =
    (selection.kind === "album" ? tracks[0]!.album : tracks[0]!.title) ??
    tracks[0]!.title ??
    "Amazon Music";
  await pushQueue(device, tracks, {
    listName,
    searchUrl: `https://${AMAZON_API_HOST}${path}`,
    userId: user.userId,
    // The catalog node's parseTracks order matches the detail view's
    // tracklist (detail.ts uses the same parser), so the UI's 1-based index
    // lines up. A lone track is a single-entry queue — start at 1.
    startIndex: selection.kind === "track" ? undefined : selection.startIndex,
  });
}
