"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Music, Play, Search, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { apiGet, apiSend, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
// Shared client-local streaming primitives (type mirrors, Art, kind routing)
// live in the detail-view module so the dependency stays one-way.
import {
  Art,
  CONTAINER_KINDS,
  StreamingDetailView,
  type PlayOptions,
  type StreamItem,
} from "@/components/dashboard/streaming-detail-view";

type SearchResults = {
  tracks: StreamItem[];
  albums: StreamItem[];
  artists: StreamItem[];
  playlists: StreamItem[];
  userPlaylists: StreamItem[];
};

const EMPTY_RESULTS: SearchResults = {
  tracks: [],
  albums: [],
  artists: [],
  playlists: [],
  userPlaylists: [],
};

// Per-category paginated browse ("See all"), served by the web catalog only.
type BrowseCategory = "tracks" | "albums" | "artists" | "playlists" | "userPlaylists";
type BrowseResponse = { ok: true; items: StreamItem[]; nextToken: string | null };
type BrowseKey = readonly ["stream-browse", string, string, BrowseCategory, string];

const CATEGORY_LABEL: Record<BrowseCategory, string> = {
  tracks: "Tracks",
  albums: "Albums",
  artists: "Artists",
  playlists: "Playlists",
  userPlaylists: "Community Playlists",
};

// Curated genre/mood rows for the pre-search landing, served by the anonymous
// web catalog (so they render regardless of the selected source).
type HomeRow = { title: string; items: StreamItem[] };

/**
 * Full-screen Amazon Music surface. Before a query it shows a browsable Home
 * of curated rows; searching replaces it with results. Tracks (and artists)
 * play on tap; albums and playlists open an in-panel detail view with the
 * tracklist. Playback feedback is per-item: the tapped row/tile carries a
 * spinner while the request is in flight instead of the whole surface locking
 * up. Opening with `initialItem` set deep-links straight into that item.
 */
