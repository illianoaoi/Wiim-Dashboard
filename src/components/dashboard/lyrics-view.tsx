"use client";

import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { LyricLine } from "@/lib/wiim/types";

/**
 * Synced-lyrics panel for the Now Playing "lyrics" view. The current line is
 * highlighted and the list auto-scrolls to keep it centred (driven by the track
 * position); tapping a line seeks to its timestamp. Falls back to plain lyrics,
 * then a "not found" state. Sized to the artwork slot via `sizeClass`.
 */
export function LyricsView({
  lines,
  plain,
  position,
  loading,
  onSeek,
  sizeClass = "size-44 sm:size-52",
  large = false,
}: {
  lines: LyricLine[] | null;
  plain: string | null;
  position: number;
  loading: boolean;
  onSeek: (t: number) => void;
  sizeClass?: string;
  large?: boolean;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  // Active line = the last one whose timestamp has passed.
  let active = -1;
  if (lines) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.t <= position + 0.2) active = i;
      else break;
    }
  }

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || active < 0) return;
    const lineEl = inner.children[active] as HTMLElement | undefined;
    const container = inner.parentElement;
    if (!lineEl || !container) return;
    const center = lineEl.offsetTop + lineEl.offsetHeight / 2;
    inner.style.transform = `translateY(${container.clientHeight / 2 - center}px)`;
  }, [active, lines]);

  const mask = "linear-gradient(transparent, #000 20%, #000 80%, transparent)";

  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-white/5", sizeClass)}>
      {loading ? (
        <div className="grid size-full place-items-center text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      ) : lines && lines.length ? (
        <div className="absolute inset-0" style={{ maskImage: mask, WebkitMaskImage: mask }}>
          <div ref={innerRef} className="relative px-3 transition-transform duration-500 ease-out">
            {lines.map((l, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSeek(l.t)}
                className={cn(
                  "block w-full text-center leading-snug transition-colors",
                  large ? "py-2.5" : "py-1.5",
                  i === active
                    ? cn("font-semibold text-foreground", large ? "text-2xl" : "text-sm")
                    : cn("text-muted-foreground/45 hover:text-muted-foreground", large ? "text-lg" : "text-sm"),
                )}
              >
                {l.text || "♪"}
              </button>
            ))}
          </div>
        </div>
      ) : plain ? (
        <>
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
            not time-synced
          </div>
          <div
            className={cn(
              "absolute inset-0 overflow-y-auto whitespace-pre-line px-3 pb-4 pt-9 text-center leading-relaxed text-muted-foreground",
              large ? "text-lg" : "text-sm",
            )}
            style={{ maskImage: mask, WebkitMaskImage: mask }}
          >
            {plain}
          </div>
        </>
      ) : (
        <div className="grid size-full place-items-center px-4 text-center text-sm text-muted-foreground">
          No lyrics found
        </div>
      )}
    </div>
  );
}
