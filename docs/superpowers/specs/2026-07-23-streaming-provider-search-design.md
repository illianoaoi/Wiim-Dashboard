# Streaming provider search — design

**Date:** 2026-07-23
**Status:** Draft for review
**Author:** Juan Moreno (with Claude)

## Goal

Let a user search a streaming service catalogue (songs / albums / artists / playlists)
from the dashboard and play the result on their WiiM device — a near-native
in-app experience, starting with **Amazon Music**, behind a provider-agnostic
abstraction so other services can follow.

## Context and honesty

This integrates a **private, undocumented Amazon backend** (`music-api.amazon.com`),
the same one the official WiiM Home app uses. It is legitimate for personal
interoperability — the user's own device, own account, own credentials, which
live on their own WiiM on the LAN — but it is **fragile** (Amazon can change it
without notice) and lives outside any API contract. The design isolates every
Amazon-specific and unofficial-API detail behind one interface so the fragility
is contained and the rest of the app is unaffected.

The official Amazon Music Web API (`api.music.amazon.dev`) is a closed beta
(requires Amazon developer approval + `x-api-key`) and returns metadata only
(no playable stream URLs). It is **not** a viable path for "search and play
today", so it is recorded as a future fallback, not the primary route.

## What was reverse-engineered (evidence)

Captured via Proxyman against the official WiiM Home iOS app (user's own device),
and cross-checked against the open-source Swift client
`dankinsoid/SwiftMusicServicesAPI` (`Sources/AmazonMusicAPI`):

1. **Token source — the device holds the Amazon session.**
   UPnP SOAP to the device's PlayQueue service:
   ```
   POST http://<device-ip>:59152/upnp/control/PlayQueue1
   SOAPACTION: "urn:schemas-wiimu-com:service:PlayQueue:1#GetUserInfo"
   body: <u:GetUserInfo><AccountSource>Prime</AccountSource><RefreshToken></RefreshToken></u:GetUserInfo>
   ```
   Response `<Result>` is JSON: `{ showName, userId, username, token, refresh_token,
   email, expires_in, tokenState }`. `AccountSource=Prime` == Amazon Music.
   The linked accounts are listed via the sibling action `GetBasicUserInfo`
   (returns `streamServices[]`: Prime, Tidal, Qobuz, Deezer2, YouTubeMusic, …).

2. **Catalogue search — direct to Amazon's private backend.**
   ```
   GET https://music-api.amazon.com/search/?keywords=<q>&type=catalog
   Authorization: Bearer Atza|...        (LWA access token, no x-api-key, no cookies)
   Accept: application/json
   ```
   `type=catalog` searches the full catalogue; `type=library_*` searches the
   user's library. Confirmed by the Swift client: `Amazon.Music.DeviceAPI`
   base URL is `https://music-api.amazon.com/` with plain `.bearer(token)` auth.

3. **Playback — hand the device a fully-resolved queue.**
   ```
   POST http://<device-ip>:59152/upnp/control/PlayQueue1
   SOAPACTION: "urn:schemas-wiimu-com:service:PlayQueue:1#CreateQueue"
   body: <u:CreateQueue><QueueContext>…escaped XML PlayList…</QueueContext><QueuePolicy>0</QueuePolicy></u:CreateQueue>
   ```
   The `QueueContext` is an escaped `<PlayList>` document: `ListInfo`
   (`SourceName=Prime`, `StartPlayIndex`, `SearchUrl`, paging) + `Tracks`, each
   `Track` carrying `Id` (Amazon ASIN), `Source=Prime`, a **signed CloudFront
   `.m3u8` stream URL** (expires ~1h), a per-track `RefreshUrl`/`PlayEventUrl`
   back to `music-api.amazon.com`, and DIDL-Lite metadata (title/artist/album/art).
   The app resolves those stream URLs from Amazon before building the queue; the
   device just plays them (and can refresh a track via `RefreshUrl` using its own
   session).

4. **Auth mechanics (from the Swift client, for the spec — not for us to run).**
   LWA OAuth at `api.amazon.com/auth/o2`: `authorization_code`/PKCE, `refresh_token`
   (`grant_type=refresh_token` + `client_id` + `client_secret`), and a device-code
   flow. Being our own Amazon client would need a registered `client_id` with
   `music::*` scopes (closed beta). **We avoid this entirely by delegating token
   issuance/refresh to the WiiM** (option 1 above).

## Architecture

Provider-agnostic, mirroring the existing server-only `src/lib/dlna/` module and
the app's proxy model (browser never talks to the device or to Amazon directly;
everything goes through SSRF-guarded, `guard()`-ed Route Handlers).

