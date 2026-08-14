import "server-only";
import http from "node:http";
import { resolveTarget, pinnedLookup } from "./client";
import type { PlaybackState } from "./types";

/**
 * UPnP `GetInfoEx` — a LinkPlay/WiiMU vendor extension on the standard
 * AVTransport service that returns the ENTIRE now-playing payload (transport
 * state, timing, volume, loop, source/PlayType, and DIDL-Lite track metadata)
 * in a single call. It's what the WiiM app itself polls, and it reports fuller,
 * more reliable data than the HTTP API for DLNA/cast and OEM sources (Plex,
 * JRiver, iEAST AudioCast, AudioPro…) — see issues #4, #8, #9.
 *
 * This is a SUPPLEMENT, not a replacement: it's fetched over plain HTTP on the
 * UPnP port (49152, fallback 59152) — separate from the httpapi HTTPS-443
 * transport — and callers fall back to httpapi getMetaInfo when it returns
 * null. Every request is still SSRF-pinned to the resolved LAN IP.
 */

const SERVICE_TYPE = "urn:schemas-upnp-org:service:AVTransport:1";
const UPNP_PORTS = [49152, 59152];
const SOAP_BODY =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
  `<s:Body><u:GetInfoEx xmlns:u="${SERVICE_TYPE}"><InstanceID>0</InstanceID></u:GetInfoEx></s:Body></s:Envelope>`;

export interface GetInfoExResult {
  /** CurrentTransportState → our PlaybackState (honest play/pause/stop, unlike the httpapi stuck-stop on push sources). */
  state: PlaybackState | null;
  position: number; // RelTime, seconds
  duration: number; // TrackDuration, seconds
  volume: number | null; // CurrentVolume, 0-100
  /** PlayType — byte-identical to the httpapi getPlayerStatusEx `mode` field. */
  playType: string | null;
  // MetaInfo-compatible fields (see commands.ts MetaInfo):
  albumArt: string | null;
  quality: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitRate: number | null;
  actualQuality: string | null; // service-reported tier (TIDAL HI_RES, Qobuz 7/27, Amazon UHD…)
  title: string | null;
  artist: string | null;
  album: string | null;
}

/** SSRF-safe plain-HTTP request to a device on the LAN (resolve → must be
 *  private → pin the connection to that IP). Returns null on any failure. */
async function lanRequest(
  ip: string,
  opts: { port: number; path: string; method: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs: number },
): Promise<{ status: number; text: string } | null> {
  let target;
  try {
    target = await resolveTarget(ip);
  } catch {
    return null;
  }
  if (!target.isPrivate) return null; // never leave the LAN
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    const reqOpts: http.RequestOptions = {
      host: ip,
      port: opts.port,
      path: opts.path,
      method: opts.method,
      headers: opts.headers,
      signal: controller.signal,
    };
    if (!target.isLiteral) reqOpts.lookup = pinnedLookup(target.ip, target.family);
    const req = http.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 2_000_000) {
          controller.abort();
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

type Control = { port: number; path: string };
const controlCache = new Map<string, { at: number; ctrl: Control }>();
const CONTROL_TTL_MS = 10 * 60_000; // control URLs are stable

/** Find the AVTransport control URL from a device's description.xml (the
 *  control path varies by OEM, so we discover rather than hardcode). The
 *  positive result is cached; failures are handled by fetchGetInfoEx's own
 *  short-lived "unsupported" cache so a non-UPnP device isn't re-probed often. */
async function resolveControl(ip: string): Promise<Control | null> {
  const cached = controlCache.get(ip);
  if (cached && Date.now() - cached.at < CONTROL_TTL_MS) return cached.ctrl;
  for (const port of UPNP_PORTS) {
    const res = await lanRequest(ip, { port, path: "/description.xml", method: "GET", timeoutMs: 2500 });
    if (!res || res.status >= 400 || !res.text) continue;
    const path = extractControlPath(res.text);
    if (path) {
      const ctrl = { port, path };
      controlCache.set(ip, { at: Date.now(), ctrl });
      return ctrl;
    }
  }
  return null;
}

/** Pull the `<controlURL>` of the AVTransport `<service>` block. */
function extractControlPath(xml: string): string | null {
  for (const block of xml.split(/<service>/i)) {
    if (!/<serviceType>[^<]*:service:AVTransport:/i.test(block)) continue;
    const m = block.match(/<controlURL>([^<]*)<\/controlURL>/i);
    const url = m?.[1]?.trim();
    if (url) return url.startsWith("/") ? url : `/${url}`;
  }
  return null;
}

const STATE_MAP: Record<string, PlaybackState> = {
  PLAYING: "playing",
  PAUSED_PLAYBACK: "paused",
  STOPPED: "stopped",
  TRANSITIONING: "loading",
  NO_MEDIA_PRESENT: "stopped",
};

/** PlayMedium → the numeric `mode` (byte-identical to the httpapi `mode`), for
 *  OEM boxes (e.g. Audio Pro C5) whose GetInfoEx omits <PlayType>. Verified on
 *  hardware in @ozbenh's rustywiim (mode_from_play_medium). */
const PLAY_MEDIUM_TO_MODE: Record<string, string> = {
  BLUETOOTH: "41",
  "LINE-IN": "40",
  RCA: "44",
  OPTICAL: "43",
  HDMI: "49",
  PHONO: "54",
  SPOTIFY: "31",
  QOBUZ_CONNECT: "36",
  TIDAL_CONNECT: "32",
  "SONGLIST-NETWORK": "10",
  "STATION-NETWORK": "12", // Station
  "RADIO-NETWORK": "13", // Radio
};
function modeFromPlayMedium(medium: string | null): string | null {
  return medium ? (PLAY_MEDIUM_TO_MODE[medium.trim().toUpperCase()] ?? null) : null;
}

// A device that fails GetInfoEx (no UPnP, or has description.xml but no
// GetInfoEx) is skipped for a while so it isn't re-probed — and the failing
// description.xml + SOAP round-trips don't stall — on every snapshot poll.
const unsupportedUntil = new Map<string, number>();
const UNSUPPORTED_TTL_MS = 60_000;

/** Fetch + parse GetInfoEx for one device. Returns null when the device doesn't
 *  answer UPnP GetInfoEx (caller falls back to the httpapi metadata path). */
export async function fetchGetInfoEx(ip: string): Promise<GetInfoExResult | null> {
  const bad = unsupportedUntil.get(ip);
  if (bad && Date.now() < bad) return null; // recently failed — skip, use httpapi
  const fail = (): null => {
    unsupportedUntil.set(ip, Date.now() + UNSUPPORTED_TTL_MS);
    return null;
  };
  const ctrl = await resolveControl(ip);
  if (!ctrl) return fail();
  const res = await lanRequest(ip, {
    port: ctrl.port,
    path: ctrl.path,
    method: "POST",
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPACTION: `"${SERVICE_TYPE}#GetInfoEx"`,
    },
    body: SOAP_BODY,
    timeoutMs: 6000,
  });
  if (!res || res.status >= 400 || !res.text.includes("GetInfoExResponse")) return fail();
  unsupportedUntil.delete(ip);
  return parseGetInfoEx(res.text);
}

