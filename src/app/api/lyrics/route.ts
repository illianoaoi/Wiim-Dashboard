import { NextResponse } from "next/server";
import { guard, json } from "@/lib/api";
import { fetchLyrics } from "@/lib/lyrics/lrclib";

export const dynamic = "force-dynamic";

/** Synced (and plain) lyrics for the current track, looked up via LRCLIB. */
export async function GET(req: Request) {
  const g = await guard(req);
  if (g instanceof NextResponse) return g;

  const { searchParams } = new URL(req.url);
  const artist = (searchParams.get("artist") ?? "").trim();
  const track = (searchParams.get("track") ?? "").trim();
  const album = (searchParams.get("album") ?? "").trim();
  const duration = Number(searchParams.get("duration") ?? "0");
  if (!artist || !track) return json({ synced: null, plain: null });

  const result = await fetchLyrics(artist, track, album, Number.isFinite(duration) ? duration : 0);
  return json(result);
}
