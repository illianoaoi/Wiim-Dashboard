import { NextResponse } from "next/server";
import { guard, apiError, json } from "@/lib/api";
import { resolveDevice } from "@/lib/device-route";
import { getProvider } from "@/lib/streaming/registry";
import { StreamingError, streamingErrorStatus } from "@/lib/streaming/types";
import { browseCategory, type BrowseCategory } from "@/lib/streaming/amazon/web-browse";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; provider: string }> };

const CATEGORIES: readonly BrowseCategory[] = [
  "tracks",
  "albums",
  "artists",
  "playlists",
  "userPlaylists",
];

/**
 * Paginated per-category catalog listing behind the search view's "See all":
 * `?q=<query>&category=<BrowseCategory>[&next=<token>]` returns one page of
 * items plus the continuation token for the next one (null on the last page).
 * Read-only — no CSRF check — but still requires an authed session.
 *
 * Browse is provider-specific to Amazon's anonymous web catalog today, so it
 * calls `browseCategory` directly instead of going through the provider
 * interface; other providers get a 400 UNSUPPORTED.
 */
export async function GET(req: Request, { params }: Params) {
  const g = await guard(req);
  if (g instanceof NextResponse) return g;
  const { id, provider: providerId } = await params;

  const r = resolveDevice(id);
  if ("res" in r) return r.res;

  const provider = getProvider(providerId);
  if (!provider) return apiError(404, "Unknown provider", "UNKNOWN_PROVIDER");
  if (providerId !== "amazon") {
    return apiError(400, "Browse is not supported for this provider", "UNSUPPORTED");
  }

  const searchParams = new URL(req.url).searchParams;
  const q = searchParams.get("q")?.trim();
  if (!q || q.length < 2) return apiError(400, "Query too short", "BAD_QUERY");

  const categoryParam = searchParams.get("category");
  if (!categoryParam || !(CATEGORIES as readonly string[]).includes(categoryParam)) {
    return apiError(400, "Invalid category", "BAD_CATEGORY");
  }
  const category = categoryParam as BrowseCategory;

  // Opaque continuation token from the previous page; over-long values are
  // ignored (treated as a first-page request) rather than rejected.
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.length <= 512 ? nextParam : undefined;

  try {
    const page = await browseCategory(q, category, next);
    return json({ ok: true, items: page.items, nextToken: page.nextToken });
  } catch (e) {
    if (e instanceof StreamingError) return apiError(streamingErrorStatus(e.code), e.message, e.code);
    const msg = e instanceof Error ? e.message : "Browse failed";
    return apiError(502, msg, "STREAMING_BROWSE");
  }
}
