import "server-only";
import { wiimRequest } from "./client";
import { Cmd, SOURCES, AMP_PROJECT_HINTS } from "./constants";
import { safeJson, parseDeviceInfo, parseEqList } from "./parse";
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

function deriveSources(raw: Record<string, unknown>, project: string): string[] {
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
  // de-dupe, preserve SOURCES order
  const set = new Set(keys);
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

  // Probe sub-out + output + EQ in parallel (best-effort).
  const [subText, outText, eqListText] = await Promise.all([
    wiimRequest(ip, Cmd.getSub, { timeoutMs: 5000 }).then((r) => r.text).catch(() => ""),
    wiimRequest(ip, Cmd.getOutput, { timeoutMs: 5000 }).then((r) => r.text).catch(() => ""),
    wiimRequest(ip, Cmd.eqList, { timeoutMs: 5000 }).then((r) => r.text).catch(() => ""),
  ]);

  // EQ_support is a flag/version string (e.g. "1" or "EqNp_ver_2.0"), so treat
  // any non-empty/non-"0" value as supported — and confirm via a real EQGetList.
  const eqSupport = raw.EQ_support;
  const eqSupportFlag =
    eqSupport != null &&
    !["0", "", "false", "none", "no", "off"].includes(String(eqSupport).trim().toLowerCase());
  const equalizer = eqSupportFlag || parseEqList(eqListText).length > 0;

  const subJson = safeJson<Record<string, unknown>>(subText);
  const subwoofer =
    !!subJson &&
    (subJson.level != null || subJson.status != null) &&
    !subText.toLowerCase().includes("unknown command");

  const outJson = safeJson<Record<string, unknown>>(outText);
  const outputSwitch =
    !!outJson && outJson.hardware != null && !outText.toLowerCase().includes("unknown command");

  const outputs: number[] = [];
  if (outputSwitch) {
    outputs.push(2, 1, 3); // line-out, optical, coaxial (documented)
    if (project.includes("ultra")) outputs.push(4); // headphones on Ultra
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
      sources: deriveSources(raw, project),
      outputs,
      isAmp,
    },
  };
}
