import "server-only";
import { createDecipheriv } from "node:crypto";
import { playQueueSoap } from "./soap";
import { fetchDeviceInfo } from "@/lib/wiim/commands";
import type { Device } from "@/lib/db/devices";
import { StreamingError } from "../types";

/**
 * Amazon Music session, sourced from the device's own PlayQueue "GetUserInfo"
 * SOAP action. The WiiM firmware already holds an Amazon Prime session (set up
 * via the WiiM app's OAuth flow) and hands back the current access/refresh
 * tokens — we never do our own Amazon OAuth. The tokens come back ENCRYPTED
 * (see decryptDeviceToken); once decrypted, `bearer` is the real Amazon
 * `Atza|` access token that music-api.amazon.com accepts.
 */
export interface AmazonUser {
  userId: string;
  showName: string | null;
  email: string | null;
  bearer: string;
  expiresAt: number; // absolute epoch seconds
}

/** GetUserInfo request body, per the captured PlayQueue action. */
const GET_USER_INFO_INNER = "<AccountSource>Prime</AccountSource><RefreshToken></RefreshToken>";

// Same entity set/order as src/lib/dlna/avtransport.ts's decodeEntities, so a
// double-escaped payload (XML-escaped JSON) unwraps the same way everywhere.
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Trim the trailing zero-padding bytes the app leaves after a NoPadding decrypt. */
function stripTrailingNuls(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0) end--;
  return s.slice(0, end);
}

/**
 * Decrypt a token returned by PlayQueue GetUserInfo.
 *
 * The scheme was recovered from the WiiM Android app
 * (com.linkplay.lpmdpkit.utils.j.h + AmazonMusicUserInfo.decrypt): the token is
 * Base64, then AES/CBC/NoPadding with
 *   - key = the first 16 chars of the device's UUID (getStatusEx `uuid`), ASCII
 *   - iv  = 16 zero bytes (app resource "0000000000000000", each digit char
 *           parsed as that byte value → all zeros)
 * Plaintext is zero-padded on encrypt, so the trailing NUL bytes are stripped.
 * The UUID never leaves the LAN and the tokens are held only in memory —
 * nothing here is persisted.
 */
function decryptDeviceToken(encrypted: string, uuid: string): string {
  if (!encrypted) return "";
  const key = uuid.slice(0, 16);
  if (key.length < 16) {
    throw new StreamingError("Device UUID too short to derive the token key", "DECRYPT");
  }
  try {
    const decipher = createDecipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.alloc(16, 0));
    decipher.setAutoPadding(false); // NoPadding: the app zero-pads and strips NULs
    const out = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
    return stripTrailingNuls(out.toString("utf8"));
  } catch (e) {
    throw new StreamingError(
      `Failed to decrypt device token: ${e instanceof Error ? e.message : "error"}`,
      "DECRYPT",
    );
  }
}

/** Per-device cache so we don't round-trip to the device for every request. */
const userCache = new Map<string, AmazonUser>();

// Refresh this many seconds before the token's reported expiry, to avoid
// racing a request against an expiry that lands mid-flight.
const EXPIRY_SKEW_SECONDS = 60;

/**
 * Resolve `expires_in` into an absolute epoch-seconds instant. The device has
 * been seen to pass through an absolute Amazon-issued epoch verbatim, so a
 * value already in the future is treated as absolute; anything else as a
 * relative offset from now.
 */
function resolveExpiresAt(expiresIn: unknown, now: number): number {
  const n = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  if (!Number.isFinite(n) || n <= 0) return now + 60; // unknown/garbage: force a re-fetch soon
  return n > now ? n : now + n;
}

/** The device UUID (getStatusEx `uuid`) whose first 16 chars key the token. */
async function deviceUuid(device: Device): Promise<string> {
  const stored = device.info?.uuid?.trim();
  if (stored && stored.length >= 16) return stored;
  const info = await fetchDeviceInfo(device.host);
  return info.uuid.trim();
}

/**
 * Call the device's PlayQueue GetUserInfo action, decrypt the Amazon session,
 * and return it. Not cached by itself — see getAmazonUser for the cached,
 * near-expiry-aware entry point.
 */
async function fetchAmazonUser(device: Device): Promise<AmazonUser> {
  const raw = await playQueueSoap(device.host, "GetUserInfo", GET_USER_INFO_INNER);

  // <Result> carries a JSON *string*, itself XML-escaped inside the SOAP
  // response — decode the XML layer first, then JSON.parse the inner text.
  const match = /<Result>([\s\S]*?)<\/Result>/i.exec(raw);
  if (!match) {
    throw new StreamingError("GetUserInfo response had no <Result> element", "UNAUTHORIZED");
  }

  let parsed: {
    showName?: unknown;
    userId?: unknown;
    username?: unknown;
    token?: unknown;
    refresh_token?: unknown;
    email?: unknown;
    expires_in?: unknown;
    tokenState?: unknown;
  };
  try {
    parsed = JSON.parse(decodeEntities(match[1]));
  } catch {
    throw new StreamingError("GetUserInfo Result was not valid JSON", "UNAUTHORIZED");
  }

  const encryptedToken = typeof parsed.token === "string" ? parsed.token : "";
  if (!encryptedToken) {
    throw new StreamingError("GetUserInfo Result had no token field", "UNAUTHORIZED");
  }

  const uuid = await deviceUuid(device);
  const bearer = decryptDeviceToken(encryptedToken, uuid);
  if (!bearer) {
    throw new StreamingError("Decrypted an empty Amazon bearer token", "UNAUTHORIZED");
  }

  const userId =
    (typeof parsed.userId === "string" && parsed.userId) ||
    (typeof parsed.username === "string" && parsed.username) ||
    "";
  const now = Math.floor(Date.now() / 1000);

  return {
    userId,
    showName: typeof parsed.showName === "string" ? parsed.showName : null,
    email: typeof parsed.email === "string" ? parsed.email : null,
    bearer,
    expiresAt: resolveExpiresAt(parsed.expires_in, now),
  };
}

/**
 * Get the cached Amazon session for a device, refetching from the device's
 * PlayQueue service when missing or near expiry. Never persisted to disk — the
 * cache is in-process memory only and is lost on restart (by design; these are
 * live device-held credentials, not ours to store).
 */
export async function getAmazonUser(device: Device): Promise<AmazonUser> {
  const cached = userCache.get(device.id);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - EXPIRY_SKEW_SECONDS > now) {
    return cached;
  }
  const user = await fetchAmazonUser(device);
  userCache.set(device.id, user);
  return user;
}

/** Convenience accessor for callers that only need the bearer string. */
export async function getAmazonBearer(device: Device): Promise<string> {
  // Escape hatch: paste a fresh `Atza|` bearer (captured from the WiiM app) to
  // bypass the device decrypt path entirely — handy for isolating a problem to
  // auth vs. the rest of the pipeline. Normally unset; the decrypt path above
  // is the real source.
  const override = process.env.AMAZON_BEARER_OVERRIDE?.trim();
  if (override) return override;
  const user = await getAmazonUser(device);
  return user.bearer;
}
