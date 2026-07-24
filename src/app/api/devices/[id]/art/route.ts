import { NextResponse } from "next/server";
import { guard } from "@/lib/api";
import { resolveDevice } from "@/lib/device-route";
import { fetchTrackMeta } from "@/lib/wiim/commands";
import { wiimFetchRaw } from "@/lib/wiim/client";
import { lookupAlbumArt } from "@/lib/artwork/itunes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 1x1 transparent PNG fallback.
const TRANSPARENT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function fallback(): Response {
  return new Response(TRANSPARENT, {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=30" },
  });
}

/** Proxy the current track's album art (device art is often http / mixed-content). */
export async function GET(req: Request, { params }: Params) {
  const g = await guard(req);
  if (g instanceof NextResponse) return g;
  const r = resolveDevice((await params).id);
  if ("res" in r) return r.res;

  try {
    const meta = await fetchTrackMeta(r.device.host);
    // Use the device's own art if present; otherwise fall back to an external
    // lookup by artist + album — local/NAS files often expose no embedded cover.
    let artSrc = meta.albumArt;
    if (!artSrc && meta.artist && meta.album) {
      artSrc = await lookupAlbumArt(meta.artist, meta.album);
    }
    if (!artSrc) return fallback();

    let url: URL;
    try {
      url = new URL(artSrc);
    } catch {
      url = new URL(artSrc, `https://${r.device.host}`);
    }

    // SSRF-guarded: private targets must be the device itself; public targets
    // are fetched with normal TLS verification; connection pinned to checked IP.
    const res = await wiimFetchRaw(url.toString(), {
      deviceHost: r.device.host,
      timeoutMs: 7000,
    });
    if (res.status >= 400 || !res.contentType.startsWith("image/")) return fallback();

    return new Response(new Uint8Array(res.body), {
      headers: { "content-type": res.contentType, "cache-control": "private, max-age=60" },
    });
  } catch {
    return fallback();
  }
}
