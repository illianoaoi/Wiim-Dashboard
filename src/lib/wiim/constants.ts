/**
 * WiiM / LinkPlay HTTP API constants.
 *
 * Command strings and numeric enums mirror the official "HTTP API for WiiM
 * Products v1.2" PDF and the reference open-source library python-linkplay.
 * Undocumented-but-verified commands (sub-out, extended outputs) are marked.
 */

/** Base request path. Full URL: https://<ip>/httpapi.asp?command=<cmd> */
export const HTTPAPI_PATH = "/httpapi.asp";

/** Raw httpapi.asp command builders. */
export const Cmd = {
  deviceStatus: "getStatusEx",
  playerStatus: "getPlayerStatusEx",
  metaInfo: "getMetaInfo",
  hwError: "getHwErrorInfo",

  // transport
  resume: "setPlayerCmd:resume",
  pause: "setPlayerCmd:pause",
  toggle: "setPlayerCmd:onepause",
  stop: "setPlayerCmd:stop",
  next: "setPlayerCmd:next",
  prev: "setPlayerCmd:prev",
  seek: (seconds: number) => `setPlayerCmd:seek:${clampInt(seconds, 0, 86400)}`,
  volume: (v: number) => `setPlayerCmd:vol:${clampInt(v, 0, 100)}`,
  mute: (on: boolean) => `setPlayerCmd:mute:${on ? 1 : 0}`,
  loopMode: (n: number) => `setPlayerCmd:loopmode:${Math.trunc(n)}`,

  // source / output
  switchMode: (mode: string) => `setPlayerCmd:switchmode:${mode}`,
  getOutput: "getNewAudioOutputHardwareMode",
  setOutput: (n: number) => `setAudioOutputHardwareMode:${Math.trunc(n)}`,
  // User-assigned input names from the WiiM app ({mode: name}; "Failed" if none).
  getModeRename: "getModeRename",
  // Which physical inputs are enabled in the WiiM app ({audioInput:[{mode,enable}]}).
  getAudioInputEnable: "getAudioInputEnable",
  // Supported output sound-card modes incl. USB DAC (AUDIO_OUTPUT_* + devName).
  getSoundCardModes: "getSoundCardModeSupportList",

  // EQ (WiiM named-preset API)
  eqStat: "EQGetStat",
  eqList: "EQGetList",
  eqOn: "EQOn",
  eqOff: "EQOff",
  eqLoad: (name: string) => `EQLoad:${name}`,

  // Subwoofer / sub-out (undocumented, verified on Ultra fw5.2 / Pro fw4.8+)
  getSub: "getSubLPF",
  setSub: (param: string, value: number) => `setSubLPF:${param}:${value}`,

  // Presets (favourites). Count from getStatusEx `preset_key`.
  getPresets: "getPresetInfo",
  playPreset: (n: number) => `MCUKeyShortClick:${Math.trunc(n)}`,
} as const;

/** Playback status values from getPlayerStatusEx `status`. */
export const PLAYING_STATUS = {
  play: "playing",
  load: "loading",
  loading: "loading",
  stop: "stopped",
  pause: "paused",
} as const;

/**
 * Loop/shuffle enum for WiiM. NOTE: the WRITE command
 * (setPlayerCmd:loopmode:<n>) and the READ field (getPlayerStatusEx `loop`)
 * use *different*, asymmetric tables on WiiM firmware. See parse.ts
 * (parseLoop / computeLoopMode) for the authoritative mapping.
 *
 * Write values (documented): -1 sequence loop (= repeat all), 0 sequence/no
 * loop (= off), 1 single loop (= repeat one), 2 shuffle loop (= shuffle+all).
 * Read values: 0 loop all, 1 single loop, 2 shuffle loop, 3 shuffle no loop,
 * 4 no shuffle no loop (off / default).
 */
export const LoopMode = {
  WRITE_SEQUENCE_LOOP: -1, // repeat all (reads back as 0)
  WRITE_OFF: 0, // sequence, no loop (reads back as 4)
  WRITE_REPEAT_ONE: 1, // single loop
  WRITE_SHUFFLE: 2, // shuffle loop (shuffle + repeat all)
  READ_LOOP_ALL: 0,
  READ_SINGLE_LOOP: 1,
  READ_SHUFFLE_LOOP: 2,
  READ_SHUFFLE_NO_LOOP: 3,
  READ_OFF: 4,
} as const;

/**
 * getPlayerStatusEx `mode` (numeric, as string) → human label.
 * Streaming/network modes all represent the "Network / WiFi" input.
 */
export const PLAYING_MODE_LABEL: Record<string, string> = {
  "-1": "Idle",
  "0": "Idle",
  "1": "AirPlay",
  "2": "DLNA",
  "3": "QPlay",
  "10": "Network",
  "11": "USB",
  "12": "Station",
  "13": "Radio",
  "14": "Playlist",
  "16": "SD Card",
  "20": "Network",
  "21": "USB",
  "30": "Alarm",
  "31": "Spotify",
  "32": "TIDAL",
  "36": "Qobuz",
  "40": "Line In",
  "41": "Bluetooth",
  "43": "Optical",
  "44": "RCA",
  "45": "Coaxial",
  "46": "FM",
  "47": "Line In 2",
  "48": "XLR",
  "49": "HDMI",
  "50": "CD",
  "51": "USB-DAC",
  "52": "SD Card",
  "54": "Phono",
  "56": "Optical 2",
  "57": "Coaxial 2",
  "58": "HDMI ARC",
  "60": "Voice",
  "99": "Follower",
};

