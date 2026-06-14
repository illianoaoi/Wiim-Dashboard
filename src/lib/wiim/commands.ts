import "server-only";
import { wiimRequest, WiimError } from "./client";
import { Cmd, SUB_RANGES } from "./constants";
import {
  safeJson,
  parsePlayerStatus,
  parseDeviceInfo,
  parseSubwoofer,
  parseOutput,
  computeLoopMode,
  cleanMetaText,
} from "./parse";
import type {
  PlayerStatus,
  DeviceInfo,
  SubwooferStatus,
  OutputStatus,
} from "./types";
import { clamp } from "@/lib/utils";

async function send(ip: string, command: string, timeoutMs?: number): Promise<string> {
  const res = await wiimRequest(ip, command, { timeoutMs });
  if (res.status >= 400) {
    throw new WiimError(`Device returned HTTP ${res.status} for ${command}`, "HTTP_ERROR");
  }
  return res.text;
}

/** A setter succeeded if the device didn't explicitly reject the command. */
function assertAccepted(text: string, command: string): void {
  const t = text.trim().toLowerCase();
  if (t.includes("unknown command") || t.includes("not support")) {
    throw new WiimError(`Device does not support: ${command}`, "UNSUPPORTED");
  }
}

export async function fetchDeviceInfo(ip: string): Promise<DeviceInfo> {
  const text = await send(ip, Cmd.deviceStatus);
  const raw = safeJson<Record<string, unknown>>(text);
  if (!raw) throw new WiimError("Unparseable getStatusEx response", "PARSE");
  return parseDeviceInfo(raw);
}

export async function fetchPlayerStatus(ip: string): Promise<PlayerStatus> {
  const text = await send(ip, Cmd.playerStatus);
  const raw = safeJson<Record<string, unknown>>(text);
  if (!raw) throw new WiimError("Unparseable getPlayerStatusEx response", "PARSE");
  return parsePlayerStatus(raw);
}

export interface MetaInfo {
  albumArt: string | null; // raw albumArtURI from the device
  quality: string | null; // formatted "1730 kbps · 44.1 kHz · 24-bit"
  sampleRate: number | null; // Hz
  bitDepth: number | null; // bits
  bitRate: number | null; // kbps
  // Plain-text track metadata — used as a fallback when getPlayerStatusEx
  // leaves Title/Artist empty (e.g. Bluetooth fills these via AVRCP instead).
  title: string | null;
  artist: string | null;
  album: string | null;
}

const EMPTY_META: MetaInfo = {
  albumArt: null,
  quality: null,
  sampleRate: null,
  bitDepth: null,
  bitRate: null,
  title: null,
  artist: null,
  album: null,
};

/** Album art URL + quality string + raw audio numbers from getMetaInfo. */
export async function fetchMetaInfo(ip: string): Promise<MetaInfo> {
  try {
    const text = await send(ip, Cmd.metaInfo, 5000);
    const raw = safeJson<{ metaData?: Record<string, unknown> }>(text);
    const m = raw?.metaData;
    if (!m) return EMPTY_META;
    const artRaw = typeof m.albumArtURI === "string" ? m.albumArtURI.trim() : "";
    const artLower = artRaw.toLowerCase();
    const art = artRaw && artLower !== "unknow" && artLower !== "unknown" ? artRaw : null;
    // Fields are strings; firmware sometimes reports the literal "unknow".
    const sr = Number(m.sampleRate);
    const bd = Number(m.bitDepth);
    const br = Number(m.bitRate);
    const sampleRate = Number.isFinite(sr) && sr > 0 ? sr : null;
    const bitDepth = Number.isFinite(bd) && bd > 0 ? bd : null;
    // bitRate may be reported in bps or kbps depending on firmware.
    const bitRate =
      Number.isFinite(br) && br > 0 ? (br >= 100000 ? Math.round(br / 1000) : Math.round(br)) : null;

    const parts: string[] = [];
    // Order: bitrate · bit-depth · sample-rate  (e.g. "967 kbps · 16-bit · 44.1 kHz").
    if (bitRate != null) parts.push(`${bitRate} kbps`); // kbps only — no Mbps conversion
    if (bitDepth != null) parts.push(`${bitDepth}-bit`);
    if (sampleRate != null) {
      // kHz with up to 1 decimal, trimming a trailing ".0" (44.1, 48, 192).
      parts.push(`${(sampleRate / 1000).toFixed(1).replace(/\.0$/, "")} kHz`);
    }
    return {
      albumArt: art,
      quality: parts.join(" · ") || null,
      sampleRate,
      bitDepth,
      bitRate,
      title: cleanMetaText(m.title),
      artist: cleanMetaText(m.artist),
      album: cleanMetaText(m.album),
    };
  } catch {
    return EMPTY_META;
  }
}

export type ControlAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "prev"
  | "stop"
  | "seek"
  | "volume"
  | "mute"
  | "unmute"
  | "repeat"
  | "shuffle";

