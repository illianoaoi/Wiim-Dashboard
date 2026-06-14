import "server-only";
import { createHash } from "node:crypto";
import {
  fetchDeviceInfo,
  fetchPlayerStatus,
  fetchMetaInfo,
  fetchSubwoofer,
  fetchOutput,
  fetchPresets,
} from "./commands";
import { detectService, inferAudioFormat } from "./now-playing-info";
import type { DeviceSnapshot, DeviceCapabilities } from "./types";

export interface PollableDevice {
  id: string;
  ip: string;
  capabilities: DeviceCapabilities | null;
}

/** Fetch a complete, normalised snapshot for one device in a single round. */
export async function getDeviceSnapshot(device: PollableDevice): Promise<DeviceSnapshot> {
  const caps = device.capabilities;

  const [infoR, playerR, metaR, subR, outR, presetsR] = await Promise.allSettled([
    fetchDeviceInfo(device.ip),
    fetchPlayerStatus(device.ip),
    fetchMetaInfo(device.ip),
    caps?.subwoofer ? fetchSubwoofer(device.ip) : Promise.resolve(null),
    caps?.outputSwitch ? fetchOutput(device.ip) : Promise.resolve(null),
    caps?.presetCount ? fetchPresets(device.ip, caps.presetCount) : Promise.resolve(null),
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
    // Detect the streaming service (mode + raw art host) and infer the format.
    player.service = detectService(player.sourceMode, meta.albumArt);
    player.audio = inferAudioFormat(
      player.service?.key ?? null,
      meta.sampleRate,
      meta.bitDepth,
      meta.bitRate,
    );
    if (meta.albumArt) {
      const sig = createHash("sha1")
        .update(`${player.title ?? ""}|${player.artist ?? ""}|${meta.albumArt}`)
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
  };
}

function reason(r: PromiseSettledResult<unknown>): string | undefined {
  if (r.status === "rejected") {
    const e = r.reason as { message?: string };
    return e?.message;
  }
  return undefined;
}
