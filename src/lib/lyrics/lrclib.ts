import "server-only";
import type { LyricLine } from "@/lib/wiim/types";

/**
 * Lyrics lookup via LRCLIB (https://lrclib.net) — a free, key-less community
 * lyrics database. Two-tier: `/api/get` (strict exact match on
 * artist+track+album+duration) then `/api/search` as a fallback, because
 * `/api/get` 404s on ANY album-name mismatch (deluxe/single/regional titles)
 * even when the song exists under a different album title — which showed up as
 * "No lyrics found" for real, popular tracks. `/api/search` doesn't require an
 * album, so it recovers those; candidates are scored by synced-availability +
 * duration closeness rather than raw relevance order.
 *
 * Timeout is 12s (not the usual sub-second budget): LRCLIB is a small,
 * volunteer-run service whose queries routinely take 7–10s. Lyrics are fetched
 * on demand (not in the poll loop), behind a spinner, and cached per track, so
 * the latency is a one-time cost. Transient failures (timeout / network / 5xx)
 * are NOT cached — only resolved hits and misses — so one hiccup doesn't mark a
 * track as permanently lyric-less until restart.
 */

const GET_ENDPOINT = "https://lrclib.net/api/get";
const SEARCH_ENDPOINT = "https://lrclib.net/api/search";
const UA = "Wiim-Dashboard (https://github.com/illianoaoi/Wiim-Dashboard)";
const TIMEOUT_MS = 12000;

export interface LyricsResult {
  synced: LyricLine[] | null;
  plain: string | null;
}

interface LrclibTrack {
  duration?: number | null;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

/** A lookup step's outcome. `transient` = a network/timeout/5xx error, so the
 *  caller must not cache a resulting empty (retry next time). `result === null`
 *  means "nothing usable from this step" — a resolved 404 miss OR a transient
 *  error, disambiguated by `transient`. */
interface Lookup {
  result: LyricsResult | null;
  transient: boolean;
}

const EMPTY: LyricsResult = { synced: null, plain: null };
const cache = new Map<string, LyricsResult>();

const TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(TAG)];
    if (!tags.length) continue; // skips metadata tags like [ar:] / [ti:]
    const text = raw.replace(TAG, "").trim();
    for (const m of tags) {
      const frac = m[3] ? Number((m[3] + "000").slice(0, 3)) / 1000 : 0;
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return lines;
}

function toResult(track: LrclibTrack): LyricsResult {
  const synced = track.syncedLyrics ? parseLrc(track.syncedLyrics) : null;
  return {
    synced: synced && synced.length ? synced : null,
    plain: track.plainLyrics?.trim() || null,
  };
}

/** Strict exact-match lookup. A 404 is a resolved miss (fall back to search);
 *  a timeout/5xx is flagged transient so the caller doesn't cache it. */
async function getExact(
  artist: string,
  track: string,
  album: string,
  durationSec: number,
): Promise<Lookup> {
  try {
    const url =
      `${GET_ENDPOINT}?artist_name=${encodeURIComponent(artist)}` +
      `&track_name=${encodeURIComponent(track)}` +
      (album ? `&album_name=${encodeURIComponent(album)}` : "") +
      (durationSec > 0 ? `&duration=${Math.round(durationSec)}` : "");
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return { result: null, transient: false }; // resolved miss → try search
    if (!res.ok) return { result: null, transient: true };
    return { result: toResult((await res.json()) as LrclibTrack), transient: false };
  } catch {
    return { result: null, transient: true };
  }
}

/** Fuzzy fallback — no album, so it survives album-name mismatches. Scores
 *  candidates (synced strongly preferred, then closest duration; anything more
 *  than 15s off is discarded as a likely different version). */
async function searchFallback(
  artist: string,
  track: string,
  durationSec: number,
): Promise<Lookup> {
  try {
    const url =
      `${SEARCH_ENDPOINT}?artist_name=${encodeURIComponent(artist)}` +
      `&track_name=${encodeURIComponent(track)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { result: null, transient: true };
    const candidates = (await res.json()) as LrclibTrack[];
    if (!Array.isArray(candidates) || !candidates.length) return { result: EMPTY, transient: false };

    let best: LrclibTrack | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      if (c.instrumental) continue;
      const durDiff = durationSec > 0 && c.duration != null ? Math.abs(c.duration - durationSec) : 0;
      if (durationSec > 0 && c.duration != null && durDiff > 15) continue; // likely a different version
      const score = durDiff - (c.syncedLyrics ? 1000 : 0); // synced preferred, then closest duration
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // Nothing survived the filters — fall back to the API's own top non-instrumental hit.
    if (!best) best = candidates.find((c) => !c.instrumental) ?? null;
    return { result: best ? toResult(best) : EMPTY, transient: false };
  } catch {
    return { result: null, transient: true };
  }
}

export async function fetchLyrics(
  artist: string,
  track: string,
  album: string,
  durationSec: number,
): Promise<LyricsResult> {
  const key = `${artist}|${track}|${album}|${Math.round(durationSec)}`.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const g = await getExact(artist, track, album, durationSec);
  let result = g.result;
  let transient = g.transient;
  if (!result) {
    const s = await searchFallback(artist, track, durationSec);
    result = s.result;
    transient = transient || s.transient;
  }

  const final = result ?? EMPTY;
  const hasLyrics = !!(final.synced || final.plain);
  // Cache resolved outcomes (found lyrics, or a confident "no lyrics"), but NOT
  // a transient failure — otherwise one timeout marks the track permanently
  // lyric-less until the process restarts.
  if (hasLyrics || !transient) {
    if (cache.size > 200) cache.clear();
    cache.set(key, final);
  }
  return final;
}
