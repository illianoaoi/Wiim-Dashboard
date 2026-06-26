/** Normalised, UI-friendly shapes derived from the raw WiiM API responses. */

export type PlaybackState = "playing" | "paused" | "stopped" | "loading";

/** The streaming service / protocol behind the current track (network & BT). */
export interface StreamService {
  key: string; // "tidal" | "spotify" | "qobuz" | "airplay" | "bluetooth" | ...
  name: string; // display label, e.g. "TIDAL Connect"
  logo: string | null; // brand-logo key for <ServiceLogo>; null → lucide fallback
  detail?: string | null; // e.g. the connected Bluetooth source device name
}

/**
 * Audio format for the current track. WiiM's HTTP API does NOT expose the
 * codec, so `codec`/`tier` are inferred from sampleRate/bitDepth + the known
 * service (see now-playing-info.ts). Numbers are the raw getMetaInfo values.
 */
export interface AudioFormat {
  codec: string | null; // inferred, e.g. "FLAC" | "ALAC" | "MP3" | "AAC" | "OGG"
  tier: "hires" | "lossless" | "lossy" | null;
  sampleRate: number | null; // Hz
  bitDepth: number | null; // bits
  bitRate: number | null; // kbps
}

/** A single timed lyric line (synced lyrics from LRCLIB). */
export interface LyricLine {
  t: number; // start time in seconds
  text: string;
}

export interface PlayerStatus {
  state: PlaybackState;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArt: string | null; // absolute device URL (proxied to the client)
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0-100
  muted: boolean;
  /** raw numeric source mode (getPlayerStatusEx `mode`). */
  sourceMode: string;
  /** friendly current source label. */
  sourceLabel: string;
  /** which SOURCES.key this maps to, when identifiable. */
  sourceKey: string | null;
  repeat: "off" | "one" | "all";
  shuffle: boolean;
  /** numeric EQ preset index from player status (presentational only). */
  eqIndex: number;
  quality: string | null; // e.g. "44.1 kHz / 16 bit"
  /** detected streaming service (network/BT sources); null otherwise. */
  service: StreamService | null;
  /** audio format details (filled from getMetaInfo); null when unavailable. */
  audio: AudioFormat | null;
}

export interface DeviceInfo {
  name: string;
  model: string; // marketing-ish (project / priv_prj)
  project: string;
  firmware: string;
  mac: string;
  uuid: string;
  ip: string;
  rssi: number | null;
  internet: boolean;
  /** active network interface (EQ uses this for the network source name). */
  network: "ethernet" | "wifi" | null;
  group: string; // "0" master/standalone, "1" follower
  /** temperatures in °C when the model exposes them (amp models). */
  temperatureCpu: number | null;
  temperatureBoard: number | null;
  /** number of preset slots (preset_key). */
  presetCount: number;
}

export interface SubwooferStatus {
  enabled: boolean;
  connected: boolean;
  level: number; // -15..+15 dB
  crossover: number; // 30..250 Hz
  phase: number; // 0 | 180
  delay: number; // ms
  mainBassFilter: boolean | null;
  subBypass: boolean | null;
}

export interface OutputStatus {
  hardware: number; // current OUTPUTS.id
  bluetoothSource: boolean;
  audioCast: boolean;
}

export type EqType = "graphic" | "parametric";

export interface GraphicBand {
  param: string; // e.g. "band31hz"
  label: string; // e.g. "31"
  gain: number; // dB
}

export interface ParametricBand {
  letter: string; // a–j
  mode: number; // -1 off, 0 low-shelf, 1 peak, 2 high-shelf
  frequency: number; // Hz
  q: number;
  gain: number; // dB
}

export interface EqPresets {
  custom: string[];
  preset: string[];
}

export interface EqSourceState {
  source: string; // EQ source_name (e.g. "optical")
  enabled: boolean;
  activeType: EqType | null; // which plugin is currently on for this source
  graphic: { name: string; bands: GraphicBand[] };
  parametric: { name: string; channelMode: string; bands: ParametricBand[] };
}

/** Full EQ payload for one source (fetched on demand, not in the poll). */
export interface EqOverview {
  supported: boolean; // false = firmware doesn't expose the v2 EQ API → hide card
  sources: { key: string; label: string }[];
  state: EqSourceState | null;
  presets: { graphic: EqPresets; parametric: EqPresets };
}

export interface PresetItem {
  index: number; // 1-based slot
  name: string | null; // null = empty slot
  hasArt: boolean; // artwork available (served via the preset-art proxy)
}

export interface DeviceCapabilities {
  /** temperature fields present (amp models). */
  temperature: boolean;
  /** number of preset slots (getStatusEx `preset_key`), 0 if unsupported. */
  presetCount: number;
  /** getSubLPF returned a valid payload. */
  subwoofer: boolean;
  /** EQ_support flag / EQ commands work. */
  equalizer: boolean;
  /** getNewAudioOutputHardwareMode works. */
  outputSwitch: boolean;
  /** input source keys this device supports (from plm_support / model). */
  sources: string[];
  /** output ids this device offers. */
  outputs: number[];
  isAmp: boolean;
}

/** Everything the dashboard needs for one device in a single poll. */
export interface DeviceSnapshot {
  id: string;
  online: boolean;
  error?: string;
  info: DeviceInfo | null;
  player: PlayerStatus | null;
  sub: SubwooferStatus | null;
  output: OutputStatus | null;
  presets: PresetItem[] | null;
  capabilities: DeviceCapabilities | null;
  /** custom input names from the WiiM app (getModeRename), keyed by SOURCES.key. */
  sourceNames?: Record<string, string>;
  /** input source keys disabled in the WiiM app (getAudioInputEnable). */
  disabledSources?: string[];
  /** connected USB DAC name (getSoundCardModeSupportList); null if none. */
  usbDac?: string | null;
}
