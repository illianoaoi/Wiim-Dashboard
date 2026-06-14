import "server-only";
import { wiimRequest, WiimError } from "./client";
import { safeJson } from "./parse";
import {
  EqCmd,
  EQ_PLUGIN,
  GRAPHIC_BANDS,
  PEQ_LETTERS,
  PEQ_DEFAULT_FREQ,
  CHANNEL_MODE_STEREO,
} from "./eq-constants";
import type {
  EqType,
  GraphicBand,
  ParametricBand,
  EqPresets,
  EqSourceState,
} from "./types";

interface RawEq {
  status?: string;
  EQStat?: string;
  Name?: string;
  pluginURI?: string;
  channelMode?: string;
  EQBand?: { param_name?: string; value?: number }[];
}

/** Run an EQ command; return parsed JSON, or null when the device rejects it. */
async function eqCall(ip: string, cmd: string, timeoutMs = 6000): Promise<RawEq | null> {
  let text: string;
  try {
    text = (await wiimRequest(ip, cmd, { timeoutMs })).text;
  } catch {
    return null;
  }
  const lower = text.toLowerCase();
  if (lower.includes("unknown command") || lower.includes("not support")) return null;
  const j = safeJson<RawEq>(text);
  if (!j) return null;
  if (typeof j.status === "string" && j.status.toLowerCase() === "failed") return null;
  return j;
}

function bandMap(raw: RawEq): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of raw.EQBand ?? []) {
    if (b.param_name != null && typeof b.value === "number") m.set(b.param_name, b.value);
  }
  return m;
}

function parseGraphic(raw: RawEq): { name: string; bands: GraphicBand[] } {
  const m = bandMap(raw);
  return {
    name: raw.Name ?? "",
    bands: GRAPHIC_BANDS.map((b) => ({ param: b.param, label: b.label, gain: m.get(b.param) ?? 0 })),
  };
}

function parseParametric(raw: RawEq): {
  name: string;
  channelMode: string;
  bands: ParametricBand[];
} {
  const m = bandMap(raw);
  return {
    name: raw.Name ?? "",
    channelMode: raw.channelMode ?? CHANNEL_MODE_STEREO,
    bands: PEQ_LETTERS.map((l) => ({
      letter: l,
      mode: Math.round(m.get(`${l}_mode`) ?? 1),
      frequency: m.get(`${l}_freq`) ?? PEQ_DEFAULT_FREQ[l] ?? 1000,
      q: m.get(`${l}_q`) ?? 0.25,
      gain: m.get(`${l}_gain`) ?? 0,
    })),
  };
}

function isOn(raw: RawEq | null): boolean {
  return !!raw && String(raw.EQStat).toLowerCase() === "on";
}

/** True if the device exposes the LV2 EQ API at all (kill-switch). */
export async function eqSupported(ip: string): Promise<boolean> {
  return (await eqCall(ip, EqCmd.getBand(EQ_PLUGIN.graphic), 5000)) !== null;
}

/** Read full EQ state (graphic + parametric) for one source. */
export async function getSourceState(ip: string, source: string): Promise<EqSourceState | null> {
  const [g, p] = await Promise.all([
    eqCall(ip, EqCmd.getSourceBand(source, EQ_PLUGIN.graphic)),
    eqCall(ip, EqCmd.getSourceBand(source, EQ_PLUGIN.parametric)),
  ]);
  if (!g && !p) return null;

  const graphicOn = isOn(g);
  const parametricOn = isOn(p);
  const activeType: EqType | null = graphicOn ? "graphic" : parametricOn ? "parametric" : null;

  return {
    source,
    enabled: graphicOn || parametricOn,
    activeType,
    graphic: g ? parseGraphic(g) : { name: "", bands: parseGraphic({}).bands },
    parametric: p
      ? parseParametric(p)
      : { name: "", channelMode: CHANNEL_MODE_STEREO, bands: parseParametric({}).bands },
  };
}

export async function getPresets(ip: string, type: EqType): Promise<EqPresets> {
  const raw = await eqCall(ip, EqCmd.list(EQ_PLUGIN[type]));
  const data = (raw as unknown as { custom?: unknown[]; preset?: unknown[] }) ?? {};
  return {
    custom: Array.isArray(data.custom) ? data.custom.map(String) : [],
    preset: Array.isArray(data.preset) ? data.preset.map(String) : [],
  };
}

// --- mutations ---------------------------------------------------------------

function assertOk(raw: RawEq | null, what: string): void {
  if (raw === null) throw new WiimError(`EQ command rejected: ${what}`, "UNSUPPORTED");
}

/** Set one or more graphic band gains (dB). Enables + switches the source to graphic. */
export async function setGraphicBands(
  ip: string,
  source: string,
  bands: { param: string; gain: number }[],
): Promise<void> {
  const payload = {
    source_name: source,
    pluginURI: EQ_PLUGIN.graphic,
    channelMode: CHANNEL_MODE_STEREO,
    EQBand: bands.map((b) => ({ param_name: b.param, value: clampGain(b.gain) })),
  };
  assertOk(await eqCall(ip, EqCmd.setSourceBand(payload)), "setGraphicBands");
}

/** Update one parametric band (any subset of mode/freq/q/gain). */
export async function setParametricBand(
  ip: string,
  source: string,
  letter: string,
  params: { mode?: number; frequency?: number; q?: number; gain?: number },
): Promise<void> {
  const eqBand: { param_name: string; value: number }[] = [];
  if (params.mode != null) eqBand.push({ param_name: `${letter}_mode`, value: params.mode });
  if (params.frequency != null) eqBand.push({ param_name: `${letter}_freq`, value: params.frequency });
  if (params.q != null) eqBand.push({ param_name: `${letter}_q`, value: params.q });
  if (params.gain != null) eqBand.push({ param_name: `${letter}_gain`, value: clampGain(params.gain) });
  if (eqBand.length === 0) return;
  const payload = {
    source_name: source,
    pluginURI: EQ_PLUGIN.parametric,
    channelMode: CHANNEL_MODE_STEREO,
    EQBand: eqBand,
  };
  assertOk(await eqCall(ip, EqCmd.setSourceBand(payload)), "setParametricBand");
}

export async function setEnabled(
  ip: string,
  source: string,
  type: EqType,
  enabled: boolean,
): Promise<void> {
  const cmd = enabled
    ? EqCmd.changeSourceFx(source, EQ_PLUGIN[type])
    : EqCmd.sourceOff(source, EQ_PLUGIN[type]);
  assertOk(await eqCall(ip, cmd), "setEnabled");
}

export async function loadPreset(
  ip: string,
  source: string,
  type: EqType,
  name: string,
): Promise<void> {
  assertOk(await eqCall(ip, EqCmd.sourceLoad(source, EQ_PLUGIN[type], name)), "loadPreset");
}

export async function savePreset(
  ip: string,
  source: string,
  type: EqType,
  name: string,
): Promise<void> {
  assertOk(await eqCall(ip, EqCmd.sourceSave(source, EQ_PLUGIN[type], name)), "savePreset");
}

export async function deletePreset(ip: string, type: EqType, name: string): Promise<void> {
  assertOk(await eqCall(ip, EqCmd.delete(EQ_PLUGIN[type], name)), "deletePreset");
}

export async function renamePreset(
  ip: string,
  type: EqType,
  name: string,
  newName: string,
): Promise<void> {
  assertOk(await eqCall(ip, EqCmd.rename(EQ_PLUGIN[type], name, newName)), "renamePreset");
}

function clampGain(g: number): number {
  return Math.max(-12, Math.min(12, Math.round(g * 10) / 10));
}
