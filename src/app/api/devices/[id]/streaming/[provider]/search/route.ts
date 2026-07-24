import { NextResponse } from "next/server";
import { guard, apiError, json } from "@/lib/api";
import { resolveDevice } from "@/lib/device-route";
import { getProvider } from "@/lib/streaming/registry";
import { StreamingError, streamingErrorStatus, type StreamSource } from "@/lib/streaming/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; provider: string }> };

/**
 * Search a streaming provider's catalog for tracks/albums/artists/playlists.
 * Read-only — no CSRF check — but still requires an authed session.
 */
export async function GET(req: Request, { params }: Params) {
  const g = await guard(req);
  if (g instanceof NextResponse) return g;
  const { id, provider: providerId } = await params;

  const r = resolveDevice(id);
  if ("res" in r) return r.res;

  const provider = getProvider(providerId);
  if (!provider) return apiError(404, "Unknown provider", "UNKNOWN_PROVIDER");

  const searchParams = new URL(req.url).searchParams;
  const q = searchParams.get("q")?.trim();
  if (!q || q.length < 2) return apiError(400, "Query too short", "BAD_QUERY");

  // Optional search backend selector; absent defaults to "device" (pre-existing behavior).
  const sourceParam = searchParams.get("source");
  if (sourceParam !== null && sourceParam !== "device" && sourceParam !== "web") {
    return apiError(400, "Invalid source", "BAD_SOURCE");
  }
  const source = (sourceParam ?? "device") as StreamSource;

  try {
    const results = await provider.search(r.device, q, { source });
    return json({ ok: true, results });
  } catch (e) {
    if (e instanceof StreamingError) return apiError(streamingErrorStatus(e.code), e.message, e.code);
    const msg = e instanceof Error ? e.message : "Search failed";
    return apiError(502, msg, "STREAMING_SEARCH");
  }
}