### The provider abstraction

```
src/lib/streaming/
  types.ts        // shared shapes + StreamingProvider interface
  registry.ts     // provider lookup by id; which providers a device has linked
  index.ts        // re-exports (server-only)
  amazon/
    provider.ts   // AmazonProvider implements StreamingProvider
    token.ts      // fetch/cache the Amazon bearer via device GetUserInfo
    search.ts     // GET music-api.amazon.com/search -> typed results
    resolve.ts    // result -> resolved tracks with signed stream URLs
    queue.ts      // build QueueContext XML
    parse.ts      // tolerant JSON/DIDL parsing (mirrors wiim/parse.ts)
```

`StreamingProvider` (first cut):
```ts
interface StreamingProvider {
  id: "amazon";                      // future: "tidal" | "qobuz" | ...
  accountSource: "Prime";            // WiiM PlayQueue SourceName
  search(dev: Device, q: string, opts): Promise<SearchResults>;
  play(dev: Device, sel: PlaySelection): Promise<void>;
}
```

`SearchResults` is provider-neutral: `{ tracks[], albums[], artists[], playlists[] }`,
each item `{ id, title, subtitle, art, kind }`. The UI only ever sees these
neutral shapes.

### Playback path

Playback reuses the existing UPnP SOAP transport pattern. Two sub-approaches,
decided by the Phase 0 spike:

- **A (device-resolves, preferred):** if the PlayQueue service exposes an online
  search/play action that takes a `SearchUrl`/ASIN and lets the *device* resolve
  streams with its own session, the dashboard needs **no Amazon token for play**
  and possibly none for search. Lightest and most robust. (Suggested by the
  `SearchUrl`/`RefreshUrl` fields, but the exact action was not captured.)
- **B (dashboard-resolves, confirmed-capturable):** dashboard resolves stream
  URLs via `music-api.amazon.com`, builds the full `QueueContext`, and sends
  `CreateQueue`. Requires a usable bearer. This is the fallback and the known-good
  path from the capture.

### Token handling

- Source the Amazon bearer from the **device** (`GetUserInfo`, `AccountSource=Prime`),
  cache in-process keyed by device id with TTL from `expires_in`, refresh by
  re-calling the device (the WiiM refreshes upstream with its own client creds).
- **Never persist Amazon credentials to SQLite or git.** In-process cache only.
- If the device blob is not directly usable (see Risk 1), fall back to a
  transform (base64-decode) or, last resort, a manual "paste bearer" setting
  (short-lived; documented as degraded mode).

### Routes (Node runtime)

- `GET  /api/devices/[id]/streaming/[provider]/search?q=` — `guard(req)`, resolve
  device, call `provider.search()`. Returns neutral `SearchResults`.
- `POST /api/devices/[id]/streaming/[provider]/play` — `guard(req,{mutation:true})`,
  `parseBody` (Zod: item id + kind), call `provider.play()`.
- `GET  /api/devices/[id]/streaming/art?u=` — proxy album art so the browser never
  hits Amazon/CloudFront directly (mirrors `/api/nas/art`).

**SSRF note (important):** `music-api.amazon.com` is a *public* host. The existing
`wiim` transport and `dlna` transport both enforce **LAN-only**, so neither can
be reused for the Amazon call. Add a **narrow allowlisted fetch** that permits
exactly `music-api.amazon.com` (and the art host) and nothing else — no
user-controlled host ever reaches it. The device SOAP calls still go through the
LAN-pinned transport. The browser still never talks to Amazon; the server proxies.

