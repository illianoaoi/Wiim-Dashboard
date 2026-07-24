import { NextResponse } from "next/server";
import { guard, apiError, json } from "@/lib/api";
import { resolveDevice } from "@/lib/device-route";
import { getProvider } from "@/lib/streaming/registry";
import { StreamingError, streamingErrorStatus } from "@/lib/streaming/types";
import { fetchAmazonHome } from "@/lib/streaming/amazon/home";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; provider: string }> };

/**
 * Curated streaming "Home": genre/mood rows of real catalog tiles for the
 * landing view, served from the provider's anonymous web catalog (no account
 * link needed) with a short in-process cache behind `fetchAmazonHome`.
 * Read-only — no CSRF check — but still requires an authed session, and keeps
 * the deviceId in the path for consistency with the other streaming routes
 * (and so the client-side art proxy works the same way).
 *
 * Home is provider-specific to Amazon's anonymous web catalog today, so it
 * calls `fetchAmazonHome` directly instead of going through the provider
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
    return apiError(400, "Home is not supported for this provider", "UNSUPPORTED");
  }

  try {
    const { rows } = await fetchAmazonHome();
    return json({ ok: true, rows });
  } catch (e) {
    if (e instanceof StreamingError) return apiError(streamingErrorStatus(e.code), e.message, e.code);
    const msg = e instanceof Error ? e.message : "Home failed";
    return apiError(502, msg, "STREAMING_HOME");
  }
}
