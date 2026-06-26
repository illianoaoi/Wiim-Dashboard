import { NextResponse } from "next/server";
import { guard, json } from "@/lib/api";
import { getLastfm } from "@/lib/db/settings";
import { getStats } from "@/lib/lastfm/client";

export const dynamic = "force-dynamic";

const PERIODS = new Set(["7day", "1month", "3month", "6month", "12month", "overall"]);
const EMPTY = { topArtists: [], topTracks: [], totalScrobbles: null };

/** The connected Last.fm account's top artists/tracks for a period. */
export async function GET(req: Request) {
  const g = await guard(req);
  if (g instanceof NextResponse) return g;

  const lf = getLastfm();
  if (!lf.apiKey || !lf.username) return json(EMPTY);

  const periodParam = new URL(req.url).searchParams.get("period") ?? "1month";
  const period = PERIODS.has(periodParam) ? periodParam : "1month";
  try {
    return json(await getStats(lf.apiKey, lf.username, period));
  } catch {
    return json(EMPTY);
  }
}
