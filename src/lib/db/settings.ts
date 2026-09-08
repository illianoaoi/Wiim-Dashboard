import "server-only";
import { getDb } from "./index";

/** Generic key/value settings stored as JSON. */
export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting<T>(key: string, value: T): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, JSON.stringify(value));
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// --- typed settings helpers --------------------------------------------------

export interface TurnstileSettings {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
}

export interface AppSettings {
  pollIntervalMs: number;
}

export interface CardVisibility {
  nowPlaying: boolean;
  presets: boolean;
  eq: boolean;
  source: boolean;
  output: boolean;
  sub: boolean;
  temperature: boolean;
  device: boolean;
}

export const DEFAULT_CARDS: CardVisibility = {
  nowPlaying: true,
  presets: true,
  eq: true,
  source: true,
  output: true,
  sub: true,
  temperature: true,
  device: true,
};

export const SettingKeys = {
  turnstile: "turnstile",
  app: "app",
  sourceLabels: "sourceLabels",
  cards: "cards",
  lastfm: "lastfm",
  artHosts: "artHosts",
} as const;

/**
 * Trusted artwork hosts — `host:port` entries whose cover art the server may
 * fetch even though they are LAN addresses (a local media server: JRiver, Plex,
 * Roon…). Empty by default: without an entry, LAN artwork is only fetched from
 * the WiiM device itself. Entries are validated on write (must resolve to a
 * private address that is not loopback / link-local / metadata / CGNAT) and
 * re-checked at request time. See wiim/client.ts `wiimFetchRaw`.
 */
export const MAX_ART_HOSTS = 8;

export function getArtHosts(): string[] {
  const raw = getSetting<unknown>(SettingKeys.artHosts, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string").slice(0, MAX_ART_HOSTS);
}

export function setArtHosts(hosts: string[]): void {
  setSetting(SettingKeys.artHosts, hosts.slice(0, MAX_ART_HOSTS));
}

/**
 * Last.fm integration. `apiKey`/`apiSecret` are the registered app credentials;
 * `sessionKey` is the per-user scrobbling session (never expires) from the auth
 * flow; `scrobbleDevices` maps deviceId → enabled. Secrets (apiSecret,
 * sessionKey, pendingToken) are server-only — never sent to the client.
 */
export interface LastfmSettings {
  apiKey: string;
  apiSecret: string;
  sessionKey: string;
  username: string;
  pendingToken: string; // transient token during the connect flow
  scrobbleDevices: Record<string, boolean>;
}

export const DEFAULT_LASTFM: LastfmSettings = {
  apiKey: "",
  apiSecret: "",
  sessionKey: "",
  username: "",
  pendingToken: "",
  scrobbleDevices: {},
};

export function getLastfm(): LastfmSettings {
  return { ...DEFAULT_LASTFM, ...getSetting<Partial<LastfmSettings>>(SettingKeys.lastfm, {}) };
}

export function setLastfm(patch: Partial<LastfmSettings>): LastfmSettings {
  const next = { ...getLastfm(), ...patch };
  setSetting(SettingKeys.lastfm, next);
  return next;
}

/**
 * Per-device custom source names. The WiiM API doesn't expose the input
 * aliases set in the WiiM app, so the dashboard stores its own overrides:
 * { [deviceId]: { [sourceKey]: label } }.
 */
type SourceLabelMap = Record<string, Record<string, string>>;

export function getSourceLabels(deviceId: string): Record<string, string> {
  const all = getSetting<SourceLabelMap>(SettingKeys.sourceLabels, {});
  return all[deviceId] ?? {};
}

export function setSourceLabels(deviceId: string, labels: Record<string, string>): void {
  const all = getSetting<SourceLabelMap>(SettingKeys.sourceLabels, {});
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v === "string" && v.trim()) clean[k] = v.trim().slice(0, 32);
  }
  all[deviceId] = clean;
  setSetting(SettingKeys.sourceLabels, all);
}

export function deleteSourceLabels(deviceId: string): void {
  const all = getSetting<SourceLabelMap>(SettingKeys.sourceLabels, {});
  if (deviceId in all) {
    delete all[deviceId];
    setSetting(SettingKeys.sourceLabels, all);
  }
}
