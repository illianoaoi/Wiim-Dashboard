import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, apiError, json } from "@/lib/api";
import { parseBody } from "@/lib/validate";
import { resolveDevice } from "@/lib/device-route";
import { getProvider } from "@/lib/streaming/registry";
import { StreamingError, streamingErrorStatus } from "@/lib/streaming/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; provider: string }> };

const Schema = z.object({
  id: z.string().trim().min(1).max(1024),
  kind: z.enum(["track", "album", "artist", "playlist", "user-playlist"]),
  /** 1-based position within a container to start playback at (omitted = top). */
  startIndex: z.number().int().min(1).max(1000).optional(),
});

/** Play a streaming-service item (track/album/artist/playlist/user-playlist) on a device. */
export async function POST(req: Request, { params }: Params) {
  const g = await guard(req, { mutation: true });
  if (g instanceof NextResponse) return g;
  const r = resolveDevice((await params).id);
  if ("res" in r) return r.res;

  const provider = getProvider((await params).provider);
  if (!provider) return apiError(404, "Unknown provider", "UNKNOWN_PROVIDER");

  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.res;

  try {
    await provider.play(r.device, parsed.data);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof StreamingError) return apiError(streamingErrorStatus(e.code), e.message, e.code);
    const msg = e instanceof Error ? e.message : "Playback failed";
    return apiError(502, msg, "PLAYBACK");
  }
}
