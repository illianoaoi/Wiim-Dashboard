import "server-only";
import type { StreamService, AudioFormat } from "./types";

/**
 * Now-playing service + audio-format detection.
 *
 * The WiiM HTTP API has NO `vendor` field and NO codec field, so:
 *  - the streaming SERVICE is derived from getPlayerStatusEx `mode` (Connect/
 *    cast sessions have dedicated codes; in-app network playback is mode 10/20
 *    and is named by sniffing the album-art URL host);
 *  - the CODEC is *inferred* from the bit-depth/sample-rate quality tier plus
 *    the known service (e.g. Tidal/Qobuz lossless = FLAC, Spotify = OGG).
 * Both are best-effort and clearly marked as inferred in the UI types.
 */

interface SvcDef {
  key: string;
  name: string;
  logo: string | null;
}

/** Dedicated mode codes (Connect / cast sessions + protocols). */
const SERVICE_BY_MODE: Record<string, SvcDef> = {
  "1": { key: "airplay", name: "AirPlay", logo: "airplay" },
  "2": { key: "dlna", name: "DLNA", logo: null },
  "3": { key: "qplay", name: "QPlay", logo: null },
  "31": { key: "spotify", name: "Spotify Connect", logo: "spotify" },
  "32": { key: "tidal", name: "TIDAL Connect", logo: "tidal" },
  "36": { key: "qobuz", name: "Qobuz Connect", logo: "qobuz" },
  "41": { key: "bluetooth", name: "Bluetooth", logo: "bluetooth" },
};

/** Generic network modes (in-app streaming) — service guessed from art host. */
const NETWORK_MODES = new Set(["10", "11", "12", "13", "14", "16", "20", "21", "30"]);

/** Album-art host substrings → service (for the generic network path). */
const SERVICE_BY_HOST: { match: string; def: SvcDef }[] = [
  { match: "tidal", def: { key: "tidal", name: "TIDAL", logo: "tidal" } },
  { match: "dzcdn", def: { key: "deezer", name: "Deezer", logo: "deezer" } },
  { match: "deezer", def: { key: "deezer", name: "Deezer", logo: "deezer" } },
  { match: "qobuz", def: { key: "qobuz", name: "Qobuz", logo: "qobuz" } },
  { match: "media-amazon", def: { key: "amazon", name: "Amazon Music", logo: "amazon" } },
  { match: "amazon", def: { key: "amazon", name: "Amazon Music", logo: "amazon" } },
  { match: "scdn", def: { key: "spotify", name: "Spotify", logo: "spotify" } },
  { match: "spotify", def: { key: "spotify", name: "Spotify", logo: "spotify" } },
  { match: "sndcdn", def: { key: "soundcloud", name: "SoundCloud", logo: "soundcloud" } },
  { match: "soundcloud", def: { key: "soundcloud", name: "SoundCloud", logo: "soundcloud" } },
  { match: "ytimg", def: { key: "youtubemusic", name: "YouTube Music", logo: "youtubemusic" } },
  { match: "googleusercontent", def: { key: "youtubemusic", name: "YouTube Music", logo: "youtubemusic" } },
  { match: "tunein", def: { key: "tunein", name: "TuneIn", logo: "tunein" } },
  { match: "radiotime", def: { key: "tunein", name: "TuneIn", logo: "tunein" } },
];

/**
 * Vendor strings WiiM populates for its OWN internal aggregators, not a real
 * third-party casting app: internet-radio presets report vendor "CustomRadio"
 * (WiiM's built-in radio browser, not the station). Surfacing that as the
 * "service" is exactly the bug this file avoids, so it's excluded here — real
 * vendors (Plex, Roon, BubbleUPnP, …) pass through untouched.
 */
const INTERNAL_VENDOR_NAMES = new Set(["customradio"]);

/** True for a vendor string naming a real external service/app (not one of
 *  WiiM's internal aggregator names above). */
function isRealVendor(vendor: string | null): vendor is string {
  return !!vendor && !INTERNAL_VENDOR_NAMES.has(vendor.toLowerCase());
}

/** Resolve the streaming service for the given player `mode` + art URL + vendor.
 *  `sourceKey` is parse's already-decided source (network/cast → "wifi"), used
 *  to keep the vendor fallback from firing on a physical input that happens to
 *  carry a stale `vendor` string from a just-ended cast. */
