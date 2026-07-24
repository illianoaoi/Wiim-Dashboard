"use client";

import { useState } from "react";
import useSWR from "swr";
import { motion } from "framer-motion";
import { Music, Play, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { StreamingSearchView } from "./streaming-search-view";
// Shared client-local streaming primitives (Art, kind routing) live in the
// detail-view module so the dependency stays one-way.
import {
  Art,
  CONTAINER_KINDS,
  type StreamItem,
} from "@/components/dashboard/streaming-detail-view";

/** One curated row from the anonymous Amazon home feed (same shape as the view's landing). */
type HomeRow = { title: string; items: StreamItem[] };

/** Inline rows are a preview — the full set lives in the full-screen surface. */
const MAX_ROWS = 4;
/** Cap tiles per row to keep the dashboard scrollers light. */
const MAX_TILES = 12;

/**
 * Amazon Music section of the dashboard home. Renders the anonymous catalog's
 * Discover rows inline — compact, horizontally-scrollable tiles of albums,
 * playlists and artists — with the full-screen search surface one tap away.
 * Tapping a tile opens the surface deep-linked into that item (containers show
 * their tracklist; tracks/artists play); the Search affordance opens it on the
 * plain landing. If the feed errors or comes back empty, the card quietly
 * degrades to the old header + Search layout — Discover never shows an error.
 */
export function StreamingSearchCard({
  deviceId,
  onChanged,
}: {
  deviceId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Deep-link target for the full-screen view: set by a tile tap, cleared by
  // the Search affordance so that opens on the plain landing instead.
  const [initialItem, setInitialItem] = useState<StreamItem | undefined>(undefined);

  // Same data the full surface's landing uses; the server caches it for
  // 15 min, so the generous dedupe keeps dashboard re-mounts free.
  const { data, error, isLoading } = useSWR<{ ok: true; rows: HomeRow[] }>(
    ["stream-home-card", deviceId],
    (k: string[]) =>
      apiGet<{ ok: true; rows: HomeRow[] }>(`/api/devices/${k[1]}/streaming/amazon/home`),
    { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 10 * 60_000 },
  );
  const rows = (data?.rows ?? []).filter((row) => row.items.length > 0).slice(0, MAX_ROWS);
  const degraded = !isLoading && (Boolean(error) || rows.length === 0);

  function openSearch() {
    setInitialItem(undefined);
    setOpen(true);
  }
  function openItem(item: StreamItem) {
    setInitialItem(item);
    setOpen(true);
  }

  return (
    <Card className="p-5">
      {/* Header: identity + the search affordance. In the degraded state this
          row IS the whole card — exactly the old simple layout. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground">
            <Music className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Amazon Music
            </h3>
            {degraded && (
              <p className="text-xs text-muted-foreground">
                Search songs, albums, artists and playlists
              </p>
            )}
          </div>
        </div>
        <Button variant="primary" onClick={openSearch}>
          <Search className="size-5" /> Search
        </Button>
      </div>

      {isLoading ? (
        <DiscoverSkeleton />
      ) : !degraded ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <h4 className="mt-4 text-sm font-semibold text-foreground">Discover</h4>
          <div className="mt-2.5 space-y-4">
            {rows.map((row, i) => (
              // Titles are server-curated and can collide — index keeps keys
              // unique while the fetched list itself never reorders.
              <section key={`${i}:${row.title}`}>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">{row.title}</p>
                <TileStrip row={row} deviceId={deviceId} onSelect={openItem} />
              </section>
            ))}
          </div>
        </motion.div>
      ) : null}

      <StreamingSearchView
        deviceId={deviceId}
        open={open}
        initialItem={initialItem}
        onOpenChange={setOpen}
        onPlayed={onChanged}
      />
    </Card>
  );
}

/**
 * One Discover row: compact artwork tiles in a horizontal scroller that bleeds
 * to the card edge (-mx-5 cancels the card's p-5, so nothing can widen the
 * page). Containers open their detail in the full-screen view; tracks/artists
 * play — the view owns the toast/pending feedback either way.
 */
function TileStrip({
  row,
  deviceId,
  onSelect,
}: {
  row: HomeRow;
  deviceId: string;
  onSelect: (item: StreamItem) => void;
}) {
  const round = row.items.every((item) => item.kind === "artist");
  return (
    <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1 [-webkit-overflow-scrolling:touch]">
      {row.items.slice(0, MAX_TILES).map((item) => {
        const opens = CONTAINER_KINDS.has(item.kind);
        const action = opens ? `Open ${item.title}` : `Play ${item.title}`;
        return (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            onClick={() => onSelect(item)}
            aria-label={action}
            title={action}
            className="focus-ring group flex w-24 shrink-0 flex-col gap-1.5 rounded-xl p-1 text-left transition hover:bg-white/5"
          >
            <div className="relative aspect-square w-full">
              <Art deviceId={deviceId} item={item} round={round} />
              {/* Containers just open — only immediate-play kinds get the
                  play overlay (mirrors the search view's tiles). */}
              {!opens && (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100",
                    round ? "rounded-full" : "rounded-xl",
                  )}
                >
                  <Play className="size-5 text-white" />
                </span>
              )}
            </div>
            <div className="w-full min-w-0">
              <p className="truncate text-xs font-medium text-foreground">{item.title}</p>
              {item.subtitle && (
                <p className="truncate text-[11px] text-muted-foreground">{item.subtitle}</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Shimmer placeholders in the Discover rows' exact geometry (label + w-24 tiles). */
function DiscoverSkeleton() {
  return (
    <div role="status" aria-label="Loading music picks" className="animate-pulse">
      <div className="mt-4 h-4 w-20 rounded-md bg-white/10" />
      <div className="mt-2.5 space-y-4">
        {Array.from({ length: 2 }, (_, row) => (
          <div key={row}>
            <div className="mb-1.5 h-3 w-16 rounded-md bg-white/10" />
            <div className="-mx-5 flex gap-2.5 overflow-hidden px-5 pb-1">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="w-24 shrink-0 p-1">
                  <div className="aspect-square w-full rounded-xl bg-white/5" />
                  <div className="mt-1.5 h-3 w-16 rounded-md bg-white/5" />
                  <div className="mt-1 h-2.5 w-12 rounded-md bg-white/[0.03]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
