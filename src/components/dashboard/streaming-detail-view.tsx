"use client";

import { useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { ChevronLeft, Disc3, ListMusic, Music, Play, User, Users } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { apiGet, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared client-local streaming primitives.
//
// These mirror the server shapes in src/lib/streaming/types.ts (which is
// server-only and must not be imported here). They live in THIS file — not in
// streaming-search-view.tsx — so the dependency stays one-way: the search view
// imports the detail view, never the other way around.
// ---------------------------------------------------------------------------

export type StreamKind = "track" | "album" | "artist" | "playlist" | "user-playlist";

export type StreamItem = {
  id: string;
  kind: StreamKind;
  title: string;
  subtitle: string | null;
  art: string | null;
};

/** One row of a container's tracklist; `duration` is pre-formatted ("4:47"). */
export type StreamTrack = {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  art: string | null;
  duration: string | null;
};

/** A resolved detail page: header fields + the ordered tracklist. */
export type StreamDetail = {
  id: string;
  kind: StreamKind;
  title: string;
  subtitle: string | null;
  art: string | null;
  tracks: StreamTrack[];
};

/** Fallback glyph per kind when an item has no artwork. */
export const KIND_ICON: Record<StreamKind, typeof Music> = {
  track: Music,
  album: Disc3,
  artist: User,
  playlist: ListMusic,
  "user-playlist": Users,
};

/** Kinds that open a detail view on tap (everything else plays immediately). */
export const CONTAINER_KINDS: ReadonlySet<StreamKind> = new Set<StreamKind>([
  "album",
  "playlist",
  "user-playlist",
]);

/**
 * Options for a play request. A bare `play(item)` queues the item from the
 * top; a track tapped inside a container instead sends the CONTAINER with a
 * `startIndex`, so the device gets the full queue (real up-next) starting at
 * that track. Because the request then carries the container's id, the tapped
 * row supplies its own `pendingId` so the spinner lands on the right row.
 */
export type PlayOptions = {
  /** 1-based track position within the container to start playback from. */
  startIndex?: number;
  /** UI element that owns the pending spinner (defaults to the item's id). */
  pendingId?: string;
  /** Human-readable name for toasts (defaults to the item's title). */
  label?: string;
};

const KIND_LABEL: Record<StreamKind, string> = {
  track: "Track",
  album: "Album",
  artist: "Artist",
  playlist: "Playlist",
  "user-playlist": "Community playlist",
};

/** Artwork tile, proxied through the device so the browser never talks to Amazon directly. */
export function Art({
  deviceId,
  item,
  round,
  className,
  iconClassName,
}: {
  deviceId: string;
  item: Pick<StreamItem, "kind" | "art">;
  round?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <div
      className={cn(
        "grid size-full place-items-center overflow-hidden border border-border bg-white/[0.03]",
        round ? "rounded-full" : "rounded-xl",
        className,
      )}
    >
      {item.art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/devices/${deviceId}/streaming/art?u=${encodeURIComponent(item.art)}`}
          alt=""
          draggable={false}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <Icon className={cn("size-6 text-muted-foreground/50", iconClassName)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

/**
 * In-panel detail layer for an album / playlist / community playlist: the hero
 * header renders instantly from the tapped item while the tracklist is
 * fetched. "Play all" queues the container from the top; tapping a row queues
 * the SAME container starting at that row (`startIndex`), so the rest of the
 * tracklist follows as up-next instead of a lone track. The parent owns
 * playback (and its per-item pending state, `playingId`).
 */
export function StreamingDetailView({
  deviceId,
  item,
  playingId,
  onPlay,
  onBack,
}: {
  deviceId: string;
  item: StreamItem;
  playingId: string | null;
  onPlay: (item: StreamItem, opts?: PlayOptions) => void;
  onBack: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);

  // This layer replaces the surface beneath it, so focus moves to the back
  // control on open — and returns to the tile that opened it on close.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backRef.current?.focus();
    return () => prev?.focus();
  }, []);

  const { data, error, isLoading, mutate } = useSWR<{ ok: true; detail: StreamDetail }>(
    ["stream-detail", deviceId, item.kind, item.id],
    () =>
      apiGet<{ ok: true; detail: StreamDetail }>(
        `/api/devices/${deviceId}/streaming/amazon/detail?kind=${encodeURIComponent(item.kind)}&id=${encodeURIComponent(item.id)}`,
      ),
    { revalidateOnFocus: false },
  );
  const detail = data?.detail;
  const tracks = detail?.tracks ?? [];

  // The tapped item paints the header immediately; once the fetch lands, the
  // resolved fields win (they can be richer — e.g. full title, better art).
  const header: StreamItem = useMemo(
    () => ({
      ...item,
      title: detail?.title ?? item.title,
      subtitle: detail?.subtitle ?? item.subtitle,
      art: detail?.art ?? item.art,
    }),
    [item, detail],
  );

  // Missing/expired Amazon session on the device (see the search view for why
  // NOT_CONFIGURED is grouped with UNAUTHORIZED here).
  const unauthorized =
    error instanceof ApiError &&
    (error.code === "UNAUTHORIZED" || error.code === "NOT_CONFIGURED");

  const pendingAll = playingId === item.id;
  // Row-level pending key: the play request for a tapped row carries the
  // CONTAINER's id (see PlayOptions), so rows track their own pending state.
  // The index keeps duplicate playlist entries from spinning together.
  const rowId = (t: StreamTrack, i: number) => `${t.id}:${i}`;

  return (
    <>
      {/* Top bar: back to the layer beneath + context title. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="focus-ring grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
          {header.title}
        </h2>
        <Dialog.Close asChild>
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
        </Dialog.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1.25rem+env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch]">
        {/* Hero: big artwork + identity, on a soft violet wash that fades out. */}
        <div className="relative px-4 pb-4 pt-5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.14] via-primary/[0.05] to-transparent"
          />
          <div className="relative flex items-end gap-4">
            <div className="size-32 shrink-0 shadow-2xl shadow-black/60 sm:size-36">
              <Art deviceId={deviceId} item={header} className="rounded-2xl" iconClassName="size-10" />
            </div>
            <div className="min-w-0 flex-1 pb-0.5">
              <span className="inline-flex items-center rounded-full border border-border bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {KIND_LABEL[item.kind]}
              </span>
              <h3 className="mt-1.5 line-clamp-2 text-xl font-bold leading-tight text-foreground">
                {header.title}
              </h3>
              {header.subtitle && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{header.subtitle}</p>
              )}
            </div>
          </div>
          <div className="relative mt-4 flex items-center gap-3">
            <Button
              onClick={() => onPlay(header)}
              disabled={pendingAll}
              aria-label={`Play all of ${header.title}`}
              className="px-6"
            >
              {pendingAll ? <Spinner className="size-5" /> : <Play className="size-5" />}
              Play all
            </Button>
            {detail && tracks.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {tracks.length} song{tracks.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {/* Tracklist */}
        <div className="px-4">
          {isLoading ? (
            <TracklistSkeleton />
          ) : unauthorized ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Music className="size-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">
                Amazon Music isn&apos;t connected
              </p>
              <p className="text-sm text-muted-foreground">
                Connect Amazon Music in the WiiM app, then try again.
              </p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="text-sm text-destructive">
                {(error as ApiError).message || "Could not load the tracklist."}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void mutate()}>
                Retry
              </Button>
            </div>
          ) : tracks.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tracks.</p>
          ) : (
            <ol className="space-y-0.5 pb-2">
              {tracks.map((t, i) => {
                const pending = playingId === rowId(t, i);
                // Albums repeat the album artist on every row — only surface a
                // per-track artist when it adds information.
                const showArtist = !!t.artist && t.artist !== header.subtitle;
                return (
                  <motion.li
                    // A playlist can contain the same track twice — index keeps keys unique.
                    key={`${t.id}:${i}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.025, 0.35), duration: 0.28, ease: "easeOut" }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onPlay(header, {
                          startIndex: i + 1,
                          pendingId: rowId(t, i),
                          label: t.title,
                        })
                      }
                      disabled={pending}
                      title={`Play from ${t.title}`}
                      className="focus-ring group flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-white/5"
                    >
                      {/* Index column doubles as the play affordance / pending spinner. */}
                      <span className="relative grid size-7 shrink-0 place-items-center" aria-hidden>
                        {pending ? (
                          <Spinner className="size-4 text-primary" />
                        ) : (
                          <>
                            <span className="text-sm tabular-nums text-muted-foreground/60 transition group-hover:opacity-0 group-focus-visible:opacity-0">
                              {i + 1}
                            </span>
                            <Play className="absolute size-4 text-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />
                          </>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-sm font-medium",
                            pending ? "text-primary" : "text-foreground",
                          )}
                        >
                          {t.title}
                        </span>
                        {showArtist && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {t.artist}
                          </span>
                        )}
                      </span>
                      {t.duration && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
                          {t.duration}
                        </span>
                      )}
                    </button>
                  </motion.li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}

/** Placeholder rows while the tracklist loads (the hero is already painted). */
function TracklistSkeleton() {
  const widths = ["w-3/5", "w-2/3", "w-1/2", "w-3/4", "w-2/5"];
  return (
    <div role="status" aria-label="Loading tracks" className="animate-pulse space-y-0.5 pb-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-3">
          <span className="grid size-7 shrink-0 place-items-center">
            <span className="size-2 rounded-full bg-white/10" />
          </span>
          <span className={cn("h-3.5 rounded-md bg-white/5", widths[i % widths.length])} />
          <span className="ml-auto h-3 w-8 shrink-0 rounded-md bg-white/5" />
        </div>
      ))}
    </div>
  );
}
