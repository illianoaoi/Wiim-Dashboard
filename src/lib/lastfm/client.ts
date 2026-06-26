import "server-only";
import { createHash } from "node:crypto";

/**
 * Minimal Last.fm Audioscrobbler 2.0 client.
 * Docs: https://www.last.fm/api — auth flow, signing, scrobbling rules.
 */

const ENDPOINT = "https://ws.audioscrobbler.com/2.0/";

export class LastfmError extends Error {
  code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.name = "LastfmError";
    this.code = code;
  }
}

export interface LastfmCreds {
  apiKey: string;
  apiSecret: string;
  sessionKey?: string;
}

/** api_sig = md5( sorted(name+value, excl. format/callback) + secret ), UTF-8. */
function sign(params: Record<string, string>, secret: string): string {
  const base =
    Object.keys(params)
      .filter((k) => k !== "format" && k !== "callback")
      .sort()
      .map((k) => k + (params[k] ?? ""))
      .join("") + secret;
  return createHash("md5").update(base, "utf8").digest("hex");
}

async function call(
  method: string,
  params: Record<string, string>,
  creds: LastfmCreds,
  post: boolean,
): Promise<Record<string, unknown>> {
  const all: Record<string, string> = { ...params, method, api_key: creds.apiKey };
  if (creds.sessionKey) all.sk = creds.sessionKey;
  all.api_sig = sign(all, creds.apiSecret);
  all.format = "json";
  const usp = new URLSearchParams(all);

  const res = post
    ? await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: usp,
      })
    : await fetch(`${ENDPOINT}?${usp.toString()}`);

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = typeof data.error === "number" ? (data.error as number) : undefined;
  if (!res.ok || err) {
    throw new LastfmError(
      typeof data.message === "string" ? data.message : `Last.fm HTTP ${res.status}`,
      err ?? res.status,
    );
  }
  return data;
}

/** Step 1 of the desktop auth flow. */
export async function getToken(creds: LastfmCreds): Promise<string> {
  const d = await call("auth.getToken", {}, creds, false);
  return String(d.token ?? "");
}

/** The page the user visits to authorize the app. */
export function authorizeUrl(apiKey: string, token: string): string {
  return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;
}

/** Step 2: exchange an authorized token for a permanent session key. */
export async function getSession(
  creds: LastfmCreds,
  token: string,
): Promise<{ sessionKey: string; username: string }> {
  const d = await call("auth.getSession", { token }, creds, false);
  const s = (d.session ?? {}) as { key?: string; name?: string };
  return { sessionKey: String(s.key ?? ""), username: String(s.name ?? "") };
}

export interface ScrobbleTrack {
  artist: string;
  track: string;
  album?: string | null;
  duration?: number | null; // seconds
  timestamp?: number; // unix seconds (play start) — scrobble only
}

export async function updateNowPlaying(creds: LastfmCreds, t: ScrobbleTrack): Promise<void> {
  const p: Record<string, string> = { artist: t.artist, track: t.track };
  if (t.album) p.album = t.album;
  if (t.duration && t.duration > 0) p.duration = String(Math.round(t.duration));
  await call("track.updateNowPlaying", p, creds, true);
}

export async function scrobble(creds: LastfmCreds, t: ScrobbleTrack): Promise<void> {
  const p: Record<string, string> = {
    artist: t.artist,
    track: t.track,
    timestamp: String(t.timestamp ?? Math.floor(Date.now() / 1000)),
  };
  if (t.album) p.album = t.album;
  if (t.duration && t.duration > 0) p.duration = String(Math.round(t.duration));
  await call("track.scrobble", p, creds, true);
}

/** Whether `username` has loved this track (track.getInfo — public, unsigned). */
export async function getTrackLoved(
  creds: LastfmCreds,
  artist: string,
  track: string,
  username: string,
): Promise<boolean> {
  const usp = new URLSearchParams({
    method: "track.getInfo",
    api_key: creds.apiKey,
    artist,
    track,
    username,
    autocorrect: "1",
    format: "json",
  });
  const res = await fetch(`${ENDPOINT}?${usp.toString()}`);
  const data = (await res.json().catch(() => ({}))) as { track?: { userloved?: string } };
  return data.track?.userloved === "1";
}

/** track.love / track.unlove. */
export async function love(
  creds: LastfmCreds,
  artist: string,
  track: string,
  on: boolean,
): Promise<void> {
  await call(on ? "track.love" : "track.unlove", { artist, track }, creds, true);
}

export interface LastfmStatItem {
  name: string;
  artist?: string; // top tracks only
  playcount: number;
  url: string;
}

export interface LastfmStats {
  topArtists: LastfmStatItem[];
  topTracks: LastfmStatItem[];
  totalScrobbles: number | null;
}

/**
 * The user's top artists/tracks for a period + total scrobbles. These are
 * public read methods (api_key + user, no signature). `period` is one of
 * 7day / 1month / 3month / 6month / 12month / overall.
 */
export async function getStats(
  apiKey: string,
  username: string,
  period: string,
  limit = 8,
): Promise<LastfmStats> {
  const pub = async (method: string, extra: Record<string, string>) => {
    const usp = new URLSearchParams({ method, api_key: apiKey, user: username, format: "json", ...extra });
    const res = await fetch(`${ENDPOINT}?${usp.toString()}`, { signal: AbortSignal.timeout(7000) });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  };

  const [ta, tt, info] = await Promise.allSettled([
    pub("user.getTopArtists", { period, limit: String(limit) }),
    pub("user.getTopTracks", { period, limit: String(limit) }),
    pub("user.getInfo", {}),
  ]);

  const topArtists: LastfmStatItem[] =
    ta.status === "fulfilled"
      ? asArray((ta.value.topartists as { artist?: unknown } | undefined)?.artist).map((a) => ({
          name: str(a.name),
          playcount: num(a.playcount),
          url: str(a.url),
        }))
      : [];

  const topTracks: LastfmStatItem[] =
    tt.status === "fulfilled"
      ? asArray((tt.value.toptracks as { track?: unknown } | undefined)?.track).map((t) => ({
          name: str(t.name),
          artist: str((t.artist as { name?: unknown } | undefined)?.name) || undefined,
          playcount: num(t.playcount),
          url: str(t.url),
        }))
      : [];

  let totalScrobbles: number | null = null;
  if (info.status === "fulfilled") {
    const pc = (info.value.user as { playcount?: unknown } | undefined)?.playcount;
    totalScrobbles = pc != null ? num(pc) : null;
  }

  return { topArtists, topTracks, totalScrobbles };
}

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