### UI — a dedicated "Search" tab

- New entry point in the dashboard nav (a tab/section, gated on the device having
  a linked provider per `GetBasicUserInfo`). Hidden when nothing is linked.
- A full search surface (not a small dialog): a search input, result sections
  for Tracks / Albums / Artists / Playlists with artwork, tap-to-play, and
  play/queue actions — reusing `ui/` primitives, `Card`, dark, mobile-first.
  The existing `browse-dialog.tsx` (NAS) is the visual reference for rows,
  artwork tiles, and play affordances.
- Client fetch via SWR + `apiGet`/`apiSend` with the CSRF wrapper; mutations
  call `mutate()` on the snapshot to refresh now-playing.

## Data flow (option B, end to end)

```
UI search box
  -> GET /api/devices/:id/streaming/amazon/search?q=radiohead   (guard read)
       -> AmazonProvider.search()
            -> token.ts: GetUserInfo(device) -> bearer (cached)
            -> search.ts: GET music-api.amazon.com/search?keywords=&type=catalog
            -> parse -> neutral SearchResults
  <- tracks/albums/artists/playlists (art proxied)

UI tap "play"
  -> POST /api/devices/:id/streaming/amazon/play {id, kind}     (guard mutation)
       -> AmazonProvider.play()
            -> resolve.ts: music-api -> signed stream URLs + DIDL
            -> queue.ts: build QueueContext XML
            -> UPnP CreateQueue -> device plays
  <- 200; UI mutate() snapshot -> now-playing shows the track natively
```

## Error handling

- Map provider errors to HTTP like `runDevice()`/`dlnaErrorStatus()` do:
  not-configured/forbidden-host -> 400, upstream timeout -> 504, else 502.
- Amazon 401 (expired/invalid bearer) -> refresh from device once, then surface
  "reconnect Amazon in the WiiM app" if still failing.
- Signed stream URL expiry mid-play is handled by the device via `RefreshUrl`;
  the dashboard does not need to re-sign.
- Every failure is explicit (no silent fallback to a wrong result).

## Testing / gate

No test suite exists; the gate is `npm run typecheck && npm run build`. Feature
verification requires a real WiiM with Amazon Music linked on the LAN. Phase 0
is a throwaway spike script (not shipped) to de-risk the token before building.

## Risks

1. **Token usability (blocking, validate first).** `GetUserInfo` returns
   `token`/`refresh_token` as base64 blobs, not the `Atza|` form `music-api`
   expects. If LinkPlay encrypts them, the dashboard cannot mint a usable bearer
   and option B search/resolve is blocked → we must pivot to option A
   (device-resolved) or degraded manual-bearer mode. **Phase 0 spike resolves
   this before any build.**
2. **Unofficial API drift.** `music-api.amazon.com` shapes and the PlayQueue
   SOAP contract can change without notice. Contained behind the provider module;
   document captured contracts in `docs/`.
3. **ToS / account risk.** Using a private backend is outside Amazon's terms;
   personal use only. If the device refreshes/rotates its token, concurrent use
   by the dashboard could disturb the app's session — prefer read-only token
   fetch, never write account state.
4. **Scope creep.** Ship Amazon + one clean provider interface only. Do not build
   other providers until Amazon works end to end.

## Out of scope (v1)

- Providers other than Amazon (interface only).
- Official Amazon Web API integration.
- Editing playlists / library writes / favourites.
- Multi-track queue management UI beyond play-now / play-all.

## Open questions for review

1. Primary playback path: commit to **B (dashboard-resolves, known-good)** for v1
   and treat A as an optimisation, or spend the Phase 0 spike also probing for an
   online-search/play PlayQueue action (A) that could remove the token dependency
   for play?
2. UI placement: a **top-level "Search" tab** vs. an expanded entry alongside the
   existing Library card. (Spec assumes a dedicated tab.)
