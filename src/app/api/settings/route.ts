import { NextResponse } from "next/server";
import { z } from "zod";
import { guard, json } from "@/lib/api";
import { parseBody } from "@/lib/validate";
import {
  getSetting,
  setSetting,
  getLastfm,
  getArtHosts,
  setArtHosts,
  SettingKeys,
  DEFAULT_CARDS,
  MAX_ART_HOSTS,
  type TurnstileSettings,
  type AppSettings,
  type CardVisibility,
} from "@/lib/db/settings";
import { apiError } from "@/lib/api";
import { normaliseArtHost, resolveTarget, isSensitiveIp } from "@/lib/wiim/client";

export const dynamic = "force-dynamic";

const DEFAULT_APP: AppSettings = { pollIntervalMs: 3000 };

const PatchSchema = z.object({
  turnstile: z
    .object({
      enabled: z.boolean(),
      siteKey: z.string().trim().max(256),
      // omit/empty secretKey = keep existing
      secretKey: z.string().trim().max(256).optional(),
    })
    .optional(),
  app: z
    .object({
      pollIntervalMs: z.number().int().min(1000).max(60000),
    })
    .optional(),
  cards: z
    .object({
      nowPlaying: z.boolean(),
      presets: z.boolean(),
      eq: z.boolean(),
      source: z.boolean(),
      output: z.boolean(),
      sub: z.boolean(),
      temperature: z.boolean(),
      device: z.boolean(),
    })
    .partial()
    .optional(),
  // Trusted artwork hosts, as typed by the operator; normalised + resolved
  // below (zod can't do the DNS check, and it must run before we store them).
  artHosts: z.array(z.string().trim().max(120)).max(MAX_ART_HOSTS).optional(),
});

/**
 * Accept a trusted-artwork-host entry only if it names a real private address
 * that isn't somewhere sensitive. This is the gate that keeps the allowlist
 * from becoming a hole: `isPrivateIp` alone would happily accept
 * 169.254.169.254 (cloud metadata) or 127.0.0.1 (this container).
 */
async function validateArtHosts(input: string[]): Promise<{ hosts: string[] } | { error: string }> {
  const hosts: string[] = [];
  for (const raw of input) {
    if (!raw.trim()) continue;
    const key = normaliseArtHost(raw);
    if (!key) return { error: `Not a valid host:port — "${raw}" (e.g. 192.168.1.5:52199)` };
    const host = key.slice(0, key.lastIndexOf(":")).replace(/^\[|\]$/g, "");
    let target;
    try {
      target = await resolveTarget(host);
    } catch {
      return { error: `Can't resolve "${host}"` };
    }
    if (!target.isPrivate) {
      return { error: `"${host}" is not a private/LAN address — only LAN media servers can be trusted here` };
    }
    if (isSensitiveIp(target.ip)) {
      return { error: `"${host}" resolves to ${target.ip}, which is not allowed (loopback / link-local / metadata)` };
    }
    if (!hosts.includes(key)) hosts.push(key);
  }
  return { hosts };
}

/** Return settings with the Turnstile secret redacted. */
export async function GET(req: Request) {
  const g = await guard(req);
  if (g instanceof NextResponse) return g;

  const turnstile = getSetting<TurnstileSettings | null>(SettingKeys.turnstile, null);
  const app = getSetting<AppSettings>(SettingKeys.app, DEFAULT_APP);
  const cards = { ...DEFAULT_CARDS, ...getSetting<Partial<CardVisibility>>(SettingKeys.cards, {}) };
  const lf = getLastfm();
  return json({
    artHosts: getArtHosts(),
    turnstile: {
      enabled: turnstile?.enabled ?? false,
      siteKey: turnstile?.siteKey ?? "",
      hasSecret: !!turnstile?.secretKey,
    },
    app,
    cards,
    lastfm: {
      apiKey: lf.apiKey, // not secret — appears in the authorize URL anyway
      hasSecret: !!lf.apiSecret,
      connected: !!lf.sessionKey,
      username: lf.username,
      scrobbleDevices: lf.scrobbleDevices,
    },
  });
}

export async function PATCH(req: Request) {
  const g = await guard(req, { mutation: true });
  if (g instanceof NextResponse) return g;

  const parsed = await parseBody(req, PatchSchema);
  if (!parsed.ok) return parsed.res;

  if (parsed.data.turnstile) {
    const existing = getSetting<TurnstileSettings | null>(SettingKeys.turnstile, null);
    const t = parsed.data.turnstile;
    const next: TurnstileSettings = {
      enabled: t.enabled,
      siteKey: t.siteKey,
      // keep existing secret when not provided
      secretKey: t.secretKey && t.secretKey.length > 0 ? t.secretKey : existing?.secretKey ?? "",
    };
    setSetting(SettingKeys.turnstile, next);
  }

  if (parsed.data.app) {
    setSetting(SettingKeys.app, parsed.data.app);
  }

  if (parsed.data.artHosts) {
    const checked = await validateArtHosts(parsed.data.artHosts);
    if ("error" in checked) return apiError(400, checked.error, "BAD_ART_HOST");
    setArtHosts(checked.hosts);
  }

  if (parsed.data.cards) {
    const current = { ...DEFAULT_CARDS, ...getSetting<Partial<CardVisibility>>(SettingKeys.cards, {}) };
    setSetting(SettingKeys.cards, { ...current, ...parsed.data.cards });
  }

  return json({ ok: true });
}
