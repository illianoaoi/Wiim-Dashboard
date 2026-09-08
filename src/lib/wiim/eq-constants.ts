import type { EqType } from "./types";

/**
 * WiiM "EQ v2" (LV2) constants — graphic (Eq10HP) + parametric (EqNp).
 * Verified live on WiiM Ultra fw 5.2.x. All values are real dB/Hz via the
 * LV2 endpoints. These commands are UNDOCUMENTED; the EQ feature self-disables
 * if a device/firmware stops answering them.
 */

export const EQ_PLUGIN: Record<EqType, string> = {
  graphic: "http://moddevices.com/plugins/caps/Eq10HP",
  parametric: "http://moddevices.com/plugins/caps/EqNp",
};

export const EQ_PLUGIN_TO_TYPE: Record<string, EqType> = {
  [EQ_PLUGIN.graphic]: "graphic",
  [EQ_PLUGIN.parametric]: "parametric",
};

/** Fixed 10-band graphic frequencies (device param name → display label). */
export const GRAPHIC_BANDS: { param: string; label: string }[] = [
  { param: "band31hz", label: "31" },
  { param: "band63hz", label: "63" },
  { param: "band125hz", label: "125" },
  { param: "band250hz", label: "250" },
  { param: "band500hz", label: "500" },
  { param: "band1khz", label: "1k" },
  { param: "band2khz", label: "2k" },
  { param: "band4khz", label: "4k" },
  { param: "band8khz", label: "8k" },
  { param: "band16khz", label: "16k" },
];

export const GRAPHIC_GAIN = { min: -12, max: 12, step: 0.5 } as const;

/**
 * Parametric band letters the firmware may expose. Devices shipped with 10
 * bands (a–j); WiiM's mid-2026 firmware (Ultra 5.2.8x) answers with 12 (a–l).
 * The rendered set comes from what the device actually lists — see
 * `toParametricBands` in eq.ts — so this is the *accepted* set, not the count.
 */
export const PEQ_LETTERS = [
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l",
] as const;

/**
 * The 10 bands every supported firmware has. Always rendered, even if a device
 * omits a band from its read (a band that's off can come back sparse), so the
 * user can never lose a band from the UI — only gain the newer k/l.
 */
export const PEQ_LETTERS_BASELINE: readonly string[] = PEQ_LETTERS.slice(0, 10);

const PEQ_LETTER_SET: ReadonlySet<string> = new Set(PEQ_LETTERS);
const PEQ_PARAM_KEY = /^([a-z])_(mode|freq|q|gain)$/;

/**
 * Which parametric bands a device exposes, read from the `param_name`s it
 * answered with (`a_mode`, `a_freq`, …) instead of assumed: 10 bands (a–j) on
 * older firmware, 12 (a–l) on WiiM's mid-2026 firmware.
 *
 * Unioned with the 10-band baseline, so a device can only ever *add* bands to
 * the UI — a sparse read (a band that's off coming back without params) must
 * not make its row disappear.
 */
export function peqLettersFrom(paramNames: Iterable<string>): readonly string[] {
  const found = new Set<string>();
  for (const key of paramNames) {
    const hit = PEQ_PARAM_KEY.exec(key);
    if (hit && PEQ_LETTER_SET.has(hit[1]!)) found.add(hit[1]!);
  }
  return PEQ_LETTERS.filter((l) => found.has(l) || PEQ_LETTERS_BASELINE.includes(l));
}

export const PEQ_DEFAULT_FREQ: Record<string, number> = {
  a: 31.25, b: 62.5, c: 125, d: 250, e: 500, f: 1000, g: 2000, h: 4000, i: 8000, j: 16000,
};

export const PEQ_RANGE = {
  freqMin: 20,
  freqMax: 20000,
  qMin: 0.1,
  qMax: 24,
  gainMin: -12,
  gainMax: 12,
} as const;

// Parametric filter types → device `<band>_mode` value. Mapping confirmed on a
// real WiiM Ultra (via rustywiim's MITM table): note the gap — 4 is unused.
// Low/High-Pass are slope filters: the device ignores their gain.
export const PEQ_MODES: { value: number; label: string }[] = [
  { value: -1, label: "Off" },
  { value: 0, label: "Low Shelf" },
  { value: 1, label: "Peak" },
  { value: 2, label: "High Shelf" },
  { value: 3, label: "Low Pass" },
  { value: 5, label: "High Pass" },
];

/** Filter modes whose gain the device ignores (slope filters). */
export const PEQ_GAIN_INDEPENDENT_MODES = new Set([3, 5]);

export const CHANNEL_MODE_STEREO = "Stereo";

/** EQ commands. */
export const EqCmd = {
  // reads (LV2, return real dB/Hz)
  getBand: (pluginURI: string) => `EQGetLV2BandEx:${enc(pluginURI)}`,
  getSourceBand: (source: string, pluginURI: string) =>
    `EQGetLV2SourceBandEx:${json({ source_name: source, pluginURI })}`,
  // writes
  setSourceBand: (payload: Record<string, unknown>) => `EQSetLV2SourceBand:${json(payload)}`,
  // enable/disable per source
  changeSourceFx: (source: string, pluginURI: string) =>
    `EQChangeSourceFX:${json({ source_name: source, pluginURI })}`,
  sourceOff: (source: string, pluginURI: string) =>
    `EQSourceOff:${json({ source_name: source, pluginURI })}`,
  // presets
  list: (pluginURI: string) => `EQv2GetList:${enc(pluginURI)}`,
  sourceLoad: (source: string, pluginURI: string, name: string) =>
    `EQv2SourceLoad:${json({ source_name: source, pluginURI, Name: name })}`,
  sourceSave: (source: string, pluginURI: string, name: string) =>
    `EQSourceSave:${json({ source_name: source, pluginURI, Name: name })}`,
  delete: (pluginURI: string, name: string) => `EQv2Delete:${json({ pluginURI, Name: name })}`,
  rename: (pluginURI: string, name: string, newName: string) =>
    `EQv2Rename:${json({ pluginURI, Name: name, newName })}`,
} as const;

function enc(s: string): string {
  return encodeURIComponent(s);
}
function json(payload: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(payload));
}
