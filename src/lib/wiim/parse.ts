import {
  PLAYING_STATUS,
  PLAYING_MODE_LABEL,
  NETWORK_PLAY_MODES,
  SOURCES,
} from "./constants";
import type {
  PlayerStatus,
  DeviceInfo,
  SubwooferStatus,
  OutputStatus,
  PlaybackState,
} from "./types";

/** Tolerant JSON parse — WiiM payloads are JSON but occasionally have noise. */
export function safeJson<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Trim to the outermost {...} / [...] and retry.
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** WiiM hex-encodes Title/Artist/Album (UTF-8 bytes). Decode when it looks hex. */
export function decodeMaybeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "unknown" || lower === "un_known" || lower === "none") return null;
  if (s.length >= 2 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s)) {
    try {
      const decoded = Buffer.from(s, "hex").toString("utf8").replace(/\0+$/g, "");
      // If decoding produced mostly replacement chars, keep the raw value.
      if (decoded && !/�{2,}/.test(decoded)) {
        const t = decoded.trim();
        const tl = t.toLowerCase();
        if (!t || tl === "unknown" || tl === "un_known") return null;
        return t;
      }
    } catch {
      /* fall through */
    }
  }
  return s;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nonZero(v: unknown): boolean {
  const s = typeof v === "string" ? v.trim() : "";
  return !!s && s !== "0.0.0.0";
}

/** Map the read-side `loop` field to {repeat, shuffle}. */
function parseLoop(loop: number): { repeat: "off" | "one" | "all"; shuffle: boolean } {
  switch (loop) {
    case -1:
      return { repeat: "one", shuffle: false };
    case 1:
      return { repeat: "all", shuffle: false };
    case 2:
      return { repeat: "off", shuffle: true };
    case 3:
      return { repeat: "all", shuffle: true };
    case 5:
      return { repeat: "one", shuffle: true };
    case 0:
    case 4:
    default:
      return { repeat: "off", shuffle: false };
  }
}

/** Inverse: compute the loopmode value to write for a desired repeat/shuffle. */
export function computeLoopMode(repeat: "off" | "one" | "all", shuffle: boolean): number {
  if (repeat === "one") return shuffle ? 5 : -1;
  if (repeat === "all") return shuffle ? 3 : 1;
  return shuffle ? 2 : 0;
}

export function parsePlayerStatus(raw: Record<string, unknown>): PlayerStatus {
  const statusKey = String(raw.status ?? "stop").toLowerCase();
  const state: PlaybackState =
    (PLAYING_STATUS as Record<string, PlaybackState>)[statusKey] ?? "stopped";

  const sourceMode = String(raw.mode ?? "0");
  const sourceLabel = PLAYING_MODE_LABEL[sourceMode] ?? "Unknown";
  let sourceKey: string | null = null;
  if (NETWORK_PLAY_MODES.has(sourceMode)) {
    sourceKey = "wifi";
  } else {
    sourceKey = SOURCES.find((s) => s.modes.includes(sourceMode))?.key ?? null;
  }

  const { repeat, shuffle } = parseLoop(num(raw.loop, 0));

  return {
    state,
    title: decodeMaybeHex(raw.Title),
    artist: decodeMaybeHex(raw.Artist),
    album: decodeMaybeHex(raw.Album),
    albumArt: null, // filled from getMetaInfo
    position: Math.round(num(raw.curpos) / 1000),
    duration: Math.round(num(raw.totlen) / 1000),
    volume: Math.round(num(raw.vol)),
    muted: String(raw.mute) === "1",
    sourceMode,
    sourceLabel,
    sourceKey,
    repeat,
    shuffle,
    eqIndex: num(raw.eq, 0),
    quality: null,
  };
}

/** Pick the active (non-zero) interface address. */
function pickIp(raw: Record<string, unknown>): string {
  const candidates = [raw.apcli0, raw.eth0, raw.eth2, raw.ra0];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s && s !== "0.0.0.0") return s;
  }
  return "";
}

const MODEL_NAMES: Record<string, string> = {
  Muzo_Mini: "WiiM Mini",
  WiiM_Mini: "WiiM Mini",
  WiiM_Pro: "WiiM Pro",
  WiiM_Pro_Plus: "WiiM Pro Plus",
  WiiM_Amp: "WiiM Amp",
  WiiM_Amp_Pro: "WiiM Amp Pro",
  WiiM_Amp_Ultra: "WiiM Amp Ultra",
  WiiM_Ultra: "WiiM Ultra",
  Vibelink_Amp: "Vibelink Amp",
};

function friendlyModel(project: string, priv: string): string {
  if (project && MODEL_NAMES[project]) return MODEL_NAMES[project];
  const src = project || priv;
  if (!src) return "WiiM Device";
  return src.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function parseDeviceInfo(raw: Record<string, unknown>): DeviceInfo {
  const project = String(raw.project ?? "");
  const priv = String(raw.priv_prj ?? "");
  const tCpu = raw.temperature_cpu;
  const tBoard = raw.temperature_tmp102;
  return {
    name: String(raw.DeviceName ?? raw.ssid ?? "WiiM Device"),
    model: friendlyModel(project, priv),
    project,
    firmware: String(raw.firmware ?? raw.Release ?? ""),
    mac: String(raw.MAC ?? raw.STA_MAC ?? raw.ETH_MAC ?? ""),
    uuid: String(raw.uuid ?? raw.upnp_uuid ?? ""),
    ip: pickIp(raw),
    rssi: raw.RSSI != null && raw.RSSI !== "" ? num(raw.RSSI) : null,
    internet: String(raw.internet) === "1",
    network: nonZero(raw.eth0) ? "ethernet" : nonZero(raw.apcli0) ? "wifi" : null,
    group: String(raw.group ?? "0"),
    temperatureCpu: tCpu != null && tCpu !== "" ? num(tCpu) : null,
    temperatureBoard: tBoard != null && tBoard !== "" ? num(tBoard) : null,
    presetCount: Math.max(0, Math.trunc(num(raw.preset_key))),
  };
}

export function parseSubwoofer(raw: Record<string, unknown>): SubwooferStatus {
  return {
    enabled: String(raw.status) === "1",
    connected: String(raw.plugged) === "1",
    level: num(raw.level),
    crossover: num(raw.cross, 80),
    phase: num(raw.phase),
    delay: num(raw.sub_delay),
    mainBassFilter: raw.main_filter != null ? String(raw.main_filter) === "1" : null,
    subBypass: raw.sub_filter != null ? String(raw.sub_filter) === "1" : null,
  };
}

export function parseOutput(raw: Record<string, unknown>): OutputStatus {
  return {
    hardware: num(raw.hardware, 2),
    bluetoothSource: String(raw.source) === "1",
    audioCast: String(raw.audiocast) === "1",
  };
}

/** EQGetStat → enabled? (handles {"EQStat":"On"} and plain "On"/"OK"). */
export function parseEqStat(text: string): boolean {
  const j = safeJson<{ EQStat?: string }>(text);
  if (j?.EQStat) return j.EQStat.toLowerCase() === "on";
  return /(^|[^a-z])on([^a-z]|$)/i.test(text);
}

/** EQGetList → array of preset names. */
export function parseEqList(text: string): string[] {
  const j = safeJson<unknown>(text);
  if (Array.isArray(j)) return j.map(String).filter(Boolean);
  return [];
}
