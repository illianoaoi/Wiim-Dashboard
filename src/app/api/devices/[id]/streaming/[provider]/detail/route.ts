import { NextResponse } from "next/server";
import { guard, apiError, json } from "@/lib/api";
import { resolveDevice } from "@/lib/device-route";
import { getProvider } from "@/lib/streaming/registry";
import { StreamingError, streamingErrorStatus, type StreamKind } from "@/lib/streaming/types";
import { fetchAmazonDetail } from "@/lib/streaming/amazon/detail";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; provider: string }> };

const KINDS: readonly StreamKind[] = ["track", "album", "artist", "playlist", "user-playlist"];

/**
 * Detail view for a playable container: `?kind=<StreamKind>&id=<item id>`
 * returns its header fields plus the ordered tracklist (`StreamDetail`).
 * Read-only — no CSRF check — but still requires an authed session.
 *
 * Detail is provider-specific to Amazon today, so it calls `fetchAmazonDetail`
 * directly instead of going through the provider interface; other providers
 * get a 400 UNSUPPORTED. Only album/playlist/user-playlist have tracklists —
 * the fetch rejects track/artist with BAD_KIND (400).
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
    return apiError(400, "Detail is not supported for this provider", "UNSUPPORTED");
  }

  const searchParams = new URL(req.url).searchParams;

  const kindParam = searchParams.get("kind");
  if (!kindParam || !(KINDS as readonly string[]).includes(kindParam)) {
    return apiError(400, "Invalid kind", "BAD_KIND");
  }
  const kind = kindParam as StreamKind;

  const itemId = searchParams.get("id")?.trim();
  if (!itemId || itemId.length > 1024) return apiError(400, "Invalid id", "BAD_ID");

  try {
    const detail = await fetchAmazonDetail(r.device, kind, itemId);
    return json({ ok: true, detail });
  } catch (e) {
    if (e instanceof StreamingError) {
      // BAD_KIND is a caller error (track/artist have no tracklist), not an
      // upstream failure — streamingErrorStatus would map it to 502.
      const status = e.code === "BAD_KIND" ? 400 : streamingErrorStatus(e.code);
      return apiError(status, e.message, e.code);
    }
    const msg = e instanceof Error ? e.message : "Detail failed";
    return apiError(502, msg, "STREAMING_DETAIL");
  }
}
