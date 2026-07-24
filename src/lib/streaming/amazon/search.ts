import "server-only";
import type { Device } from "@/lib/db/devices";
import { amazonApiFetch } from "./http";
import { getAmazonBearer } from "./token";
import { StreamingError, type SearchResults, type StreamItem, type StreamKind } from "../types";

/**
 * Amazon Music catalog search.
 *
 * The response is Amazon's hypermedia document (matching the WiiM app's own
 * AMParseModel): a set of top-level maps referenced by key. Displayable results
 * live in `itemDescriptions`, ordered by `navigationNodeDescriptions[result].items`.
 * Each item's TYPE comes from its key prefix (…_track_/_album_/_artist_/_playlist_),
 * its artwork from `image.uri` (used verbatim — no size template), and its ASIN
 * from the linked `playables[…].self` reference. Parsing mirrors the app exactly.
 */

const MAX_PER_BUCKET = 50;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function stripHash(s: string): string {
  const i = s.indexOf("#");
  return i >= 0 ? s.slice(0, i) : s;
}
function noHashKey(s: string): string {
  return s.replace(/^#/, "");
}

/** Classify an itemDescriptions key by its type token (…_album_0, catalog_track_3, …). */
function kindFromKey(key: string): StreamKind | null {
  const k = key.toLowerCase();
  if (k.includes("playlist")) return "playlist";
  if (k.includes("album")) return "album";
  if (k.includes("artist")) return "artist";
  if (k.includes("track") || k.includes("song")) return "track";
  return null; // stations / podcasts: not surfaced (yet)
}

/** Last path segment of a relative/absolute ref, fragment and trailing slash stripped. */
function lastSegment(ref: string): string | null {
  const clean = stripHash(ref).replace(/\/+$/, "");
  const seg = clean.split("/").pop();
  return seg || null;
}

/**
 * Resolve an item's Amazon id (ASIN). Priority per AMParseModel:
 *  1. playables[playable].trackDefinition → trackDefinitions[…].trackTag
 *  2. last path segment of playables[playable].self
 */
function resolveId(
  item: Record<string, unknown>,
  playables: Record<string, unknown>,
  trackDefinitions: Record<string, unknown>,
): string | null {
  const playableKey = str(item.playable);
  if (playableKey) {
    const p = asRecord(playables[noHashKey(playableKey)]);
    const tdKey = str(p.trackDefinition);
    if (tdKey) {
      const tag = str(asRecord(trackDefinitions[noHashKey(tdKey)]).trackTag);
      if (tag) return tag;
    }
    const self = str(p.self);
    if (self) {
      const seg = lastSegment(self);
      if (seg) return seg;
    }
  }
  return null;
}

export async function searchAmazon(device: Device, query: string): Promise<SearchResults> {
  const bearer = await getAmazonBearer(device);
  const res = await amazonApiFetch(`/search/?keywords=${encodeURIComponent(query)}&type=catalog`, { bearer });

  if (res.status === 401) {
    throw new StreamingError("Amazon rejected the device's bearer token", "UNAUTHORIZED");
  }
  if (res.status >= 400) {
    throw new StreamingError(`Amazon search returned HTTP ${res.status}`, "SEARCH_FAILED");
  }

  const results: SearchResults = { tracks: [], albums: [], artists: [], playlists: [], userPlaylists: [] };

  let root: Record<string, unknown>;
  try {
    root = asRecord(JSON.parse(res.text));
  } catch {
    return results; // unconfirmed body shape shouldn't be a hard error
  }

  const itemDescriptions = asRecord(root.itemDescriptions);
  const playables = asRecord(root.playables);
  const trackDefinitions = asRecord(root.trackDefinitions);
  const navNodes = asRecord(root.navigationNodeDescriptions);

  // Preferred display order: the result node's items[]; otherwise every item.
  const resultKey = typeof root.result === "string" ? noHashKey(stripHash(root.result)) : "";
  const orderedItems = asArray(asRecord(navNodes[resultKey]).items).map((k) => noHashKey(String(k)));
  const keys = orderedItems.length > 0 ? orderedItems : Object.keys(itemDescriptions);

  function bucketFor(kind: StreamKind): StreamItem[] {
    if (kind === "track") return results.tracks;
    if (kind === "album") return results.albums;
    if (kind === "artist") return results.artists;
    return results.playlists;
  }

  for (const rawKey of keys) {
    const key = noHashKey(rawKey);
    const item = asRecord(itemDescriptions[key]);
    if (Object.keys(item).length === 0) continue;

    const kind = kindFromKey(key);
    if (!kind) continue;
    const bucket = bucketFor(kind);
    if (bucket.length >= MAX_PER_BUCKET) continue;

    const id = resolveId(item, playables, trackDefinitions);
    if (!id) continue;

    const artist = str(asRecord(item.artist).name);
    const album = str(asRecord(item.album).name);
    const title = str(item.itemLabel) ?? artist ?? album ?? "Unknown";
    const subtitle = kind === "artist" ? null : artist ?? (kind === "track" ? album : null) ?? str(item.subtitle);
    const art = str(asRecord(item.image).uri);

    bucket.push({ id, kind, title, subtitle: subtitle ?? null, art });
  }

  return results;
}
