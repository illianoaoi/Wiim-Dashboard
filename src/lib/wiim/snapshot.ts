import "server-only";
import { createHash } from "node:crypto";
import {
  fetchDeviceInfo,
  fetchPlayerStatus,
  fetchTrackMeta,
  fetchSubwoofer,
  fetchOutput,
  fetchPresets,
  fetchBtSourceName,
  fetchModeRename,
  fetchAudioInputEnable,
  fetchSoundCard,
} from "./commands";
import { detectService, inferAudioFormat } from "./now-playing-info";
import { deriveSource } from "./parse";
import { getSleep } from "@/lib/sleep/timer";
import type { DeviceSnapshot, DeviceCapabilities } from "./types";

export interface PollableDevice {
  id: string;
  ip: string;
  capabilities: DeviceCapabilities | null;
}

/** Fetch a complete, normalised snapshot for one device in a single round. */
export async function getDeviceSnapshot(device: PollableDevice): Promise<DeviceSnapshot> {
  const caps = device.capabilities;

  const [infoR, playerR, metaR, subR, outR, presetsR, renameR, inputEnR, soundCardR] =
    await Promise.allSettled([
      fetchDeviceInfo(device.ip),
      fetchPlayerStatus(device.ip),
      fetchTrackMeta(device.ip),
      caps?.subwoofer ? fetchSubwoofer(device.ip) : Promise.resolve(null),
      caps?.outputSwitch ? fetchOutput(device.ip) : Promise.resolve(null),
      caps?.presetCount ? fetchPresets(device.ip, caps.presetCount) : Promise.resolve(null),
      fetchModeRename(device.ip),
      fetchAudioInputEnable(device.ip),
      fetchSoundCard(device.ip),
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
    const tm =
      metaR.status === "fulfilled"
        ? metaR.value
        : {
            meta: {
              albumArt: null,
              quality: null,
              sampleRate: null,
              bitDepth: null,
              bitRate: null,
              actualQuality: null,
              title: null,
              artist: null,
              album: null,
            },
            transport: null,
          };
    const meta = tm.meta;
    player.quality = meta.quality;
    // OEM boxes (e.g. Audio Pro) can return an incomplete getPlayerStatusEx with
    // no usable source. When GetInfoEx knows it — via PlayType, or its
    // PlayMedium fallback — re-derive so the source card + service light up.
    // Only fills a gap (sourceKey === null); WiiM's own mode is untouched.
    if (player.sourceKey === null && tm.transport?.playType) {
      const s = deriveSource(tm.transport.playType, player.vendor);
      if (s.sourceKey) {
        player.sourceMode = s.sourceMode;
        player.sourceLabel = s.sourceLabel;
        player.sourceKey = s.sourceKey;
      }
    }
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

    // Prefer GetInfoEx's honest CurrentTransportState for network/cast sources.
    // The HTTP API's `status` sticks on "stop" for DLNA/cast pushes (Plex) and
    // is incomplete on some OEM boxes, whereas GetInfoEx reports the real play
    // state (this replaces the old poll-delta heuristic and also handles pause +
    // multiroom followers correctly). Gated on sourceKey === "wifi" (parse's
    // verdict for network + cast); physical inputs and Bluetooth keep the HTTP
    // API's state, where GetInfoEx's transport is meaningless/misleading.
    if (tm.transport?.state && player.sourceKey === "wifi") {
      player.state = tm.transport.state;
    }
    player.audio = inferAudioFormat(
      player.service?.key ?? null,
      meta.sampleRate,
      meta.bitDepth,
      meta.bitRate,
      meta.actualQuality,
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
    usbDac: soundCardR.status === "fulfilled" ? soundCardR.value.usbDac : null,
    availableOutputs: soundCardR.status === "fulfilled" ? soundCardR.value.outputs : undefined,
    outputNames: soundCardR.status === "fulfilled" ? soundCardR.value.outputNames : undefined,
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
