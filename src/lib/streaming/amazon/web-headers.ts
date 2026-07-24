import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Request-header blob for Amazon Music's public web-player skill endpoints
 * (na.web.skill.music.a2z.com and na.mesk.skill.music.a2z.com). These
 * endpoints take a single `headers` field carrying a JSON string of
 * `x-amzn-*` values; there is no real session behind it.
 *
 * The device-id / session-id / CSRF token below were captured from a real
 * web-player session and are replayed verbatim — the endpoints accept them
 * stale (they validate the CSRF blob's *shape*, not its freshness), so no
 * device bearer or live token is needed. `x-amzn-request-id` is fresh per
 * call and `x-amzn-timestamp` is current; everything else is fixed.
 *
 * `x-amzn-device-height` / `x-amzn-device-width` are required: omitting them
 * makes the backend 500 with a NumberFormatException (it parses them as ints
 * with no default).
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";

export const WEB_USER_AGENT = UA;

/** Build the `x-amzn-*` JSON header blob the skill endpoints expect. */
export function webHeadersBlob(): string {
  return JSON.stringify({
    "x-amzn-authentication": JSON.stringify({
      interface: "ClientAuthenticationInterface.v1_0.ClientTokenElement",
      accessToken: "",
    }),
    "x-amzn-device-model": "WEBPLAYER",
    "x-amzn-device-width": "1920",
    "x-amzn-device-family": "WebPlayer",
    "x-amzn-device-id": "13354004643864056",
    "x-amzn-user-agent": UA,
    "x-amzn-session-id": "133-5400464-3864056",
    "x-amzn-device-height": "1080",
    "x-amzn-request-id": randomUUID(),
    "x-amzn-device-language": "en_US",
    "x-amzn-currency-of-preference": "USD",
    "x-amzn-os-version": "1.0",
    "x-amzn-application-version": "1.0.10905.0",
    "x-amzn-device-time-zone": "America/Bogota",
    "x-amzn-timestamp": String(Date.now()),
    // Static/stale but well-formed — the endpoint checks shape, not freshness.
    "x-amzn-csrf": JSON.stringify({
      interface: "CSRFInterface.v1_0.CSRFHeaderElement",
      token: "AdDxZm+3n1icPMX8d+lmxNXZkTaqtsaqHoIlBp7bztI=",
      timestamp: "1784853709",
      rndNonce: "1535322300",
    }),
    "x-amzn-music-domain": "music.amazon.com",
    "x-amzn-referer": "music.amazon.com",
    "x-amzn-page-url": "https://music.amazon.com/search",
    "x-amzn-feature-flags": "hd-supported",
  });
}