export function StreamingSearchView({
  deviceId,
  open,
  initialItem,
  onOpenChange,
  onPlayed,
}: {
  deviceId: string;
  open: boolean;
  /**
   * Deep-link target (from the dashboard card's Discover tiles). When the
   * view opens with this set, containers (album/playlist) open their detail
   * layer directly — the Home landing stays mounted beneath, so backing out
   * of the detail lands there as usual — while tracks/artists play
   * immediately. Undefined opens the plain Home/search landing.
   */
  initialItem?: StreamItem;
  onOpenChange: (open: boolean) => void;
  onPlayed: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // Id of the item whose play request is in flight — only that row/tile shows
  // a pending state; everything else stays interactive.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playingRef = useRef<string | null>(null);
  // "web" (anonymous catalog) is richer and is the default; not reset on
  // re-open so a source picked mid-session sticks around for comparison.
  const [source, setSource] = useState<"web" | "device">("web");
  // Non-null while a category is expanded into its full paginated view.
  const [expanded, setExpanded] = useState<BrowseCategory | null>(null);
  // Non-null while an album/playlist detail layer is open on top.
  const [detail, setDetail] = useState<StreamItem | null>(null);

  // Every open starts from a clean box. With an `initialItem` the view routes
  // straight into it via the same rules as `select()`: containers open their
  // detail layer over the landing (the layer beneath keeps the landing, so
  // closing the detail isn't a trap), everything else plays right away. The
  // parent sets `initialItem` in the same commit as `open`, so re-opens with a
  // different tile re-route correctly. Without one, the search box grabs focus
  // once Radix has mounted the portal content (hence the small delay). The
  // chosen source is deliberately left alone here — see the `source` state.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setDebounced("");
    setExpanded(null);
    if (initialItem && CONTAINER_KINDS.has(initialItem.kind)) {
      setDetail(initialItem);
      return;
    }
    setDetail(null);
    if (initialItem) {
      void play(initialItem);
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // `play` is an unmemoized closure over current props — run on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialItem]);

  // ~350ms debounce so we don't hit the device (and Amazon behind it) on
  // every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const active = open && debounced.length >= 2;
  const { data, error, isLoading } = useSWR<{ ok: true; results: SearchResults }>(
    active ? ["stream-search", deviceId, debounced, source] : null,
    (k: string[]) =>
      apiGet<{ ok: true; results: SearchResults }>(
        `/api/devices/${k[1]}/streaming/amazon/search?q=${encodeURIComponent(k[2]!)}&source=${k[3]}`,
      ),
    { revalidateOnFocus: false, dedupingInterval: 1000 },
  );
  const results = data?.results ?? EMPTY_RESULTS;
  const noResults =
    active &&
    !isLoading &&
    !error &&
    results.tracks.length === 0 &&
    results.albums.length === 0 &&
    results.artists.length === 0 &&
    results.playlists.length === 0 &&
    results.userPlaylists.length === 0;
  // The device's Amazon session lives in the WiiM app, not here — a missing
  // or expired one surfaces as UNAUTHORIZED (see lib/streaming/amazon/token.ts).
  // The web catalog is anonymous, so this can't happen on that tab — treat it
  // as a plain error there instead of showing the "connect Amazon" copy.
  const unauthorized =
    source === "device" &&
    error instanceof ApiError &&
    (error.code === "UNAUTHORIZED" || error.code === "NOT_CONFIGURED");

  // One name per results-region state, so the landing → loading → results
  // swap can crossfade as a unit (the motion wrapper below keys on this).
  const view = !active
    ? "home"
    : isLoading
      ? "loading"
      : unauthorized
        ? "unauthorized"
        : error
          ? "error"
          : noResults
            ? "empty"
            : "results";

  /**
   * Optimistic play: mark the tapped element pending and toast right away —
   * the device round-trip can take seconds, and silence reads as a broken tap.
   * A bare `play(item)` queues the item from the top; a detail row passes the
   * CONTAINER plus `startIndex` (see PlayOptions) so the device gets the full
   * queue starting at that track — `pendingId`/`label` keep the spinner and
   * toast on the tapped row. Success closes the panel as before; failure
   * clears the pending element and reports the error.
   */
  async function play(item: StreamItem, opts?: PlayOptions) {
    const pendingId = opts?.pendingId ?? item.id;
    const label = opts?.label ?? item.title;
    playingRef.current = pendingId;
    setPlayingId(pendingId);
    toast(`Playing ${label}…`, "info");
    try {
      await apiSend(`/api/devices/${deviceId}/streaming/amazon/play`, "POST", {
        id: item.id,
        kind: item.kind,
        ...(opts?.startIndex !== undefined ? { startIndex: opts.startIndex } : {}),
      });
      onPlayed();
      onOpenChange(false);
    } catch (e) {
      toast((e as ApiError).message || `Could not play ${label}`, "error");
    } finally {
      // A newer tap may have superseded this request — only the latest one
      // owns (and clears) the pending state.
      if (playingRef.current === pendingId) {
        playingRef.current = null;
        setPlayingId(null);
      }
    }
  }

  /** Tap router: containers (album/playlist) open detail; the rest plays. */
  function select(item: StreamItem) {
    if (CONTAINER_KINDS.has(item.kind)) setDetail(item);
    else void play(item);
  }

  // "See all" exists only on the Catalog source — the browse endpoint is
  // web-only, so the affordance is hidden entirely on the Device tab.
  const seeAll = (category: BrowseCategory) =>
    source === "web" ? (
      <SeeAll label={CATEGORY_LABEL[category]} onClick={() => setExpanded(category)} />
    ) : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
              />
            </Dialog.Overlay>

            {/* The panel itself covers the whole viewport — this is a
                near-native search surface, not a centered card. */}
            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                className="fixed inset-0 z-[95] flex flex-col overflow-hidden bg-background"
              >
                <Dialog.Title className="sr-only">Search Amazon Music</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Browse curated music rows, or search tracks, albums, artists and playlists.
                  Tap a track to play it, or an album or playlist to see its songs.
                </Dialog.Description>

                {/* Two stacked screens: the search surface, and (on "See all")
                    a full paginated category view sliding in over it. The
                    detail layer overlays both (kept out of this exchange so
                    the category's pages/scroll survive a detail round-trip),
                    and `inert` removes what's beneath from the tab order. */}
                <div
                  inert={detail ? true : undefined}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {expanded ? (
                      <motion.div
                        key={`category-${expanded}`}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 24 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="flex min-h-0 flex-1 flex-col"
                      >
                        <ExpandedCategory
                          deviceId={deviceId}
                          query={debounced}
                          category={expanded}
                          playingId={playingId}
                          onSelect={select}
                          onBack={() => setExpanded(null)}
                        />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="search"
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -24 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="flex min-h-0 flex-1 flex-col"
                      >
                        {/* Header: search field + cancel, pinned above the safe area
                            (this panel is `fixed inset-0`, so it doesn't inherit the
                            body's own safe-area padding). */}
                        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                          <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
                            <input
                              ref={inputRef}
                              type="text"
                              inputMode="search"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                              placeholder="Search Amazon Music…"
                              aria-label="Search Amazon Music"
                              className="focus-ring h-11 w-full rounded-xl border border-border bg-input pl-9 pr-9 text-base text-foreground placeholder:text-muted-foreground/60"
                            />
                            {query && (
                              <button
                                type="button"
                                onClick={() => setQuery("")}
                                aria-label="Clear"
                                className="focus-ring absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                              >
                                <X className="size-4" />
                              </button>
                            )}
                          </div>
                          <Dialog.Close asChild>
                            <Button variant="ghost" size="sm">
                              Cancel
                            </Button>
                          </Dialog.Close>
                        </div>

                        {/* Source toggle: catalog (anonymous, richer) vs. the device's
                            own Amazon session — kept side by side so results can be
                            compared without leaving the view. */}
                        <div className="mx-4 mb-1 mt-3 flex shrink-0 rounded-xl border border-border bg-input p-1">
                          {(
                            [
                              { value: "web", label: "Catalog" },
                              { value: "device", label: "Device" },
                            ] as const
                          ).map((tab) => (
                            <button
                              key={tab.value}
                              type="button"
                              onClick={() => setSource(tab.value)}
                              aria-pressed={source === tab.value}
                              className={cn(
                                "focus-ring flex-1 rounded-lg py-1.5 text-sm font-medium transition",
                                source === tab.value
                                  ? "bg-white/10 text-foreground"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        {/* Results region: keyed crossfade between the browse
                            landing, the loading state and the result list, so
                            typing (and clearing) a query reads as one motion
                            instead of content popping. */}
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch]">
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                              key={view}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -6 }}
                              transition={{ duration: 0.16, ease: "easeOut" }}
                            >
                              {view === "home" ? (
                                <HomeLanding
                                  deviceId={deviceId}
                                  playingId={playingId}
                                  onSelect={select}
                                />
                              ) : view === "loading" ? (
                                <div className="flex min-h-[60vh] items-center justify-center">
                                  <Spinner className="size-7 text-primary" />
                                </div>
                              ) : view === "unauthorized" ? (
                                <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center">
                                  <Music className="size-8 text-muted-foreground/40" />
                                  <p className="text-sm font-medium text-foreground">
                                    Amazon Music isn&apos;t connected
                                  </p>
                                  <p className="text-sm text-muted-foreground">
                                    Connect Amazon Music in the WiiM app, then try again.
                                  </p>
                                </div>
                              ) : view === "error" ? (
                                <p className="py-16 text-center text-sm text-destructive">
                                  {(error as ApiError).message || "Search failed."}
                                </p>
                              ) : view === "empty" ? (
                                <p className="py-16 text-center text-sm text-muted-foreground">
                                  No results.
                                </p>
                              ) : (
                                <div className="space-y-6 py-4">
                                  {results.tracks.length > 0 && (
                                    <Section title="Tracks" action={seeAll("tracks")}>
                                      <ul className="space-y-0.5">
                                        {results.tracks.map((t) => (
                                          <TrackRow
                                            key={t.id}
                                            item={t}
                                            deviceId={deviceId}
                                            playingId={playingId}
                                            onSelect={select}
                                          />
                                        ))}
                                      </ul>
                                    </Section>
                                  )}
                                  {results.albums.length > 0 && (
                                    <Section title="Albums" action={seeAll("albums")}>
                                      <TileRow
                                        items={results.albums}
                                        deviceId={deviceId}
                                        playingId={playingId}
                                        onSelect={select}
                                      />
                                    </Section>
                                  )}
                                  {results.artists.length > 0 && (
                                    <Section title="Artists" action={seeAll("artists")}>
                                      <TileRow
                                        items={results.artists}
                                        deviceId={deviceId}
                                        playingId={playingId}
                                        onSelect={select}
                                        round
                                      />
                                    </Section>
                                  )}
                                  {results.playlists.length > 0 && (
                                    <Section title="Playlists" action={seeAll("playlists")}>
                                      <TileRow
                                        items={results.playlists}
                                        deviceId={deviceId}
                                        playingId={playingId}
                                        onSelect={select}
                                      />
                                    </Section>
                                  )}
                                  {results.userPlaylists.length > 0 && (
                                    <Section
                                      title="Community Playlists"
                                      action={seeAll("userPlaylists")}
                                    >
                                      <TileRow
                                        items={results.userPlaylists}
                                        deviceId={deviceId}
                                        playingId={playingId}
                                        onSelect={select}
                                      />
                                    </Section>
                                  )}
                                </div>
                              )}
                            </motion.div>
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Detail layer: slides in over whichever screen is beneath and
                    leaves it mounted, so backing out restores list position. */}
                <AnimatePresence>
                  {detail && (
                    <motion.div
                      key={`detail-${detail.kind}-${detail.id}`}
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 24 }}
                      transition={{ type: "spring", stiffness: 380, damping: 34 }}
                      className="absolute inset-0 z-10 flex flex-col bg-background"
                    >
                      <StreamingDetailView
                        deviceId={deviceId}
                        item={detail}
                        playingId={playingId}
                        onPlay={play}
                        onBack={() => setDetail(null)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/**
 * Full-category view behind "See all": every page of one category from the
 * paginated browse route, appended as an infinite list. Tracks render as rows;
 * everything else as a wrapping artwork grid. More pages load as the sentinel
 * at the bottom scrolls into view, until the route reports no continuation.
 */
function ExpandedCategory({
  deviceId,
  query,
  category,
  playingId,
  onSelect,
  onBack,
}: {
  deviceId: string;
  query: string;
  category: BrowseCategory;
  playingId: string | null;
  onSelect: (item: StreamItem) => void;
  onBack: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // The layer replaces the search surface (input included), so move focus to
  // its back control on entry.
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  // One SWR-infinite page per browse page: page 0 has no cursor; page N+1 uses
  // page N's nextToken; a null nextToken ends the sequence (getKey → null).
  const getKey = (index: number, prev: BrowseResponse | null): BrowseKey | null => {
    if (index === 0) return ["stream-browse", deviceId, query, category, ""];
    if (!prev || prev.nextToken === null) return null;
    return ["stream-browse", deviceId, query, category, prev.nextToken];
  };
  const { data, error, size, setSize, mutate } = useSWRInfinite<BrowseResponse>(
    getKey,
    (key: BrowseKey) => {
      const [, dev, q, cat, next] = key;
      return apiGet<BrowseResponse>(
        `/api/devices/${dev}/streaming/amazon/browse?q=${encodeURIComponent(q)}&category=${cat}` +
          (next ? `&next=${encodeURIComponent(next)}` : ""),
      );
    },
    { revalidateOnFocus: false, revalidateFirstPage: false },
  );

  const isLoadingInitial = !data && !error;
  const isLoadingMore =
    !error &&
    (isLoadingInitial || (size > 0 && data !== undefined && typeof data[size - 1] === "undefined"));
  const lastLoaded = data?.[data.length - 1];
  const hasMore = lastLoaded ? lastLoaded.nextToken !== null : false;

  // Pages can overlap at the seams — dedupe across the whole list (the server
  // only dedupes within a single page).
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: StreamItem[] = [];
    for (const page of data ?? []) {
      for (const item of page.items) {
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }, [data]);

  // Infinite scroll: when the sentinel enters the (pre-extended) viewport and
  // another page exists, request it. The observer is rebuilt each time loading
  // settles, so a sentinel still in view immediately pulls the next page.
  useEffect(() => {
    if (!hasMore || isLoadingMore || error) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void setSize((s) => s + 1);
      },
      { root: scrollRef.current, rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isLoadingMore, error, setSize]);

  return (
    <>
      {/* Header: back to the search results + category context. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          aria-label="Back to search results"
          className="focus-ring grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">
            {CATEGORY_LABEL[category]}
          </h2>
          <p className="truncate text-xs text-muted-foreground">&ldquo;{query}&rdquo;</p>
        </div>
        <Dialog.Close asChild>
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
        </Dialog.Close>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch]"
      >
        {items.length === 0 && isLoadingMore ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Spinner className="size-7 text-primary" />
          </div>
        ) : items.length === 0 && error ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-destructive">
              {(error as ApiError).message || "Could not load this category."}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void mutate()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No results.</p>
        ) : (
          <>
            {category === "tracks" ? (
              <ul className="space-y-0.5 py-4">
                {items.map((t) => (
                  <TrackRow
                    key={`${t.kind}:${t.id}`}
                    item={t}
                    deviceId={deviceId}
                    playingId={playingId}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            ) : (
              <div className="grid grid-cols-3 gap-3 py-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {items.map((item) => (
                  <GridTile
                    key={`${item.kind}:${item.id}`}
                    item={item}
                    deviceId={deviceId}
                    playingId={playingId}
                    onSelect={onSelect}
                    round={category === "artists"}
                  />
                ))}
              </div>
            )}

            {error ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <p className="text-sm text-destructive">Couldn&apos;t load more.</p>
                <Button variant="ghost" size="sm" onClick={() => void mutate()}>
                  Retry
                </Button>
              </div>
            ) : isLoadingMore ? (
              <div role="status" aria-label="Loading more" className="flex justify-center py-5">
                <Spinner className="size-6 text-primary" />
              </div>
            ) : !hasMore ? (
              <p className="py-6 text-center text-xs text-muted-foreground">End of results.</p>
            ) : null}
          </>
        )}
        {/* Load-more sentinel — inside the scroller so the observer roots on it. */}
        <div ref={sentinelRef} aria-hidden className="h-px" />
      </div>
    </>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Section-header "See all" affordance — opens the paginated category layer. */
function SeeAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`See all ${label}`}
      className="focus-ring -my-1 flex shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-medium text-primary transition hover:bg-white/5"
    >
      See all
      <ChevronRight className="size-3.5" />
    </button>
  );
}

/**
 * Pre-search landing: curated genre/mood rows from the anonymous web catalog.
 * Fetched once per session (the key is query-independent, so keystrokes never
 * refetch it, and `revalidateIfStale: false` keeps the cached rows across the
 * landing ⇄ results swaps). Loading paints skeleton rows in the tiles'
 * geometry; a failed or empty fetch quietly falls back to the plain search
 * placeholder — the landing never surfaces an error state.
 */
function HomeLanding({
  deviceId,
  playingId,
  onSelect,
}: {
  deviceId: string;
  playingId: string | null;
  onSelect: (item: StreamItem) => void;
}) {
  const { data, error, isLoading } = useSWR<{ ok: true; rows: HomeRow[] }>(
    ["stream-home", deviceId],
    (k: string[]) =>
      apiGet<{ ok: true; rows: HomeRow[] }>(`/api/devices/${k[1]}/streaming/amazon/home`),
    { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 60_000 },
  );
  const rows = (data?.rows ?? []).filter((row) => row.items.length > 0);

  if (isLoading) return <HomeSkeleton />;
  if (error || rows.length === 0) return <SearchPlaceholder />;

  return (
    <div className="space-y-6 py-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="pt-1"
      >
        <h2 className="text-lg font-bold text-foreground">Discover</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Fresh picks from Amazon Music — or search for anything.
        </p>
      </motion.div>
      {rows.map((row, i) => (
        <motion.div
          // Titles are server-curated and can collide — index keeps keys
          // unique while the fetched list itself never reorders.
          key={`${i}:${row.title}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(0.05 + i * 0.06, 0.4), duration: 0.3, ease: "easeOut" }}
        >
          <Section title={row.title}>
            <TileRow
              items={row.items}
              deviceId={deviceId}
              playingId={playingId}
              onSelect={onSelect}
              round={row.items.every((item) => item.kind === "artist")}
            />
          </Section>
        </motion.div>
      ))}
    </div>
  );
}

/** Skeleton rows in the landing's exact geometry (heading, headers, w-28 tiles). */
function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading music picks" className="animate-pulse space-y-6 py-4">
      <div className="space-y-2 pt-1">
        <div className="h-5 w-28 rounded-md bg-white/10" />
        <div className="h-3 w-52 rounded-md bg-white/5" />
      </div>
      {Array.from({ length: 3 }, (_, row) => (
        <div key={row}>
          <div className="mb-2 h-3.5 w-32 rounded-md bg-white/10" />
          <div className="-mx-4 flex gap-3 overflow-hidden px-4 pb-1">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="w-28 shrink-0 p-1">
                <div className="size-28 rounded-xl bg-white/5" />
                <div className="mt-2 h-3 w-20 rounded-md bg-white/5" />
                <div className="mt-1 h-2.5 w-14 rounded-md bg-white/[0.03]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Bare pre-search copy — the landing's fallback when Home rows aren't available. */
function SearchPlaceholder() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <Search className="size-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">Search Amazon Music</p>
      <p className="text-xs text-muted-foreground/60">
        Tracks play right away — albums and playlists open their songs.
      </p>
    </div>
  );
}

/** A single track hit, rendered as a full-width row (mirrors browse-dialog's track rows). */
function TrackRow({
  item,
  deviceId,
  playingId,
  onSelect,
}: {
  item: StreamItem;
  deviceId: string;
  playingId: string | null;
  onSelect: (item: StreamItem) => void;
}) {
  const pending = playingId === item.id;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item)}
        disabled={pending}
        title={`Play ${item.title}`}
        className="focus-ring group flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-white/5"
      >
        <div className="relative size-11 shrink-0">
          <Art deviceId={deviceId} item={item} />
          <span
            className={cn(
              "pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-black/45 transition",
              pending ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {pending ? (
              <Spinner className="size-5 text-white" />
            ) : (
              <Play className="size-5 text-white" />
            )}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium",
              pending ? "text-primary" : "text-foreground",
            )}
          >
            {item.title}
          </p>
          {item.subtitle && (
            <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
          )}
        </div>
      </button>
    </li>
  );
}

/**
 * Shared innards of the horizontal-row and grid tiles. Containers (albums,
 * playlists) open their detail view, so they get an "Open" affordance rather
 * than a misleading play overlay; tracks/artists keep tap-to-play.
 */
function TileArt({
  item,
  deviceId,
  pending,
  opens,
  round,
  className,
}: {
  item: StreamItem;
  deviceId: string;
  pending: boolean;
  opens: boolean;
  round?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <Art deviceId={deviceId} item={item} round={round} />
      {(pending || !opens) && (
        <span
          className={cn(
            "pointer-events-none absolute inset-0 grid place-items-center bg-black/45 transition",
            round ? "rounded-full" : "rounded-xl",
            pending ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          {pending ? (
            <Spinner className="size-6 text-white" />
          ) : (
            <Play className="size-6 text-white" />
          )}
        </span>
      )}
    </div>
  );
}

/** Albums/artists/playlists render as a horizontally scrollable row of artwork tiles. */
function TileRow({
  items,
  deviceId,
  playingId,
  onSelect,
  round,
}: {
  items: StreamItem[];
  deviceId: string;
  playingId: string | null;
  onSelect: (item: StreamItem) => void;
  round?: boolean;
}) {
  return (
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [-webkit-overflow-scrolling:touch]">
      {items.map((item) => {
        const pending = playingId === item.id;
        const opens = CONTAINER_KINDS.has(item.kind);
        return (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            onClick={() => onSelect(item)}
            disabled={pending}
            title={opens ? `Open ${item.title}` : `Play ${item.title}`}
            className="focus-ring group flex w-28 shrink-0 flex-col gap-2 rounded-2xl p-1 text-left transition hover:bg-white/5"
          >
            <TileArt
              item={item}
              deviceId={deviceId}
              pending={pending}
              opens={opens}
              round={round}
              className="size-28"
            />
            <div className="min-w-0">
              <p
                className={cn(
                  "truncate text-xs font-medium",
                  pending ? "text-primary" : "text-foreground",
                )}
              >
                {item.title}
              </p>
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

/** Fluid artwork tile for the expanded category grid (wraps; no horizontal scroll). */
function GridTile({
  item,
  deviceId,
  playingId,
  onSelect,
  round,
}: {
  item: StreamItem;
  deviceId: string;
  playingId: string | null;
  onSelect: (item: StreamItem) => void;
  round?: boolean;
}) {
  const pending = playingId === item.id;
  const opens = CONTAINER_KINDS.has(item.kind);
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      disabled={pending}
      title={opens ? `Open ${item.title}` : `Play ${item.title}`}
      className="focus-ring group flex w-full min-w-0 flex-col gap-2 rounded-2xl p-1 text-left transition hover:bg-white/5"
    >
      <TileArt
        item={item}
        deviceId={deviceId}
        pending={pending}
        opens={opens}
        round={round}
        className="aspect-square w-full"
      />
      <div className="w-full min-w-0">
        <p
          className={cn(
            "truncate text-xs font-medium",
            pending ? "text-primary" : "text-foreground",
          )}
        >
          {item.title}
        </p>
        {item.subtitle && (
          <p className="truncate text-[11px] text-muted-foreground">{item.subtitle}</p>
        )}
      </div>
    </button>
  );
}