function tag(xml: string, name: string): string | null {
  // Attribute-tolerant on the open tag: DIDL elements routinely carry attrs,
  // e.g. `<upnp:artist role="Performer">` and `<upnp:albumArtURI dlna:profileID=…>`.
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : null;
}

/** Unescape XML entities. `&amp;` LAST so a literal `&amp;lt;` isn't decoded to `<`. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&");
}

function hmsToSec(v: string | null): number {
  const m = v?.trim().match(/^(\d+):(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

function numOrNull(v: string | null): number | null {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanText(v: string | null): string | null {
  const t = v == null ? "" : unescapeXml(v).trim();
  return t || null;
}

export function parseGetInfoEx(xml: string): GetInfoExResult {
  const rawState = tag(xml, "CurrentTransportState")?.trim() ?? "";
  const state = STATE_MAP[rawState] ?? null;
  const volume = numOrNull(tag(xml, "CurrentVolume"));
  // PlayType is byte-identical to the httpapi `mode`. Some OEM boxes never send
  // <PlayType> — derive it from <PlayMedium> in that case.
  const rawPlayType = tag(xml, "PlayType")?.trim() ?? "";
  const playType =
    rawPlayType && rawPlayType !== "-1" ? rawPlayType : modeFromPlayMedium(tag(xml, "PlayMedium"));

  // TrackMetaData is DIDL-Lite escaped once inside the SOAP body → unescape to
  // recover real DIDL tags (leaf text is then unescaped a SECOND time below).
  const didl = unescapeXml(tag(xml, "TrackMetaData") ?? "");

  const sampleRate = numOrNull(tag(didl, "song:rate_hz"));
  const bitDepthRaw = numOrNull(tag(didl, "song:format_s"));
  const bitDepth = bitDepthRaw === 32 ? 24 : bitDepthRaw; // WiiM packs 24-bit in 32-bit words
  const brRaw = numOrNull(tag(didl, "song:bitrate"));
  const bitRate = brRaw == null ? null : brRaw >= 100000 ? Math.round(brRaw / 1000) : Math.round(brRaw);
  const actualQuality = cleanText(tag(didl, "song:actualQuality"));

  const artRaw = cleanText(tag(didl, "upnp:albumArtURI"));
  const artLower = artRaw?.toLowerCase() ?? "";
  const albumArt = artRaw && !["un_known", "unknown", "unknow"].includes(artLower) ? artRaw : null;

  const parts: string[] = [];
  if (bitRate != null) parts.push(`${bitRate} kbps`);
  if (bitDepth != null) parts.push(`${bitDepth}-bit`);
  if (sampleRate != null) parts.push(`${(sampleRate / 1000).toFixed(1).replace(/\.0$/, "")} kHz`);

  return {
    state,
    position: hmsToSec(tag(xml, "RelTime")),
    duration: hmsToSec(tag(xml, "TrackDuration")),
    volume,
    playType,
    albumArt,
    quality: parts.join(" · ") || null,
    sampleRate,
    bitDepth,
    bitRate,
    actualQuality,
    title: cleanText(tag(didl, "dc:title")),
    artist: cleanText(tag(didl, "upnp:artist")),
    album: cleanText(tag(didl, "upnp:album")),
  };
}
