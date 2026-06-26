import "server-only";
import type { LyricLine } from "@/lib/wiim/types";

/**
 * Lyrics lookup via LRCLIB (https://lrclib.net) — a free, key-less, community
 * lyrics database. Matches by artist/track/album/duration and returns timed
 * (synced) lines when available, plus the plain text as a fallback. Results are
 * cached in-memory (lyrics are static) so we don't re-hit LRCLIB every poll.
 */

const ENDPOINT = "https://lrclib.net/api/get";
const UA = "Wiim-Dashboard (https://github.com/illianoaoi/Wiim-Dashboard)";

export interface LyricsResult {
  synced: LyricLine[] | null;
  plain: string | null;
}

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

export async function fetchLyrics(
  artist: string,
  track: string,
  album: string,
  durationSec: number,
): Promise<LyricsResult> {
  const key = `${artist}|${track}|${album}|${Math.round(durationSec)}`.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const empty: LyricsResult = { synced: null, plain: null };
  try {
    const url =
      `${ENDPOINT}?artist_name=${encodeURIComponent(artist)}` +
      `&track_name=${encodeURIComponent(track)}` +
      (album ? `&album_name=${encodeURIComponent(album)}` : "") +
      (durationSec > 0 ? `&duration=${Math.round(durationSec)}` : "");
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      cache.set(key, empty); // cache "not found" too (404 is common)
      return empty;
    }
    const data = (await res.json()) as {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
    };
    const synced = data.syncedLyrics ? parseLrc(data.syncedLyrics) : null;
    const result: LyricsResult = {
      synced: synced && synced.length ? synced : null,
      plain: data.plainLyrics?.trim() || null,
    };
    if (cache.size > 200) cache.clear();
    cache.set(key, result);
    return result;
  } catch {
    return empty; // transient error — don't cache
  }
}