export function detectService(
  mode: string,
  albumArtURI: string | null,
  vendor: string | null = null,
  sourceKey: string | null = null,
): StreamService | null {
  const direct = SERVICE_BY_MODE[mode];
  if (direct) return { ...direct };

  if (NETWORK_MODES.has(mode)) {
    if (albumArtURI) {
      let host = albumArtURI.toLowerCase();
      try {
        host = new URL(albumArtURI).host.toLowerCase();
      } catch {
        /* not a URL — match against the raw string */
      }
      for (const { match, def } of SERVICE_BY_HOST) {
        if (host.includes(match)) return { ...def };
      }
    }
    // A real casting vendor beats the bare "Network" label on a generic mode —
    // e.g. a Plex-hosted preset the device pulls itself lands on mode 10 but
    // still reports vendor "Plex".
    if (isRealVendor(vendor)) return { key: "vendor", name: vendor, logo: null };
    return { key: "network", name: "Network", logo: null };
  }

  // DLNA/UPnP push sessions (e.g. Plex cast TO the device) aren't a known mode
  // and have no physical input — name them after the vendor so the stream-info
  // band shows "Plex" and format inference runs off getMetaInfo. Gated on
  // sourceKey === "wifi" (parse's verdict for network/cast pushes) so a real
  // PHYSICAL input carrying a stale vendor string never gets a phantom service.
  if (sourceKey === "wifi" && isRealVendor(vendor)) return { key: "vendor", name: vendor, logo: null };
  return null; // physical inputs etc. — no info block
}

/** Inferred codec name from the service + quality tier (best effort). */
function inferCodec(service: string | null, lossless: boolean): string | null {
  switch (service) {
    case "tidal":
      return lossless ? "FLAC" : "AAC";
    case "qobuz":
      return "FLAC";
    case "amazon":
      return lossless ? "FLAC" : "AAC";
    case "deezer":
      return lossless ? "FLAC" : "MP3";
    case "spotify":
      return lossless ? "FLAC" : "OGG"; // Spotify Lossless is FLAC; standard is OGG
    case "youtubemusic":
      return "AAC";
    case "soundcloud":
      return lossless ? "FLAC" : "AAC";
    case "airplay":
      return "ALAC"; // AirPlay streams ALAC
    case "qplay":
      return lossless ? "FLAC" : "AAC";
    case "dlna":
    case "network":
    case "roon":
      return lossless ? "FLAC" : null; // unknown lossy container — don't guess
    case "bluetooth":
      return null; // codec not exposed for the BT sink
    default:
      return lossless ? "FLAC" : null;
  }
}

/** Build the AudioFormat from raw getMetaInfo numbers + the detected service. */
export function inferAudioFormat(
  serviceKey: string | null,
  sampleRate: number | null,
  bitDepth: number | null,
  bitRate: number | null,
): AudioFormat | null {
  // bitRate is the reliable lossy/lossless discriminator: compressed codecs
  // (OGG/MP3/AAC) cap around 320–400 kbps, whereas lossless FLAC is ~700 kbps+.
  // The device reports a *decoded PCM* bitDepth (e.g. 16) even for lossy streams,
  // so bitDepth alone wrongly flags Spotify's 320 kbps OGG as "lossless".
  const hiRes = (bitDepth != null && bitDepth >= 24) || (sampleRate != null && sampleRate > 48000);

  let tier: AudioFormat["tier"] = null;
  if (bitRate != null && bitRate > 0 && bitRate <= 400) {
    tier = "lossy"; // 320 kbps OGG/AAC/MP3 — lossy regardless of reported depth
  } else if (hiRes) {
    tier = "hires";
  } else if (bitDepth != null && bitDepth >= 16) {
    tier = "lossless"; // 16-bit with a high/absent bitrate ⇒ CD-quality FLAC
  } else if (bitRate != null && bitRate > 400) {
    tier = "lossless"; // high bitrate but no depth reported ⇒ treat as lossless
  } else if ((bitRate != null && bitRate > 0) || (sampleRate != null && sampleRate > 0)) {
    tier = "lossy";
  }

  const lossless = tier === "hires" || tier === "lossless";
  const codec = tier == null ? null : inferCodec(serviceKey, lossless);

  if (tier == null && sampleRate == null && bitDepth == null && bitRate == null) {
    return null;
  }
  return { codec, tier, sampleRate, bitDepth, bitRate };
}
