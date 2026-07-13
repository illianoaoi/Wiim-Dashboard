import "server-only";
import { createHash } from "node:crypto";
import {
  fetchDeviceInfo,
  fetchPlayerStatus,
  fetchMetaInfo,
  fetchSubwoofer,
  fetchOutput,
  fetchPresets,
  fetchBtSourceName,
  fetchModeRename,
  fetchAudioInputEnable,
  fetchUsbDac,
} from "./commands";
import { detectService, inferAudioFormat } from "./now-playing-info";
import { getSleep } from "@/lib/sleep/timer";
import type { DeviceSnapshot, DeviceCapabilities } from "./types";

/**
 * Poll-delta transport memory for vendor-push sources (Plex/DLNA), keyed by
 * device id. These sessions report a permanently-stale `status:stop` while
 * `curpos` still advances, so a single snapshot can't tell play from stop — we
 * compare position across consecutive polls instead: advanced ⇒ playing, frozen
 * ⇒ stopped. Inherently one poll behind, and can't tell stop from pause (both
 * freeze) — both accepted. Only consulted for the vendor-push case; every other
 * source keeps the device's own reported state.
 */
const vendorTransport = new Map<string, { position: number; at: number; playing: boolean }>();
const VENDOR_TRANSPORT_TTL_MS = 60_000;

export interface PollableDevice {
  id: string;
  ip: string;
  capabilities: DeviceCapabilities | null;
}

