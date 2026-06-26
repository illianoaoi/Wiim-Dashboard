"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { VinylDisc } from "./vinyl-disc";
import { QualityPill } from "./quality-pill";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { PlayerStatus } from "@/lib/wiim/types";
import type { RGB } from "@/lib/client/use-album-color";

/**
 * Full-screen "kiosk / wall-display" view — a clean, chrome-free now-playing
 * built around the spinning vinyl, for mounting a tablet on the wall. Keeps the
 * screen awake (Wake Lock), hides the cursor + chrome when idle, and exits on
 * Esc or the close button.
 */
export function KioskView({
  player,
  artSrc,
  rgb,
  isPlaying,
  sourceLabel,
  vol,
  muted,
  onColor,
  onSend,
  onVolume,
  onVolumeCommit,
  onExit,
}: {
  player: PlayerStatus;
  artSrc: string | null;
  rgb: string | null;
  isPlaying: boolean;
  sourceLabel: string;
  vol: number;
  muted: boolean;
  onColor: (c: RGB | null) => void;
  onSend: (body: Record<string, unknown>) => void;
  onVolume: (v: number) => void;
  onVolumeCommit: (v: number) => void;
  onExit: () => void;
}) {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    // Keep the screen awake for a wall display.
    type WakeSentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeSentinel> };
    };
    let lock: WakeSentinel | null = null;
    const req = async () => {
      try {
        lock = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* unsupported / denied — fine */
      }
    };
    void req();
    const onVis = () => {
      if (document.visibilityState === "visible") void req();
    };
    document.addEventListener("visibilitychange", onVis);

    // Hide cursor + chrome after a few seconds of no input.
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      void lock?.release?.().catch(() => {});
    };
  }, [onExit]);

  const title = player.title?.trim() || sourceLabel;
  const VolIcon = muted || vol === 0 ? VolumeX : Volume2;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[100] flex flex-col overflow-hidden text-white",
        idle && "cursor-none",
      )}
      style={{ background: "radial-gradient(110% 110% at 28% 32%, #17151f 0%, #08080b 68%)" }}
    >
      {rgb && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(80% 80% at 25% 32%, rgba(${rgb}, 0.3), transparent 60%)` }}
        />
      )}

      <button
        onClick={onExit}
        aria-label="Exit fullscreen"
        className={cn(
          "focus-ring absolute right-5 top-5 z-10 grid size-11 place-items-center rounded-full bg-white/10 text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white",
          idle && "pointer-events-none opacity-0",
        )}
      >
        <X className="size-5" />
      </button>

      <div className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-8 px-6 sm:flex-row sm:gap-16 sm:px-14">
        <VinylDisc
          artSrc={artSrc}
          spinning={isPlaying}
          rgb={rgb}
          onColor={onColor}
          sizeClass="size-[min(70vw,58vh)]"
        />

        <div className="flex w-full max-w-md flex-col items-center sm:items-start">
          <QualityPill quality={player.quality} audio={player.audio} className="mb-4" />
          <h1 className="line-clamp-2 text-center text-4xl font-semibold leading-tight sm:text-left sm:text-5xl">
            {title}
          </h1>
          {player.artist && <p className="mt-3 text-xl text-white/60">{player.artist}</p>}
          {player.album && <p className="mt-1 text-base text-white/40">{player.album}</p>}

          <div className="mt-10 flex items-center gap-6">
            <button
              onClick={() => onSend({ action: "prev" })}
              aria-label="Previous"
              className="focus-ring text-white/80 transition hover:text-white"
            >
              <SkipBack className="size-8 fill-current" />
            </button>
            <button
              onClick={() => onSend({ action: "toggle" })}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="focus-ring grid size-20 place-items-center rounded-full bg-white text-black shadow-xl transition active:scale-95"
            >
              {isPlaying ? (
                <Pause className="size-9 fill-current" />
              ) : (
                <Play className="size-9 translate-x-0.5 fill-current" />
              )}
            </button>
            <button
              onClick={() => onSend({ action: "next" })}
              aria-label="Next"
              className="focus-ring text-white/80 transition hover:text-white"
            >
              <SkipForward className="size-8 fill-current" />
            </button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "relative z-[1] flex items-center gap-4 px-8 pb-7 text-white/70 transition",
          idle && "opacity-30",
        )}
      >
        <span className="hidden text-sm sm:block">{sourceLabel}</span>
        <div className="ml-auto flex w-full max-w-xs items-center gap-3">
          <button
            onClick={() => onSend({ action: muted ? "unmute" : "mute" })}
            aria-label={muted ? "Unmute" : "Mute"}
            className="focus-ring shrink-0 text-white/70 hover:text-white"
          >
            <VolIcon className="size-5" />
          </button>
          <Slider
            value={vol}
            min={0}
            max={100}
            onChange={onVolume}
            onCommit={onVolumeCommit}
            aria-label="Volume"
          />
          <span className="w-8 shrink-0 text-right text-sm tabular-nums">{muted ? "—" : vol}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
