import "server-only";
import { wiimRequest } from "./client";
import { Cmd, SOURCES, AMP_PROJECT_HINTS } from "./constants";
import { safeJson, parseDeviceInfo, parseEqList } from "./parse";
import { getAcousticCapability } from "./eq";
import { fetchOutputCoexist, fetchAudioInputEnable } from "./commands";
import type { DeviceCapabilities, DeviceInfo } from "./types";

function parsePlmSupport(raw: Record<string, unknown>): number {
  const v = raw.plm_support ?? raw.plm_support_set;
  if (v == null) return 0;
  const s = String(v).trim();
  if (/^0x/i.test(s)) return parseInt(s, 16) || 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10) || 0;
  const hex = parseInt(s, 16);
  return Number.isFinite(hex) ? hex : 0;
}

/** Inputs that legitimately never appear in getAudioInputEnable (network +
 *  streaming / one-off inputs), so a non-empty roster must NOT prune them. */
const INPUT_KEEP_REGARDLESS = new Set(["wifi", "udisk", "ARC", "cd", "PCUSB", "bluetooth"]);

function deriveSources(
  raw: Record<string, unknown>,
  project: string,
  inputEnable?: Record<string, boolean>,
): string[] {
  const mask = parsePlmSupport(raw);
  const keys: string[] = ["wifi"]; // network is always available
  if (mask > 0) {
    for (const s of SOURCES) {
      if (s.bit > 0 && (mask & s.bit) === s.bit) keys.push(s.key);
    }
  } else {
    // No bitmask exposed — offer a conservative, common default set.
    keys.push("bluetooth", "line-in", "optical");
  }
  // WiiM's plm_support bitmask is unreliable on the Ultra — its USB-drive and
  // HDMI ARC inputs are often not flagged, so offer them explicitly. (Any other
  // source, if active, is surfaced by the "always show the active source" rule.)
  if (project.includes("ultra")) keys.push("udisk", "ARC");
  // plm_support also OVER-asserts inputs a device lacks. When getAudioInputEnable
  // enumerates the real inputs (non-empty roster), drop plm-derived physical
  // inputs it doesn't list — keeping network + streaming inputs that never appear
  // there. Empty roster (unsupported) ⇒ don't prune.
  const roster = inputEnable ?? {};
  const eligible =
    Object.keys(roster).length > 0
      ? keys.filter((k) => INPUT_KEEP_REGARDLESS.has(k) || k in roster)
      : keys;
  // de-dupe, preserve SOURCES order
  const set = new Set(eligible);
  return SOURCES.filter((s) => set.has(s.key)).map((s) => s.key);
}

/**
 * Probe a device and build its capability profile. Cached in the DB and
 * refreshed on demand so the poll loop doesn't re-probe every tick.
 */
export async function detectCapabilities(
  ip: string,
): Promise<{ info: DeviceInfo; capabilities: DeviceCapabilities }> {
  const statusText = (await wiimRequest(ip, Cmd.deviceStatus, { timeoutMs: 8000 })).text;
  const raw = safeJson<Record<string, unknown>>(statusText);
  if (!raw) throw new Error("getStatusEx returned no JSON");

  const info = parseDeviceInfo(raw);
  const project = (info.project || "").toLowerCase();
  const isAmp =
    AMP_PROJECT_HINTS.some((h) => project.includes(h)) ||
    info.temperatureCpu != null ||
    info.temperatureBoard != null;

  // Probe sub-out + output + EQ + acoustics in parallel (best-effort).
  const [subText, outText, eqListText, acoustic, outputCoexist, inputEnable] = await Promise.all([
    wiimRequest(ip, Cmd.getSub, { timeoutMs: 5000 }).then((r) => r.text).catch(() => ""),
    wiimRequest(ip, Cmd.getOutput, { timeoutMs: 5000 }).then((r) => r.text).catch(() => ""),
    wiimRequest(ip, Cmd.eqList, { timeoutMs: 5000 }).then((r) => r.text).catch(() => ""),
    getAcousticCapability(ip).catch(() => null),
    fetchOutputCoexist(ip).catch(() => ({}) as Record<number, number[]>),
    fetchAudioInputEnable(ip).catch(() => ({}) as Record<string, boolean>),
  ]);

  // EQ_support is a flag/version string (e.g. "1" or "EqNp_ver_2.0"), so treat
  // any non-empty/non-"0" value as supported — and confirm via a real EQGetList.
  const eqSupport = raw.EQ_support;
  const eqSupportFlag =
    eqSupport != null &&
    !["0", "", "false", "none", "no", "off"].includes(String(eqSupport).trim().toLowerCase());
  const equalizer = eqSupportFlag || parseEqList(eqListText).length > 0 || acoustic != null;

  const subJson = safeJson<Record<string, unknown>>(subText);
  // Every LinkPlay device answers getSubLPF with a default template that carries
  // `status`/`level`/`cross`… — so those fields DON'T imply sub-out hardware and
  // false-positive the Sub-Out card on non-sub devices. Real sub hardware also
  // returns `plugged` (+ delay_main_sub / linein_delay); key the capability on
  // the presence of any of those. (Cached in the devices table — hit Refresh to
  // re-detect an already-added device.)
  const subwoofer =
    !!subJson &&
    (subJson.plugged != null || subJson.delay_main_sub != null || subJson.linein_delay != null) &&
    !subText.toLowerCase().includes("unknown command");

  const outJson = safeJson<Record<string, unknown>>(outText);
  const outputSwitch =
    !!outJson && outJson.hardware != null && !outText.toLowerCase().includes("unknown command");

  const outputs: number[] = [];
  if (outputSwitch) {
    outputs.push(2, 1, 3); // line-out, optical, coaxial (documented)
    if (project.includes("ultra")) outputs.push(4); // headphones on Ultra
    if (isAmp) outputs.push(7); // built-in speaker amp (WiiM Amp / Amp Ultra)
    // Also expose whatever output the device is currently on, so undocumented
    // modes surface (e.g. USB=8 on the Ultra, reported via getOutput). #11
    const curHw = Math.trunc(Number(outJson?.hardware));
    if (Number.isFinite(curHw) && curHw > 0 && !outputs.includes(curHw)) outputs.push(curHw);
  }

  const presetCount = Math.max(0, Math.trunc(Number(raw.preset_key)) || 0);

  return {
    info,
    capabilities: {
      temperature: info.temperatureCpu != null || info.temperatureBoard != null || isAmp,
      presetCount,
      subwoofer,
      equalizer,
      outputSwitch,
      sources: deriveSources(raw, project, inputEnable),
      outputs,
      isAmp,
      acoustic,
      outputCoexist,
    },
  };
}
