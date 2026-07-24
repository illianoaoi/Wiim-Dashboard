import "server-only";
import { browseCategory, type BrowseCategory } from "./web-browse";
import type { StreamItem } from "../types";

/**
 * Curated Amazon Music "Home" rows for the streaming landing view: a fixed
 * set of genre/mood shelves filled with real catalog tiles from the anonymous
 * mesk browse endpoints (`web-browse.ts`) — no device session or bearer token
 * involved. Each row is one first-page `browseCategory` call (~10 items);
 * rows whose fetch fails or comes back empty are dropped so a partial home
 * still renders instead of the whole endpoint failing.
 *
 * The assembled result is cached in-process for 15 minutes (with concurrent
 * first-loads coalesced onto one build), mirroring the light in-memory cache
 * style used elsewhere (e.g. the DLNA search index) — repeat opens of the
 * landing are instant and Amazon isn't re-hit on every navigation.
 */

export interface HomeRow {
  title: string;
  items: StreamItem[];
}

/** Curated shelves, in display order. */
const ROWS: ReadonlyArray<{
  title: string;
  query: string;
  category: BrowseCategory;
}> = [
  { title: "Jazz", query: "jazz", category: "albums" },
  { title: "Rock", query: "rock", category: "albums" },
  { title: "Pop", query: "pop", category: "albums" },
  { title: "Hip-Hop", query: "hip hop", category: "albums" },
  { title: "Electronic", query: "electronic", category: "albums" },
  { title: "Classical", query: "classical", category: "albums" },
  { title: "Focus", query: "focus", category: "playlists" },
  { title: "Workout", query: "workout", category: "playlists" },
];

const CACHE_TTL_MS = 15 * 60 * 1000;

let cache: { at: number; home: { rows: HomeRow[] } } | null = null;
let inFlight: Promise<{ rows: HomeRow[] }> | null = null;

async function buildHome(): Promise<{ rows: HomeRow[] }> {
  // ~8 anonymous calls — small enough to fan out in one Promise.all wave.
  // Each row catches its own failure so one bad shelf never sinks the rest.
  const rows = await Promise.all(
    ROWS.map(async ({ title, query, category }): Promise<HomeRow | null> => {
      try {
        const page = await browseCategory(query, category);
        return page.items.length > 0 ? { title, items: page.items } : null;
      } catch {
        return null;
      }
    }),
  );
  return { rows: rows.filter((r): r is HomeRow => r !== null) };
}

/** Curated home rows, served from the in-process cache when fresh. */
export async function fetchAmazonHome(): Promise<{ rows: HomeRow[] }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.home;
  if (inFlight) return inFlight;
  inFlight = buildHome()
    .then((home) => {
      // Only cache a non-empty home: an all-rows-failed build (e.g. transient
      // network trouble) should retry on the next request, not stick for 15 min.
      if (home.rows.length > 0) cache = { at: Date.now(), home };
      return home;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
