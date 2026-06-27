# Security

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities. Instead, report privately via GitHub Security Advisories ("Report a vulnerability" on the repo's **Security** tab), or email the maintainer. Include reproduction steps and impact. You'll get an acknowledgement and a fix timeline.

## Threat model

The hardest constraint is the device itself:

- The WiiM/LinkPlay `httpapi.asp` API has **no authentication** — anyone who can reach the device's IP can fully control it, including destructive commands (reboot/shutdown).
- It serves a **self-signed certificate** and some firmware requires a shared mutual-TLS client cert.

Therefore the device must **never** be exposed to untrusted networks. Wiim Dashboard treats the device as trusted-LAN-only and puts all access behind its own authentication.

## Controls

### Device isolation & SSRF protection
- Only the Next.js server talks to the device; the browser never gets the device address.
- Every device host is **DNS-resolved, checked against private/LAN IP ranges, and the connection is pinned to the resolved IP** (`src/lib/wiim/client.ts`) — this blocks DNS-rebinding and prevents the proxy from reaching public/internal non-LAN hosts (e.g. cloud metadata).
- Album/preset artwork is fetched server-side: private targets are restricted to the device's own host; public targets use full TLS verification; size- and content-type-capped.
- Destructive WiiM commands (reboot, shutdown, factory reset) are **not** implemented/proxied.

### Authentication
- Single admin account, password hashed with **Argon2id** (OWASP parameters).
- **Server-side sessions**: a random 32-byte token is issued; only its **HMAC** (keyed by `AUTH_SECRET`) is stored in SQLite — a DB leak alone can't forge sessions.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (in https mode). Sliding expiry.
- Optional **TOTP 2FA** (RFC 6238), enrolled via QR.
- **Rate limiting**: per-IP failure limit **and** a global cap, so spoofing `X-Forwarded-For` to rotate the apparent IP can't grant unlimited attempts. Failed logins are timing-equalised against a dummy hash to avoid user enumeration.

### CSRF
- Double-submit token: a non-`HttpOnly` `wiim_csrf` cookie must match the `x-csrf-token` header on every mutation, compared in constant time.
- Origin/Referer host must match the request host (or `APP_ORIGIN`).
- Combined with `SameSite=Lax` cookies.

### Bot protection
- Optional **Cloudflare Turnstile** on the login form, verified server-side via siteverify.

### Headers (middleware)
- **Nonce-based CSP** with `strict-dynamic` (no `unsafe-inline` for scripts).
- `X-Frame-Options: DENY`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`.
- `Strict-Transport-Security` and `upgrade-insecure-requests` in https mode (disabled when `COOKIE_SECURE=false` for plain-http LAN testing).

## Deployment guidance

- Run behind a TLS-terminating reverse proxy; set `APP_ORIGIN=https://…` and leave `COOKIE_SECURE` unset.
- Because `TRUST_PROXY=true` trusts `X-Forwarded-For`, ensure **only your proxy** can reach the app port (bind to loopback if co-located).
- Use a strong unique `AUTH_SECRET` (`openssl rand -base64 48`); rotating it invalidates all sessions.
- Keep the container and host updated.

## Notes & limitations

- **The app runs as a non-root user** (uid 1001). The container starts as root only briefly — to fix the data directory's ownership so a bind-mounted `/data` (e.g. Unraid appdata) is writable — then drops privileges via `gosu` before running anything.
- **Last.fm credentials are server-only.** The API shared secret and the Last.fm session key are stored in the SQLite settings and **never sent to the client** — the settings API returns only the public API key plus booleans (`hasSecret`, `connected`). All Last.fm write actions (connect, disconnect, device toggles, track love/unlove) go through the same auth-guarded, CSRF-protected routes as the rest of the app.
- The embedded **LinkPlay client certificate** in `src/lib/wiim/linkplay-cert.ts` is a publicly-shared cert used by multiple open-source projects — it is **not** a user secret.
- This is a community project with no warranty (see LICENSE). Review the code before exposing it publicly.