/** Fetch a complete, normalised snapshot for one device in a single round. */
export async function getDeviceSnapshot(device: PollableDevice): Promise<DeviceSnapshot> {
  const caps = device.capabilities;

  const [infoR, playerR, metaR, subR, outR, presetsR, renameR, inputEnR, usbDacR] =
    await Promise.allSettled([
      fetchDeviceInfo(device.ip),
      fetchPlayerStatus(device.ip),
      fetchMetaInfo(device.ip),
      caps?.subwoofer ? fetchSubwoofer(device.ip) : Promise.resolve(null),
      caps?.outputSwitch ? fetchOutput(device.ip) : Promise.resolve(null),
      caps?.presetCount ? fetchPresets(device.ip, caps.presetCount) : Promise.resolve(null),
      fetchModeRename(device.ip),
      fetchAudioInputEnable(device.ip),
      fetchUsbDac(device.ip),
    ]);

  // If both core reads failed, the device is offline/unreachable.
  if (infoR.status === "rejected" && playerR.status === "rejected") {
    return {
      id: device.id,
      online: false,
      error: reason(infoR) || reason(playerR) || "unreachable",
      info: null,
      player: null,
      sub: null,
      output: null,
      presets: null,
      capabilities: caps,
    };
  }

  const info = infoR.status === "fulfilled" ? infoR.value : null;
  const player = playerR.status === "fulfilled" ? playerR.value : null;

  if (player) {
    const meta =
      metaR.status === "fulfilled"
        ? metaR.value
        : {
            albumArt: null,
            quality: null,
            sampleRate: null,
            bitDepth: null,
            bitRate: null,
            title: null,
            artist: null,
            album: null,
          };
    player.quality = meta.quality;
    // Sources like Bluetooth leave Title/Artist empty in getPlayerStatusEx but
    // provide them via getMetaInfo (AVRCP) — fall back to those (only when empty,
    // so streaming is untouched).
    player.title = player.title ?? meta.title;
    player.artist = player.artist ?? meta.artist;
    player.album = player.album ?? meta.album;
    if (player.title) player.title = tidyTrackTitle(player.title);
    // Detect the streaming service (mode + raw art host + vendor). `vendor` +
    // `sourceKey` let DLNA/UPnP push sessions be named and treated as a network
    // source even when their mode isn't a known code, while keeping a stale
    // vendor string off a real physical input.
    player.service = detectService(player.sourceMode, meta.albumArt, player.vendor, player.sourceKey);

    // Poll-delta transport for the vendor-push quirk (e.g. Plex cast on mode
    // 99): the device's `status` sticks at "stop" while `curpos` advances, so
    // derive play/stop from whether `position` moved since the previous poll.
    // Guards: only a vendor push on mode 99, and NOT a multiroom follower
    // (group "1" also reports mode 99 but keeps an honest status incl. pause,
    // which this position heuristic can't represent — leave it untouched).
    if (player.vendor && player.sourceMode === "99" && info?.group !== "1") {
      const now = Date.now();
      const prev = vendorTransport.get(device.id);
      const fresh = prev && now - prev.at < VENDOR_TRANSPORT_TTL_MS;
      let playing: boolean;
      if (!fresh) {
        playing = true; // first sight / stale memory → assume playing (no freeze on a fresh cast)
      } else if (now - prev!.at < 1500) {
        playing = prev!.playing; // polled too soon: position is second-resolution, keep the last verdict
      } else {
        playing = player.position > prev!.position;
      }
      vendorTransport.set(device.id, { position: player.position, at: now, playing });
      player.state = playing ? "playing" : "stopped";
    }
    player.audio = inferAudioFormat(
      player.service?.key ?? null,
      meta.sampleRate,
      meta.bitDepth,
      meta.bitRate,
    );
    // For Bluetooth, also show which device is casting (getbtstatus a2dp_sink).
    if (player.service?.key === "bluetooth") {
      const dev = await fetchBtSourceName(device.ip).catch(() => null);
      if (dev) player.service = { ...player.service, detail: dev };
    }
    // Show art when the device provides it, or when we can look one up by
    // artist + album (local/NAS files often expose no embedded cover). The art
    // route resolves the actual image either way.
    if (meta.albumArt || (player.artist && player.album)) {
      const sig = createHash("sha1")
        .update(`${player.title ?? ""}|${player.artist ?? ""}|${player.album ?? ""}|${meta.albumArt ?? "lookup"}`)
        .digest("hex")
        .slice(0, 12);
      player.albumArt = `/api/devices/${device.id}/art?sig=${sig}`;
    }
  }

  // Presets: use the parallel result, or fetch now if the cached capabilities
  // predate preset support (preset_key comes from the live device info).
  let presets = presetsR.status === "fulfilled" ? presetsR.value : null;
  if (!presets && info && info.presetCount > 0) {
    presets = await fetchPresets(device.ip, info.presetCount).catch(() => null);
  }

  return {
    id: device.id,
    online: true,
    info,
    player,
    sub: subR.status === "fulfilled" ? subR.value : null,
    output: outR.status === "fulfilled" ? outR.value : null,
    presets,
    capabilities: caps,
    sourceNames: renameR.status === "fulfilled" ? renameR.value : undefined,
    disabledSources:
      inputEnR.status === "fulfilled"
        ? Object.entries(inputEnR.value)
            .filter(([k, on]) => !on && k !== "wifi")
            .map(([k]) => k)
        : undefined,
    usbDac: usbDacR.status === "fulfilled" ? usbDacR.value : null,
    sleepExpiresAt: getSleep(device.id),
  };
}

/** Audio-file extensions used to recognise when a "title" is really a filename. */
const AUDIO_FILE_EXT = /\.(flac|mp3|wav|m4a|aac|ogg|opus|dsf|dff|aif|aiff|wma|alac|ape)$/i;

/**
 * Local/NAS files often report the raw filename as the title (e.g.
 * "01.In_The_Flesh.flac"). When a title is clearly a filename, drop the
 * extension + any leading track number and turn underscores into spaces.
 */
function tidyTrackTitle(title: string): string {
  if (!AUDIO_FILE_EXT.test(title)) return title;
  const cleaned = title
    .replace(AUDIO_FILE_EXT, "")
    .replace(/^\s*\d{1,3}\s*[.\-_)]\s*/, "")
    .replace(/_/g, " ")
    .trim();
  return cleaned || title;
}

function reason(r: PromiseSettledResult<unknown>): string | undefined {
  if (r.status === "rejected") {
    const e = r.reason as { message?: string };
    return e?.message;
  }
  return undefined;
}
