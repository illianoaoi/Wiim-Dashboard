import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, json } from "@/lib/api";
import { parseBody } from "@/lib/validate";
import { resolveDevice, runDevice } from "@/lib/device-route";
import { getSourceLabels } from "@/lib/db/settings";
import { SOURCES } from "@/lib/wiim/constants";
import { GRAPHIC_BANDS, PEQ_LETTERS, PEQ_RANGE } from "@/lib/wiim/eq-constants";
import {
  eqSupported,
  getSourceState,
  getPresets,
  setGraphicBands,
  setParametricBand,
  setEnabled,
  loadPreset,
  savePreset,
  deletePreset,
  renamePreset,
} from "@/lib/wiim/eq";
import type { Device } from "@/lib/db/devices";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** EQ tab list for a device: its input sources, network using the live interface. */
function eqSources(device: Device): { key: string; label: string }[] {
  const labels = getSourceLabels(device.id);
  const keys = device.capabilities?.sources ?? ["wifi"];
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const def = SOURCES.find((s) => s.key === k);
    if (!def) continue;
    let sourceName = def.value;
    let label = labels[k]?.trim() || def.label;
    if (k === "wifi") {
      sourceName = device.info?.network || "wifi";
      label = labels[k]?.trim() || "Network";
    }
    if (seen.has(sourceName)) continue;
    seen.add(sourceName);
    out.push({ key: sourceName, label });
  }
  return out;
}

export async function GET(req: Request, { params }: Params) {
  const g = await guard(req);
  if (g instanceof NextResponse) return g;
  const r = resolveDevice((await params).id);
  if ("res" in r) return r.res;
  const ip = r.device.host;

  if (!(await eqSupported(ip))) {
    return json({ supported: false, sources: [], state: null, presets: null });
  }

  const sources = eqSources(r.device);
  const requested = new URL(req.url).searchParams.get("source");
  const source =
    requested && sources.some((s) => s.key === requested)
      ? requested
      : sources[0]?.key ?? "wifi";

  const [state, graphic, parametric] = await Promise.all([
    getSourceState(ip, source),
    getPresets(ip, "graphic"),
    getPresets(ip, "parametric"),
  ]);

  return json({ supported: true, sources, source, state, presets: { graphic, parametric } });
}

const ParamName = z.enum(GRAPHIC_BANDS.map((b) => b.param) as [string, ...string[]]);
const Letter = z.enum(PEQ_LETTERS as unknown as [string, ...string[]]);
const Type = z.enum(["graphic", "parametric"]);
const gain = z.number().min(PEQ_RANGE.gainMin).max(PEQ_RANGE.gainMax);

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setGraphic"),
    source: z.string().min(1).max(32),
    bands: z.array(z.object({ param: ParamName, gain })).min(1).max(10),
  }),
  z.object({
    action: z.literal("setParametric"),
    source: z.string().min(1).max(32),
    letter: Letter,
    mode: z.number().int().min(-1).max(2).optional(),
    frequency: z.number().min(PEQ_RANGE.freqMin).max(PEQ_RANGE.freqMax).optional(),
    q: z.number().min(PEQ_RANGE.qMin).max(PEQ_RANGE.qMax).optional(),
    gain: gain.optional(),
  }),
  z.object({ action: z.literal("enable"), source: z.string().min(1).max(32), type: Type, enabled: z.boolean() }),
  z.object({ action: z.literal("loadPreset"), source: z.string().min(1).max(32), type: Type, name: z.string().min(1).max(64) }),
  z.object({ action: z.literal("savePreset"), source: z.string().min(1).max(32), type: Type, name: z.string().min(1).max(64) }),
  z.object({ action: z.literal("deletePreset"), type: Type, name: z.string().min(1).max(64) }),
  z.object({ action: z.literal("renamePreset"), type: Type, name: z.string().min(1).max(64), newName: z.string().min(1).max(64) }),
]);

export async function POST(req: Request, { params }: Params) {
  const guarded = await guard(req, { mutation: true });
  if (guarded instanceof NextResponse) return guarded;
  const r = resolveDevice((await params).id);
  if ("res" in r) return r.res;
  const ip = r.device.host;

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  switch (d.action) {
    case "setGraphic":
      return runDevice(() => setGraphicBands(ip, d.source, d.bands));
    case "setParametric":
      return runDevice(() =>
        setParametricBand(ip, d.source, d.letter, {
          mode: d.mode,
          frequency: d.frequency,
          q: d.q,
          gain: d.gain,
        }),
      );
    case "enable":
      return runDevice(() => setEnabled(ip, d.source, d.type, d.enabled));
    case "loadPreset":
      return runDevice(() => loadPreset(ip, d.source, d.type, d.name));
    case "savePreset":
      return runDevice(() => savePreset(ip, d.source, d.type, d.name));
    case "deletePreset":
      return runDevice(() => deletePreset(ip, d.type, d.name));
    case "renamePreset":
      return runDevice(() => renamePreset(ip, d.type, d.name, d.newName));
  }
}
