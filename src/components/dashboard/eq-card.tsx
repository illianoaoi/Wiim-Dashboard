"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { SlidersHorizontal, ChevronDown, Check, Save, Trash2, Pencil } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { VerticalSlider } from "@/components/ui/vertical-slider";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/toast";
import { apiGet, apiSend, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { GRAPHIC_GAIN, PEQ_RANGE, PEQ_MODES } from "@/lib/wiim/eq-constants";
import type { EqOverview, EqType, ParametricBand } from "@/lib/wiim/types";

type Overview = EqOverview & { source: string };

export function EqCard({ deviceId, initialSource }: { deviceId: string; initialSource?: string | null }) {
  const toast = useToast();
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [subTab, setSubTab] = useState<EqType>("graphic");

  const base = `/api/devices/${deviceId}/eq`;
  const key = `${base}${source ? `?source=${encodeURIComponent(source)}` : ""}`;
  const { data, isLoading, mutate } = useSWR<Overview>(key, (u: string) => apiGet<Overview>(u), {
    revalidateOnFocus: false,
  });

  useEffect(() => {
    if (data?.source && source === null) setSource(data.source);
  }, [data?.source, source]);

  async function send(body: Record<string, unknown>) {
    try {
      await apiSend(base, "POST", body);
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "EQ command failed", "error");
      await mutate();
    }
  }

  if (!data && isLoading) {
    return (
      <Card className="flex items-center justify-center py-10">
        <Spinner className="size-6 text-primary" />
      </Card>
    );
  }
  // Kill-switch: firmware doesn't expose the EQ v2 API (or errored) → hide.
  if (!data || !data.supported || !data.state) return null;

  const st = data.state;
  const enabled = st.enabled;
  const presets = data.presets?.[subTab] ?? { custom: [], preset: [] };
  const currentName = subTab === "graphic" ? st.graphic.name : st.parametric.name;

  return (
    <Card className="pb-5">
      <CardHeader
        icon={<SlidersHorizontal className="size-4" />}
        title="Equalizer"
        action={
          <Switch
            checked={enabled}
            onChange={(v) => void send({ action: "enable", source: st.source, type: subTab, enabled: v })}
            aria-label="Toggle EQ"
          />
        }
      />

      {/* Source tabs */}
      <div className="mt-3 overflow-x-auto px-5">
        <div className="flex w-max gap-2">
          {data.sources.map((s) => (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={cn(
                "focus-ring shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                s.key === st.source
                  ? "bg-primary/20 text-primary"
                  : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Graphic / Parametric sub-tabs */}
      <div className="mt-4 px-5">
        <div className="flex rounded-xl border border-border p-1">
          {(["graphic", "parametric"] as EqType[]).map((t) => (
            <button
              key={t}
              onClick={() => setSubTab(t)}
              className={cn(
                "flex-1 rounded-lg py-1.5 text-sm font-medium capitalize transition",
                subTab === t ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t} EQ
            </button>
          ))}
        </div>
      </div>

      <div className={cn("transition-opacity", !enabled && "opacity-50")}>
        {subTab === "graphic" ? (
          <GraphicPanel bands={st.graphic.bands} source={st.source} send={send} />
        ) : (
          <ParametricPanel bands={st.parametric.bands} source={st.source} send={send} />
        )}
      </div>

      <PresetBar
        type={subTab}
        currentName={currentName}
        presets={presets}
        onLoad={(name) => void send({ action: "loadPreset", source: st.source, type: subTab, name })}
        onSave={(name) => void send({ action: "savePreset", source: st.source, type: subTab, name })}
        onDelete={(name) => void send({ action: "deletePreset", type: subTab, name })}
        onRename={(name, newName) => void send({ action: "renamePreset", type: subTab, name, newName })}
      />
    </Card>
  );
}

// --- Graphic (10 vertical dB sliders) ---------------------------------------

function GraphicPanel({
  bands,
  source,
  send,
}: {
  bands: { param: string; label: string; gain: number }[];
  source: string;
  send: (b: Record<string, unknown>) => Promise<void>;
}) {
  const [local, setLocal] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setLocal(Object.fromEntries(bands.map((b) => [b.param, b.gain])));
  }, [bands, dragging]);

  return (
    <div className="overflow-x-auto px-5 pt-5">
      <div className="flex min-w-max justify-between gap-1.5">
        {bands.map((b) => {
          const v = local[b.param] ?? b.gain;
          return (
            <div key={b.param} className="flex w-9 flex-col items-center gap-1.5">
              <span className="tabular-nums text-[10px] text-muted-foreground">
                {v > 0 ? `+${v}` : v}
              </span>
              <VerticalSlider
                value={v}
                min={GRAPHIC_GAIN.min}
                max={GRAPHIC_GAIN.max}
                step={GRAPHIC_GAIN.step}
                onChange={(nv) => {
                  setDragging(true);
                  setLocal((s) => ({ ...s, [b.param]: nv }));
                }}
                onCommit={(nv) => {
                  setDragging(false);
                  void send({ action: "setGraphic", source, bands: [{ param: b.param, gain: nv }] });
                }}
                ariaLabel={`${b.label} Hz`}
              />
              <span className="text-[10px] font-medium text-muted-foreground">{b.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Parametric (10 bands: freq / Q / gain / type) --------------------------

function ParametricPanel({
  bands,
  source,
  send,
}: {
  bands: ParametricBand[];
  source: string;
  send: (b: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <div className="space-y-2 px-5 pt-4">
      <div className="grid grid-cols-[1.6rem_1fr_3rem_minmax(5rem,1fr)_2.6rem] items-center gap-2 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>Bd</span>
        <span>Type · Freq</span>
        <span>Q</span>
        <span>Gain</span>
        <span className="text-right">dB</span>
      </div>
      {bands.map((b) => (
        <PeqRow key={b.letter} band={b} source={source} send={send} />
      ))}
    </div>
  );
}

function PeqRow({
  band,
  source,
  send,
}: {
  band: ParametricBand;
  source: string;
  send: (b: Record<string, unknown>) => Promise<void>;
}) {
  const [gain, setGain] = useState(band.gain);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setGain(band.gain);
  }, [band.gain, dragging]);

  const set = (params: Record<string, unknown>) =>
    void send({ action: "setParametric", source, letter: band.letter, ...params });

  const off = band.mode === -1;
  const modeLabel = PEQ_MODES.find((m) => m.value === band.mode)?.label ?? "Peak";

  return (
    <div
      className={cn(
        "grid grid-cols-[1.6rem_1fr_3rem_minmax(5rem,1fr)_2.6rem] items-center gap-2",
        off && "opacity-45",
      )}
    >
      <span className="text-center text-xs font-semibold uppercase text-primary">{band.letter}</span>

      <div className="flex items-center gap-1.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="focus-ring rounded-lg bg-white/[0.04] px-2 py-1 text-xs hover:bg-white/[0.08]">
              {modeLabel}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="glass z-50 rounded-xl p-1 text-sm shadow-2xl">
              {PEQ_MODES.map((m) => (
                <DropdownMenu.Item
                  key={m.value}
                  onSelect={() => set({ mode: m.value })}
                  className="cursor-pointer rounded-lg px-3 py-1.5 outline-none data-[highlighted]:bg-white/8"
                >
                  {m.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <input
          type="number"
          defaultValue={Math.round(band.frequency)}
          min={PEQ_RANGE.freqMin}
          max={PEQ_RANGE.freqMax}
          onBlur={(e) => {
            const f = Number(e.target.value);
            if (Number.isFinite(f) && f !== band.frequency) set({ frequency: f });
          }}
          className="h-7 w-16 rounded-lg border border-border bg-input px-1.5 text-center text-xs tabular-nums focus:border-primary focus:outline-none"
          aria-label={`Band ${band.letter} frequency`}
        />
        <span className="text-[10px] text-muted-foreground">Hz</span>
      </div>

      <input
        type="number"
        step={0.1}
        defaultValue={band.q}
        onBlur={(e) => {
          const q = Number(e.target.value);
          if (Number.isFinite(q) && q !== band.q) set({ q });
        }}
        className="h-7 w-full rounded-lg border border-border bg-input px-1.5 text-center text-xs tabular-nums focus:border-primary focus:outline-none"
        aria-label={`Band ${band.letter} Q`}
      />

      <Slider
        value={gain}
        min={PEQ_RANGE.gainMin}
        max={PEQ_RANGE.gainMax}
        step={0.5}
        disabled={off}
        onChange={(v) => {
          setDragging(true);
          setGain(v);
        }}
        onCommit={(v) => {
          setDragging(false);
          set({ gain: v });
        }}
        aria-label={`Band ${band.letter} gain`}
      />
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {gain > 0 ? `+${gain}` : gain}
      </span>
    </div>
  );
}

// --- Preset bar (load / save / delete / rename) -----------------------------

function PresetBar({
  type,
  currentName,
  presets,
  onLoad,
  onSave,
  onDelete,
  onRename,
}: {
  type: EqType;
  currentName: string;
  presets: { custom: string[]; preset: string[] };
  onLoad: (name: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onRename: (name: string, newName: string) => void;
}) {
  const isCustom = presets.custom.includes(currentName);

  return (
    <div className="mt-4 flex items-center gap-2 px-5">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="focus-ring flex flex-1 items-center justify-between rounded-xl border border-border bg-white/[0.03] px-3 py-2 text-sm hover:bg-white/[0.06]">
            <span className={currentName ? "text-foreground" : "text-muted-foreground"}>
              {currentName || "Select preset"}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="glass z-50 max-h-72 min-w-[--radix-dropdown-menu-trigger-width] overflow-y-auto rounded-2xl p-1.5 shadow-2xl"
          >
            {presets.custom.length > 0 && (
              <DropdownMenu.Label className="px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Custom
              </DropdownMenu.Label>
            )}
            {presets.custom.map((p) => (
              <DropdownMenu.Item
                key={`c-${p}`}
                onSelect={() => onLoad(p)}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm outline-none data-[highlighted]:bg-white/8"
              >
                {p}
                {p === currentName && <Check className="size-4 text-primary" />}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Label className="px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Presets
            </DropdownMenu.Label>
            {presets.preset.map((p) => (
              <DropdownMenu.Item
                key={`p-${p}`}
                onSelect={() => onLoad(p)}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm outline-none data-[highlighted]:bg-white/8"
              >
                {p}
                {p === currentName && <Check className="size-4 text-primary" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <button
        onClick={() => {
          const name = window.prompt(`Save current ${type} EQ as a new preset:`)?.trim();
          if (name) onSave(name);
        }}
        className="focus-ring grid size-9 shrink-0 place-items-center rounded-xl bg-white/8 text-foreground hover:bg-white/14"
        title="Save as preset"
      >
        <Save className="size-4" />
      </button>
      {isCustom && (
        <>
          <button
            onClick={() => {
              const nn = window.prompt("Rename preset:", currentName)?.trim();
              if (nn && nn !== currentName) onRename(currentName, nn);
            }}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-xl bg-white/8 text-foreground hover:bg-white/14"
            title="Rename preset"
          >
            <Pencil className="size-4" />
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete custom preset "${currentName}"?`)) onDelete(currentName);
            }}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-xl bg-white/8 text-muted-foreground hover:bg-white/14 hover:text-destructive"
            title="Delete preset"
          >
            <Trash2 className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}
