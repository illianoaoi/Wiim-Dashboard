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

/** Parametric: 10 bands a–j with default 1-octave frequencies. */
export const PEQ_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] as const;

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

export const PEQ_MODES: { value: number; label: string }[] = [
  { value: -1, label: "Off" },
  { value: 0, label: "Low Shelf" },
  { value: 1, label: "Peak" },
  { value: 2, label: "High Shelf" },
];

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
