"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { LyricLine } from "@/lib/wiim/types";

/** Per-track lyric timing nudges, remembered in this browser only. */
const OFFSET_KEY = "wiim:lyricOffsets";
const OFFSET_STEP = 0.25; // seconds per tap
const OFFSET_LIMIT = 10; // clamp, seconds either way
const OFFSET_MAX_ENTRIES = 200; // keep the stored map small

function readOffsets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(OFFSET_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeOffset(key: string, seconds: number): void {
  try {
    const all = readOffsets();
    if (seconds === 0) delete all[key];
    else all[key] = seconds;
    // Oldest-first trim: insertion order is preserved for string keys.
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - OFFSET_MAX_ENTRIES))) delete all[k];
    localStorage.setItem(OFFSET_KEY, JSON.stringify(all));
  } catch {
    /* private mode / blocked storage — the nudge just won't be remembered */
  }
}

/**
 * Synced-lyrics panel for the Now Playing "lyrics" view. The current line is
 * highlighted and the list auto-scrolls to keep it centred (driven by the track
 * position); tapping a line seeks to its timestamp. Falls back to plain lyrics,
 * then a "not found" state. Sized to the artwork slot via `sizeClass`.
 *
 * LRCLIB timings can sit a little ahead of or behind a given release, so a
 * per-track offset (± in 0.25 s steps) can nudge them into place. It's stored
 * per track in this browser's localStorage, keyed by `trackKey`.
 */
export function LyricsView({
  lines,
  plain,
  position,
  loading,
  onSeek,
  trackKey = null,
  sizeClass = "size-44 sm:size-52",
  large = false,
}: {
  lines: LyricLine[] | null;
  plain: string | null;
  position: number;
  loading: boolean;
  onSeek: (t: number) => void;
  /** Identifies the track the offset belongs to (e.g. "artist|title"). */
  trackKey?: string | null;
  sizeClass?: string;
  large?: boolean;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);

  // Load this track's remembered nudge (and reset when the track changes).
  useEffect(() => {
    if (!trackKey) {
      setOffset(0);
      return;
    }
    // Anything but a finite number (hand-edited or corrupt storage) would turn
    // the position arithmetic into NaN and silently stop the highlighting.
    const saved = readOffsets()[trackKey];
    setOffset(typeof saved === "number" && Number.isFinite(saved) ? saved : 0);
  }, [trackKey]);

  const nudge = useCallback(
    (delta: number) => {
      const next = Math.min(
        OFFSET_LIMIT,
        Math.max(-OFFSET_LIMIT, Math.round((offset + delta) / OFFSET_STEP) * OFFSET_STEP),
      );
      if (next === offset) return;
      if (trackKey) writeOffset(trackKey, next);
      setOffset(next);
    },
    [offset, trackKey],
  );

  // A positive offset delays the lyrics (the line shows up later).
  const at = position - offset;

  // Active line = the last one whose timestamp has passed.
  let active = -1;
  if (lines) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.t <= at + 0.2) active = i;
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
  const synced = !!lines && lines.length > 0;

  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-white/5", sizeClass)}>
      {loading ? (
        <div className="grid size-full place-items-center text-muted-foreground">
          <Spinner className="size-6" />
        </div>
      ) : synced ? (
        <div className="absolute inset-0" style={{ maskImage: mask, WebkitMaskImage: mask }}>
          <div ref={innerRef} className="relative px-3 transition-transform duration-500 ease-out">
            {lines!.map((l, i) => (
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

      {synced && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-1",
            large ? "pb-3" : "pb-1.5",
          )}
        >
          <div className="flex items-center gap-0.5 rounded-full bg-black/45 px-1 py-0.5 backdrop-blur-sm">
            <OffsetButton label="Shift lyrics earlier" large={large} onClick={() => nudge(-OFFSET_STEP)}>
              −
            </OffsetButton>
            <button
              type="button"
              onClick={() => nudge(-offset)}
              disabled={offset === 0}
              title={offset === 0 ? "Lyrics timing" : "Reset lyrics timing"}
              aria-label={offset === 0 ? "Lyrics timing" : "Reset lyrics timing"}
              className={cn(
                "min-w-[3.25rem] rounded-full text-center font-medium tabular-nums transition-colors",
                large ? "px-2 py-1 text-xs" : "px-1.5 text-[10px]",
                offset === 0
                  ? "text-muted-foreground/60"
                  : "text-foreground hover:bg-white/10 active:bg-white/15",
              )}
            >
              {offset === 0 ? "sync" : `${offset > 0 ? "+" : "−"}${Math.abs(offset).toFixed(2)}s`}
            </button>
            <OffsetButton label="Shift lyrics later" large={large} onClick={() => nudge(OFFSET_STEP)}>
              +
            </OffsetButton>
          </div>
        </div>
      )}
    </div>
  );
}

function OffsetButton({
  label,
  large,
  onClick,
  children,
}: {
  label: string;
  large: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "grid place-items-center rounded-full leading-none text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground active:bg-white/15",
        large ? "size-8 text-base" : "size-6 text-xs",
      )}
    >
      {children}
    </button>
  );
}