/** Numeric playback modes that mean "playing from the network/streaming". */
export const NETWORK_PLAY_MODES = new Set([
  "1", "2", "3", "10", "11", "12", "13", "14", "16", "20", "21", "30", "31", "32", "36", "52", "60",
]);

/**
 * Selectable input sources. `bit` matches the plm_support bitmask in
 * getStatusEx (when present, used to detect what a device actually has).
 * `value` is the case-sensitive switchmode argument.
 */
export interface SourceDef {
  key: string;
  label: string;
  value: string; // switchmode argument (case-sensitive!)
  bit: number; // plm_support bit, 0 = always available
  modes: string[]; // playback `mode` codes that indicate this source is active
  icon: string; // lucide icon name
}

export const SOURCES: SourceDef[] = [
  { key: "wifi", label: "Network / WiFi", value: "wifi", bit: 0, modes: [...NETWORK_PLAY_MODES], icon: "Wifi" },
  { key: "bluetooth", label: "Bluetooth", value: "bluetooth", bit: 4, modes: ["41"], icon: "Bluetooth" },
  { key: "line-in", label: "Line In", value: "line-in", bit: 2, modes: ["40"], icon: "Cable" },
  { key: "line-in2", label: "Line In 2", value: "line-in2", bit: 256, modes: ["47"], icon: "Cable" },
  { key: "optical", label: "Optical", value: "optical", bit: 16, modes: ["43"], icon: "Lightbulb" },
  { key: "optical2", label: "Optical 2", value: "optical2", bit: 262144, modes: ["56"], icon: "Lightbulb" },
  { key: "co-axial", label: "Coaxial", value: "co-axial", bit: 64, modes: ["45"], icon: "CircleDot" },
  { key: "co-axial2", label: "Coaxial 2", value: "co-axial2", bit: 524288, modes: ["57"], icon: "CircleDot" },
  { key: "HDMI", label: "HDMI", value: "HDMI", bit: 1024, modes: ["49"], icon: "Tv" },
  { key: "ARC", label: "HDMI ARC", value: "ARC", bit: 4194304, modes: ["58"], icon: "Tv" },
  { key: "phono", label: "Phono", value: "phono", bit: 65536, modes: ["54"], icon: "Disc3" },
  { key: "RCA", label: "RCA", value: "RCA", bit: 32, modes: ["44"], icon: "Cable" },
  { key: "XLR", label: "XLR", value: "XLR", bit: 512, modes: ["48"], icon: "Cable" },
  { key: "PCUSB", label: "USB-DAC", value: "PCUSB", bit: 32768, modes: ["51"], icon: "Usb" },
  { key: "udisk", label: "USB Drive", value: "udisk", bit: 8, modes: ["11", "21"], icon: "Usb" },
  { key: "cd", label: "CD", value: "cd", bit: 2048, modes: ["50"], icon: "Disc" },
];

/** Audio OUTPUT hardware modes (setAudioOutputHardwareMode:<n>). */
export interface OutputDef {
  id: number;
  label: string;
  icon: string;
  /** documented in the official PDF (1-3) vs community-confirmed. */
  documented: boolean;
}

export const OUTPUTS: OutputDef[] = [
  { id: 2, label: "Line Out", icon: "Cable", documented: true },
  { id: 1, label: "Optical", icon: "Lightbulb", documented: true },
  { id: 3, label: "Coaxial", icon: "CircleDot", documented: true },
  { id: 4, label: "Headphones", icon: "Headphones", documented: false },
  { id: 8, label: "USB", icon: "Usb", documented: false }, // USB DAC out (issue #11, @MennoH Ultra)
];

/** getSoundCardModeSupportList `mode` token → OUTPUTS hardware id. Used for the
 *  simultaneous-output ("coexist") display. LinkPlay-standard mode names. */
export const OUTPUT_MODE_NAME_TO_HW: Record<string, number> = {
  AUDIO_OUTPUT_AUX_MODE: 2, // Line Out
  AUDIO_OUTPUT_SPDIF_MODE: 1, // Optical
  AUDIO_OUTPUT_COAX_MODE: 3, // Coaxial
  AUDIO_OUTPUT_PHONE_JACK_MODE: 4, // Headphone
  AUDIO_OUTPUT_UAC_CARD_MODE: 8, // USB DAC
};

/** Known WiiM EQ preset names (fallback if EQGetList is unavailable). */
export const EQ_PRESETS_FALLBACK = [
  "Flat", "Acoustic", "Bass Booster", "Bass Reducer", "Classical", "Dance",
  "Deep", "Electronic", "Hip-Hop", "Jazz", "Latin", "Loudness", "Lounge",
  "Piano", "Pop", "R&B", "Rock", "Small Speakers", "Spoken Word",
  "Treble Booster", "Treble Reducer", "Vocal Booster",
];

/** Sub-out parameter ranges (verified against pywiim + WiiM Sub-Out FAQ). */
export const SUB_RANGES = {
  level: { min: -15, max: 15, step: 1, unit: "dB" },
  cross: { min: 30, max: 250, step: 5, unit: "Hz" },
  phase: { values: [0, 180] },
  sub_delay: { min: -200, max: 200, step: 5, unit: "ms" },
} as const;

/** Amp model families that expose temperature_cpu / temperature_tmp102. */
export const AMP_PROJECT_HINTS = ["amp"];

function clampInt(n: number, min: number, max: number): number {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}
