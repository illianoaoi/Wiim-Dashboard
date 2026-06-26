"use client";

import { useState } from "react";
import { ListMusic } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/toast";
import { apiSend, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { PresetItem } from "@/lib/wiim/types";

export function PresetCard({
  deviceId,
  presets,
  onChanged,
}: {
  deviceId: string;
  presets: PresetItem[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  async function play(index: number) {
    setBusy(index);
    try {
      await apiSend(`/api/devices/${deviceId}/preset`, "POST", { index });
      onChanged();
    } catch (e) {
      toast((e as ApiError).message || "Could not play preset", "error");
    } finally {
      setBusy(null);
    }
  }

  if (presets.length === 0) return null;

  return (
    <Card className="pb-5">
      <CardHeader icon={<ListMusic className="size-4" />} title="Presets" />
      {/* Square buttons in 2 rows of 6. Fits full-width on tablet/desktop;
          on iPhone the row keeps a comfy tap size and scrolls horizontally. */}
      <div className="overflow-x-auto px-5 pt-4 [-webkit-overflow-scrolling:touch]">
        <div className="grid w-max grid-flow-col grid-rows-2 gap-2 sm:w-full sm:grid-flow-row sm:grid-cols-6">
          {presets.map((p) => (
            <button
              key={p.index}
              onClick={() => void play(p.index)}
              disabled={busy === p.index}
              title={p.name ?? `Preset ${p.index} (empty)`}
              className={cn(
                "focus-ring relative aspect-square w-[4.5rem] overflow-hidden rounded-2xl border transition sm:w-auto",
                p.hasArt
                  ? "border-border hover:border-white/30"
                  : cn(
                      "flex flex-col items-center justify-center gap-1 p-1 text-center",
                      p.name
                        ? "border-border bg-white/[0.03] text-foreground hover:border-white/20 hover:bg-white/[0.06]"
                        : "border-border/40 bg-white/[0.01] text-muted-foreground/50 hover:bg-white/[0.04]",
                    ),
              )}
            >
              {p.hasArt ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/devices/${deviceId}/preset-art?index=${p.index}`}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 size-full object-cover"
                  />
                  <div
                    className="absolute inset-0"
                    style={{ backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.85), transparent, rgba(0,0,0,0.2))" }}
                  />
                  <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-md bg-black/55 text-[10px] font-semibold text-white">
                    {p.index}
                  </span>
                  {p.name && (
                    <span className="absolute inset-x-1.5 bottom-1.5 line-clamp-2 text-left text-[11px] font-semibold leading-tight text-white">
                      {p.name}
                    </span>
                  )}
                  {busy === p.index && (
                    <span className="absolute inset-0 grid place-items-center bg-black/45">
                      <Spinner className="size-6 text-white" />
                    </span>
                  )}
                </>
              ) : (
                <>
                  {busy === p.index ? (
                    <Spinner className="size-6 text-primary" />
                  ) : (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
                      {p.index}
                    </span>
                  )}
                  <span className="line-clamp-2 w-full text-[11px] font-medium leading-tight">
                    {p.name ?? `Preset ${p.index}`}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
