import "server-only";
import { listDevices } from "@/lib/db/devices";
import { getLastfm } from "@/lib/db/settings";
import { fetchPlayerStatus, fetchMetaInfo } from "@/lib/wiim/commands";
import * as lastfm from "@/lib/lastfm/client";

/**
 * Server-side Last.fm scrobbler. Runs independently of any open browser tab,
 * polls each scrobble-enabled device, and:
 *  - sends `track.updateNowPlaying` when a track changes;
 *  - sends `track.scrobble` once a track passes Last.fm's eligibility rule
 *    (length > 30s AND played ≥ half its length or 4 min, whichever first).
 *
 * Started from instrumentation (server boot) and, as a fallback, lazily from
 * API routes — `startScrobblePoller()` is idempotent.
 */

const POLL_MS = 15_000;
const START_DELAY_MS = 5_000;
const log = (msg: string, ...a: unknown[]) => console.info(`[scrobbler] ${msg}`, ...a);

interface TrackState {
  key: string; // artist title album
  startedAt: number; // unix seconds the track (re)started playing
  duration: number; // seconds
  position: number; // last seen position (seconds)
  scrobbled: boolean;
}

const states = new Map<string, TrackState>();
const g = globalThis as unknown as { __wiimScrobblerStarted?: boolean };
let running = false;

export function startScrobblePoller(): void {
  if (g.__wiimScrobblerStarted) return;
  g.__wiimScrobblerStarted = true;
  log(`starting — polling every ${POLL_MS / 1000}s`);
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), POLL_MS);
  }, START_DELAY_MS);
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const lf = getLastfm();
    if (!lf.apiKey || !lf.apiSecret || !lf.sessionKey) return;
    const creds: lastfm.LastfmCreds = {
      apiKey: lf.apiKey,
      apiSecret: lf.apiSecret,
      sessionKey: lf.sessionKey,
    };
    const devices = listDevices().filter((d) => lf.scrobbleDevices[d.id]);
    if (devices.length === 0) return;
    for (const d of devices) {
      try {
        await processDevice(d.id, d.host, creds);
      } catch (e) {
        log(`device ${d.id.slice(0, 8)} error:`, (e as Error)?.message ?? e);
      }
    }
  } catch (e) {
    log("tick error:", (e as Error)?.message ?? e);
  } finally {
    running = false;
  }
}

async function processDevice(id: string, host: string, creds: lastfm.LastfmCreds): Promise<void> {
  const p = await fetchPlayerStatus(host);
  if (p.state !== "playing") return;

  let title = p.title;
  let artist = p.artist;
  let album = p.album;
  if (!title || !artist) {
    // e.g. Bluetooth — metadata arrives via getMetaInfo (AVRCP), not getPlayerStatusEx.
    const meta = await fetchMetaInfo(host);
    title = title ?? meta.title;
    artist = artist ?? meta.artist;
    album = album ?? meta.album;
  }
  if (!title || !artist) return; // nothing to scrobble

  const key = `${artist} ${title} ${album ?? ""}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const prev = states.get(id);

  if (!prev || prev.key !== key) {
    // New track → record start + announce now-playing.
    states.set(id, {
      key,
      startedAt: nowSec - Math.max(0, p.position),
      duration: p.duration,
      position: p.position,
      scrobbled: false,
    });
    try {
      await lastfm.updateNowPlaying(creds, { artist, track: title, album, duration: p.duration });
      log(`now playing → ${artist} — ${title}`);
    } catch (e) {
      log("updateNowPlaying failed:", (e as Error)?.message ?? e);
    }
    return;
  }

  // Same track. A backward jump means a replay → eligible to scrobble again.
  if (p.position + 5 < prev.position) {
    prev.startedAt = nowSec - Math.max(0, p.position);
    prev.scrobbled = false;
  }
  prev.position = p.position;
  if (p.duration > 0) prev.duration = p.duration;

  if (!prev.scrobbled) {
    // Known duration (streaming): half the track or 4 min. Unknown duration
    // (e.g. Bluetooth reports no position/length): fall back to wall-clock —
    // ~90s of continuous play of the same track.
    const eligible =
      prev.duration > 30
        ? p.position >= Math.min(prev.duration / 2, 240)
        : nowSec - prev.startedAt >= 90;
    if (eligible) {
      prev.scrobbled = true; // mark first to avoid double-submit on overlap
      try {
        await lastfm.scrobble(creds, {
          artist,
          track: title,
          album,
          duration: prev.duration > 0 ? prev.duration : undefined,
          timestamp: prev.startedAt,
        });
        log(`scrobbled ✓ ${artist} — ${title}`);
      } catch (e) {
        prev.scrobbled = false; // retry next tick
        log("scrobble failed:", (e as Error)?.message ?? e);
      }
    }
  }
}
