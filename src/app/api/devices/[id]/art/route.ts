import { NextResponse } from "next/server";
import { guard } from "@/lib/api";
import { resolveDevice } from "@/lib/device-route";
import { fetchMetaInfo } from "@/lib/wiim/commands";
import { wiimFetchRaw } from "@/lib/wiim/client";

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
    const meta = await fetchMetaInfo(r.device.host);
    if (!meta.albumArt) return fallback();

    let url: URL;
    try {
      url = new URL(meta.albumArt);
    } catch {
      url = new URL(meta.albumArt, `https://${r.device.host}`);
    }

    let resStatus: number;
    let resContentType: string;
    let resBody: ArrayBuffer | Uint8Array | number[];

    // If the art is hosted on WiiM's official cloud CDN, bypass the local proxy
    if (url.hostname === "wiimhome.com" || url.hostname.endsWith(".wiimhome.com")) {
      const cloudRes = await fetch(url.toString(), { 
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: AbortSignal.timeout(7000) 
      });
      resStatus = cloudRes.status;
      resContentType = cloudRes.headers.get("content-type") || "";
      resBody = await cloudRes.arrayBuffer();

      // FIX: Correct mislabeled cloud binary streams to proper image formats
      if (resContentType.toLowerCase().includes("octet-stream") || !resContentType) {
        if (url.pathname.endsWith(".png")) resContentType = "image/png";
        else if (url.pathname.endsWith(".webp")) resContentType = "image/webp";
        else resContentType = "image/jpeg"; // Default fallback for WiiM jpg files
      }
    } else {
      // Fall back to original secure LAN proxy for local device-hosted artwork
      const rawRes = await wiimFetchRaw(url.toString(), {
        deviceHost: r.device.host,
        timeoutMs: 7000,
      });
      resStatus = rawRes.status;
      resContentType = rawRes.contentType;
      resBody = rawRes.body;
    }

    if (resStatus >= 400 || !resContentType.startsWith("image/")) return fallback();

    return new Response(new Uint8Array(resBody), {
      headers: { "content-type": resContentType, "cache-control": "private, max-age=60" },
    });
  } catch {
    return fallback();
  }
}