export async function control(
  ip: string,
  action: ControlAction,
  payload?: { value?: number; repeat?: "off" | "one" | "all"; shuffle?: boolean },
): Promise<void> {
  let command: string;
  switch (action) {
    case "play":
      command = Cmd.resume;
      break;
    case "pause":
      command = Cmd.pause;
      break;
    case "toggle":
      command = Cmd.toggle;
      break;
    case "next":
      command = Cmd.next;
      break;
    case "prev":
      command = Cmd.prev;
      break;
    case "stop":
      command = Cmd.stop;
      break;
    case "seek":
      command = Cmd.seek(payload?.value ?? 0);
      break;
    case "volume":
      command = Cmd.volume(clamp(payload?.value ?? 0, 0, 100));
      break;
    case "mute":
      command = Cmd.mute(true);
      break;
    case "unmute":
      command = Cmd.mute(false);
      break;
    case "repeat":
    case "shuffle":
      command = Cmd.loopMode(
        computeLoopMode(payload?.repeat ?? "off", payload?.shuffle ?? false),
      );
      break;
    default:
      throw new WiimError(`Unknown control action: ${action}`, "BAD_ACTION");
  }
  const text = await send(ip, command);
  assertAccepted(text, command);
}

// EQ lives in ./eq.ts (the per-source LV2 graphic + parametric API).

export async function fetchSubwoofer(ip: string): Promise<SubwooferStatus | null> {
  try {
    const text = await send(ip, Cmd.getSub, 5000);
    const raw = safeJson<Record<string, unknown>>(text);
    if (!raw || (raw.level == null && raw.status == null)) return null;
    return parseSubwoofer(raw);
  } catch {
    return null;
  }
}

export type SubParam = "level" | "cross" | "phase" | "sub_delay" | "status" | "main_filter" | "sub_filter";

export async function setSubwoofer(ip: string, param: SubParam, value: number): Promise<void> {
  let v = Math.trunc(value);
  if (param === "level") v = clamp(v, SUB_RANGES.level.min, SUB_RANGES.level.max);
  if (param === "cross") v = clamp(v, SUB_RANGES.cross.min, SUB_RANGES.cross.max);
  if (param === "sub_delay") v = clamp(v, SUB_RANGES.sub_delay.min, SUB_RANGES.sub_delay.max);
  if (param === "phase") v = v === 180 ? 180 : 0;
  if (param === "status" || param === "main_filter" || param === "sub_filter") v = v ? 1 : 0;
  const command = Cmd.setSub(param, v);
  const text = await send(ip, command);
  assertAccepted(text, command);
}

export async function fetchOutput(ip: string): Promise<OutputStatus | null> {
  try {
    const text = await send(ip, Cmd.getOutput, 5000);
    const raw = safeJson<Record<string, unknown>>(text);
    if (!raw || raw.hardware == null) return null;
    return parseOutput(raw);
  } catch {
    return null;
  }
}

export async function setOutput(ip: string, mode: number): Promise<void> {
  const command = Cmd.setOutput(mode);
  const text = await send(ip, command);
  assertAccepted(text, command);
}

export async function switchSource(ip: string, value: string): Promise<void> {
  const command = Cmd.switchMode(value);
  const text = await send(ip, command);
  assertAccepted(text, command);
}

interface RawPreset {
  number: number;
  name: string | null;
  picurl: string | null;
}

function pickPic(p: Record<string, unknown>): string | null {
  for (const k of ["picurl", "pic_url", "picUrl", "albumart", "albumArtURI", "img", "image"]) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Short-lived cache so the snapshot poll and the 12 preset-art image requests
// share ONE getPresetInfo call instead of hammering the embedded device.
const presetCache = new Map<string, { at: number; data: RawPreset[] }>();
const PRESET_TTL_MS = 30_000;

/** Raw preset slots reported by getPresetInfo (occupied slots only), cached. */
export async function getPresetList(ip: string): Promise<RawPreset[]> {
  const cached = presetCache.get(ip);
  if (cached && Date.now() - cached.at < PRESET_TTL_MS) return cached.data;
  try {
    const text = await send(ip, Cmd.getPresets, 5000);
    const raw = safeJson<{ preset_list?: Array<Record<string, unknown>> }>(text);
    const data = (raw?.preset_list ?? [])
      .map((p) => ({
        number: Number(p.number ?? p.preset_number ?? p.index),
        name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : null,
        picurl: pickPic(p),
      }))
      .filter((p) => Number.isFinite(p.number) && p.number > 0);
    presetCache.set(ip, { at: Date.now(), data });
    return data;
  } catch {
    // On failure, serve stale cache if we have it rather than dropping presets.
    return cached?.data ?? [];
  }
}

/** Build the preset slot list (1..count) with names + art flags. */
export async function fetchPresets(
  ip: string,
  count: number,
): Promise<import("./types").PresetItem[]> {
  const byNum = new Map<number, RawPreset>();
  if (count > 0) {
    for (const p of await getPresetList(ip)) byNum.set(p.number, p);
  }
  const items: import("./types").PresetItem[] = [];
  for (let i = 1; i <= count; i++) {
    const p = byNum.get(i);
    items.push({ index: i, name: p?.name ?? null, hasArt: !!p?.picurl });
  }
  return items;
}

/** Resolve the artwork URL for one preset slot (used by the art proxy). */
export async function fetchPresetArtUrl(ip: string, index: number): Promise<string | null> {
  const list = await getPresetList(ip);
  return list.find((p) => p.number === index)?.picurl ?? null;
}

export async function playPreset(ip: string, index: number): Promise<void> {
  const command = Cmd.playPreset(index);
  const text = await send(ip, command);
  assertAccepted(text, command);
}
