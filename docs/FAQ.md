# FAQ

Common questions about Wiim Dashboard. New to it? Start with the [Easy install guide](EASY-INSTALL.md).

## What is it — and is it official?
A free, open-source (MIT) **community** project — not an official WiiM/LinkPlay product, and not affiliated with them. It's a self-hosted web dashboard built by an independent developer for fellow WiiM owners. It exists because WiiM ships an open local API on its devices, which lets the community build on top.

## Does it run on the WiiM device itself? Will firmware updates break it?
**No.** It runs on *your own* computer / server / NAS / Raspberry Pi (in Docker) and talks to the WiiM over your network. It **never installs anything on, or modifies, the WiiM** — the device stays 100% stock. WiiM firmware/factory updates don't affect it. (Worst case a firmware change tweaks how the device answers a command, which gets patched in the app — nothing on the device changes.)

## Does it work on Android / iOS / iPad?
**Yes** — it's a web app, so you open it in any browser on any device (it's mobile-first/responsive). "Add to Home Screen" for an app-like shortcut. You don't install it *on* the phone; the app runs on your computer and the phone connects to it over your network.

## Do I need Docker? A reverse proxy?
**Docker: yes** — but it's one command (see the [Easy install guide](EASY-INSTALL.md)). **Reverse proxy: no** — that's optional, only if you want to reach it from *outside* your home over HTTPS. On your home network you just open it by IP.

## My browser says `SSL_ERROR_RX_RECORD_TOO_LONG` / refuses to connect (often on Linux)
That error means the **browser** tried HTTPS against the dashboard, which serves plain **HTTP** — there is no certificate involved on our side, so nothing to install or trust. Two usual causes:

1. **The browser silently upgraded the address.** Firefox's *HTTPS-Only Mode* and Chromium's *Always use secure connections* rewrite `http://…` to `https://…`, and recent Linux builds ship them on by default (which is why the same URL works from Windows or a phone). Either open the page and choose *Continue to HTTP Site*, or add an exception: Firefox → Settings → Privacy & Security → **HTTPS-Only Mode** → *Don't enable* (or "Manage exceptions"); Chromium → Settings → Privacy and security → Security → turn off **Always use secure connections**.
2. **You typed `https://` yourself.** Use `http://<server-ip>:<port>` — e.g. `http://192.168.1.50:39446`.

Want real HTTPS? Put a reverse proxy (Zoraxy / Caddy / Nginx Proxy Manager / Traefik) in front of it — that's the supported way, see [Public access / reverse proxy](../README.md#public-access--reverse-proxy). Also make sure `COOKIE_SECURE` isn't claiming something untrue: as of 0.3.17 the dashboard decides the HSTS / `upgrade-insecure-requests` headers from the actual request scheme, so a mistyped value can no longer force https headers onto a plain-http install.

## Which devices are supported?
Any WiiM / LinkPlay device with the `httpapi.asp` HTTP API: WiiM **Mini, Pro, Pro Plus, Ultra**, **Amp / Amp Pro / Amp Ultra**, and many LinkPlay OEM streamers. Features are detected per device, so unsupported cards are simply hidden. (Non-networked accessories like the passive **Vibelink Amp** can't be controlled — pair them with a streamer.)

## Why is the album art blank for some tracks?
Local / NAS / USB files often don't expose embedded cover art through the WiiM API. The dashboard now falls back to looking the cover up by artist + album (iTunes, keyless) — so most local tracks get art. If a specific album isn't found, it stays blank. Streaming sources (Tidal/Qobuz/Spotify/AirPlay) almost always provide art directly. Disable external lookups with `WIIM_ARTWORK_FALLBACK=false`.

## Can it tell me if a track is AI-generated?
**No.** The dashboard only shows what the device/streaming service reports (title, artist, album, quality). None of them expose an "AI-generated" flag, and detecting AI music from the audio alone is an unsolved problem. If services start tagging it in metadata, it could be surfaced then.

## Why don't some tracks scrobble to Last.fm (e.g. compilations)?
Last.fm **silently refuses** scrobbles whose artist is `"Various Artists"` — its long-standing anti-spam rule for compilation albums. When the track's metadata is tagged that way (common with "Greatest Hits" / various-artist compilations), that's the artist the WiiM passes through and the dashboard sees, so Last.fm drops the scrobble and it never appears on your profile. The dashboard can't override this. Tracks with a real artist scrobble normally. (As of 0.3.6 the server log shows `✗ Last.fm ignored …` with the reason, instead of a misleading ✓, so you can tell exactly what happened.)

## Is my data / my listening private?
Yes. Everything runs on your own machine; the SQLite database lives in a Docker volume you control. Last.fm credentials are stored server-side and never sent to the browser. The only outbound calls are: to your WiiM (LAN), optional Last.fm scrobbling (if you enable it), synced lyrics (LRCLIB, if a track has them), and the optional album-art lookup (iTunes — `WIIM_ARTWORK_FALLBACK=false` turns it off).

## How do I update it?
`docker pull` the new image and recreate the container, or use your platform's auto-update (e.g. Unraid's CA Auto Update). Images are published to **GHCR** and **Docker Hub** (`illianoaoi/wiim-dashboard`) on every release.

## Can I run it on Unraid / Proxmox / Home Assistant?
- **Unraid:** yes — add a container from `illianoaoi/wiim-dashboard` (Docker Hub) or GHCR; CA Auto Update keeps it current. Use a Docker named volume for `/data`, or make the appdata path writable by uid 1001 (the app runs non-root).
- **Proxmox:** spin up a Debian LXC (enable nesting for Docker) or a small VM, install Docker, run the one-liner.
- **Home Assistant:** there's now a **Home Assistant add-on** (beta) that runs the dashboard on HA OS / Supervised. In HA go to Settings → Add-ons → Store → ⋮ → Repositories, add `https://github.com/illianoaoi/Wiim-Dashboard`, then install **WiiM Dashboard** and open the Web UI. (It's not in HACS — HACS is for cards/integrations, not full web apps.) You can also embed the running dashboard in a Lovelace Webpage/iframe card.

## Something's not working / I have an idea
Open a [GitHub issue](https://github.com/illianoaoi/Wiim-Dashboard/issues) with your WiiM model + firmware (from the Device card) and what you expected vs. saw. Feature ideas welcome too.