3. Degraded mode: if Phase 0 shows the device token is unusable, is a manual
   "paste bearer" mode worth shipping, or do we hard-depend on option A?

## Addendum (2026-07-23): anonymous web-player search source

### 1. Decision

In practice, the device-bearer search against `music-api.amazon.com/search`
(`type=catalog`) returns results skewed heavily toward Amazon-curated
playlists — too thin to be the only search experience. A second search source
is added: the Amazon Music **web player's own** endpoint,
`POST https://na.web.skill.music.a2z.com/api/showSearch`. The two sources are
kept side by side, not swapped — the existing search route grows a
`source=device|web` query param (default `device`), and the search UI grows a
two-tab toggle ("Catalog" = web, "Device") so result quality can be compared
live rather than committed to blind.

Playback is untouched by this addendum. Both sources resolve to the same
provider-neutral `SearchResults` shape carrying Amazon ASINs, which feed the
existing play pipeline unchanged: `/catalog/<kind>s/<ASIN>/` resolve +
PlayQueue `CreateQueue`.

### 2. Evidence (probed live 2026-07-23)

The endpoint works fully anonymously — no device, no account, no LWA bearer:

- `accessToken` sent empty and the call still succeeds.
- A **stale, previously-captured CSRF blob is accepted**: token/timestamp/nonce
  copied from an old browser session, replayed cold, HTTP 200. The endpoint is
  not validating session freshness against these values in any way that
  blocks a replay.
- Omitting `x-amzn-device-height` / `x-amzn-device-width` causes a server-side
  500 with `NumberFormatException` — the backend parses these headers as
  numbers with no default, so they are required (any plausible values work;
  they don't appear to affect result content).

The response is a widget-based template document, not a flat results list:
`methods[0].template.widgets[]`, bucketed by type — Top Results, Artists,
Albums, Songs, Playlists, Community Playlists, Stations, Podcasts,
Audiobooks. Each item carries a `primaryLink.deeplink` encoding both kind and
ASIN:

```
/artists/<ASIN>/…
/albums/<ASIN>
/albums/<albumASIN>?trackAsin=<trackASIN>      (tracks — nested under the album)
/playlists/<ASIN>
```

Art is a plain `m.media-amazon.com` / `ssl-images-amazon.com` URL — already
covered by the existing art-proxy allowlist, no new host needed there.

### 3. Implementation shape

New server-only module, parallel to the existing `amazon/` layout rather than
replacing anything in it:

- `src/lib/streaming/amazon/web-http.ts` — a narrow allowlisted fetch, same
  pattern as the `music-api.amazon.com` SSRF allowlist but scoped to exactly
  one host, `na.web.skill.music.a2z.com`. Hard-coded NA region for v1 (see
  Risks).
- `src/lib/streaming/amazon/web-search.ts` — `webSearchAmazon(query)`. No
  `Device` parameter, no bearer token; the request is anonymous end to end.

Classification of items is by **deeplink path prefix**, not by the widget's
(localized, display-only) header text — the header text is presentation
copy and not a stable contract. Buckets with no `/playlists/`-style deeplink
the play pipeline can consume (stations, podcasts, audiobooks, community
playlists) are skipped outright, since only track/album/artist/playlist are
playable today. Results are deduped by `(kind, id)` across widgets — the same
item can legitimately appear in more than one bucket (e.g. Top Results +
Songs) — and capped at 50 per bucket.

`StreamingProvider.search` gains an optional `opts.source`, typed
`StreamSource = "device" | "web"`, so the two paths sit behind the same
interface method rather than forking into parallel call sites.

### 4. Risks added

- Same unofficial-API drift risk class as `music-api.amazon.com` (Risk 2
  above) — undocumented, can change without notice, contained behind its own
  module.
- The accepted-stale-CSRF behavior is itself unofficial and unexplained; if
  Amazon starts validating that blob, this source degrades to
  `SEARCH_FAILED` while the device tab keeps working — the failure is
  isolated to one tab, not the whole search feature.
- Region is hard-coded to the NA host for v1; no non-NA path exists yet.
