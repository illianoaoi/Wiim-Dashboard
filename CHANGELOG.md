# Changelog

All notable changes to this project are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.5] — 2026-06-27

### Fixed
- **HDMI ARC missing from the source switcher on the Ultra** — same root cause as the USB input fixed in 0.3.4: WiiM's `plm_support` bitmask doesn't reliably flag the Ultra's HDMI ARC, so it's now offered explicitly. (After updating, hit **Refresh** on the device to re-detect its inputs.)

## [0.3.4] — 2026-06-27

### Fixed
- **USB (and other) inputs missing from the source switcher** — WiiM's `plm_support` bitmask doesn't reliably flag every input (notably the Ultra's USB drive), so some sources were dropped from the dashboard even though the device handles them. USB is now offered on the Ultra, and the **currently-playing source is always kept selectable** — so whatever's active never disappears from the switcher. (After updating, hit **Refresh** on the device on the Devices page to re-detect its inputs.)

## [0.3.3] — 2026-06-27

Easier self-hosting — Unraid support and bind-mount-friendly data directories.

### Added
- **Unraid template** — a Community Applications template ([`unraid/wiim-dashboard.xml`](unraid/wiim-dashboard.xml)) for quick setup on Unraid, pulling the image from Docker Hub. The CA Auto Update plugin keeps it current.

### Changed
- **Bind-mount-friendly data directory** — the container now fixes the data directory's ownership on startup, then drops to a non-root user (via `gosu`), so a host bind-mount like Unraid's `/mnt/user/appdata` works out of the box with no manual `chown`. The default named-volume setup is unchanged, and the app still never runs as root.

## [0.3.2] — 2026-06-27

Album art for local files, plus friendlier docs for newcomers.

### Added
- **Album-art fallback for local files** — when a track exposes no embedded cover (common with local / NAS / USB files), the dashboard now looks one up by artist + album via the keyless iTunes Search API. Results are cached and matched by album name, so it never shows the wrong cover. Disable with `WIIM_ARTWORK_FALLBACK=false`.
- **Easy-install guide & FAQ** — a plain-English, step-by-step [install guide](docs/EASY-INSTALL.md) (no command-line experience needed) and an [FAQ](docs/FAQ.md) covering the most common questions.

### Changed
- **Tidier track titles** — filename-style titles from local files (e.g. `01.In_The_Flesh.flac`) are cleaned up to a readable form ("In The Flesh").

## [0.3.1] — 2026-06-26

Reliability + distribution: gentler on the device, and now on Docker Hub too.

### Changed
- **Per-device request throttling** — the dashboard now caps how many `httpapi` calls hit a single device at once. A status poll fans out ~9 reads in parallel, and embedded LinkPlay hardware can drop or garble requests under that burst, causing intermittent command failures. Concurrency is capped at 4 per device by default; tune with `WIIM_DEVICE_CONCURRENCY` (set `1`–`2` for older / flaky units).
- **Docker Hub images** — releases now publish to **Docker Hub** (`docker.io/illianoaoi/wiim-dashboard`) alongside GHCR, so Unraid (and other tools) can pull and auto-update from either registry.

## [0.3.0] — 2026-06-26

A big feature drop — auto-imported input names, a fullscreen kiosk/wall-display mode with synced lyrics, a sleep timer, Last.fm listening stats, and richer device info (Wi-Fi signal, USB DAC).

### Added
- **Auto-imported input names** — the dashboard now reads the custom input names you set in the WiiM app (`getModeRename`) and uses them as the default source labels, so renamed inputs (e.g. "Turntable", "TV") show up automatically without re-typing them here. Your own per-device names still win; the WiiM-app name is the fallback before the generic label.
- **Kiosk / wall-display mode** — a chrome-free fullscreen now-playing view built around the spinning vinyl, for wall-mounted tablets and vinyl-wall setups. Toggle it from the artwork view switcher.
- **Synced lyrics** — a lyrics view (cover / vinyl / **lyrics** / fullscreen toggle) that auto-scrolls to the current line and lets you tap a line to seek. Lyrics come from [LRCLIB](https://lrclib.net/) (free, key-less) via a server-side route that parses LRC into timed lines and caches them; falls back to plain lyrics, then "No lyrics found". Shown only when the track has an artist + title.
- **Sleep timer** — a 🌙 button on the Now Playing card sets a 15–120 min timer that pauses the device when it expires. Like the scrobbler it runs **server-side**, so it fires even with the browser closed; the button shows a live countdown with one-tap cancel.
- **Last.fm stats panel** — when Last.fm is connected, a card shows your top artists and top tracks for a selectable period (7 days / month / all time) plus total scrobbles. Text-only, so it needs no image proxy or CSP changes.
- **Wi-Fi signal indicator** — the Device card shows signal-strength bars from `getStatusEx` `RSSI` (or "Ethernet" when wired) instead of a bare dBm number.
- **USB DAC detection** — a connected USB DAC's name is read from `getSoundCardModeSupportList` (`AUDIO_OUTPUT_UAC_CARD_MODE` → `devName`) and shown on the Device card.

### Changed
- **Only enabled inputs are shown** — `getAudioInputEnable` reports which physical inputs you've turned off in the WiiM app, and the Source switcher now hides them (always keeping the active one). Shows everything when the device doesn't support the query.
- **Refined vinyl view** — a public-domain (CC0) record illustration with the album art composited as the spinning centre label (cream label for physical inputs), a metallic tonearm, and a static reflection sheen.
- **Colour-graded quality chip** — a single pill graded by tier: gold **Hi-Res Lossless**, silver **Lossless**, grey **Lossy** (e.g. `9216 kbps | 24-bit/192 kHz`), reused in the card and the kiosk view.
- README now has a **GitHub Sponsors** support section.

### Fixed
- **24-bit hi-res FLAC** is now reported as 24-bit, not 32 — firmware packs the 24 significant bits into 32-bit words and reports the word size; no consumer streaming source is true 32-bit, so 32 is normalised to 24.

## [0.2.2] — 2026-06-21

Now-playing visual polish — a spinning vinyl view, a clearer bit-rate readout, and the current track in the browser tab.

### Added
- **Vinyl-record now-playing view** — a toggle on the Now Playing card swaps the album cover for a spinning vinyl record, with the cover as the centre label. Physical turntables (**Phono**) default to it. The platter eases up to speed and gradually slows to a stop (rAF-driven, like a real turntable, not an abrupt CSS cut), a tonearm rests its stylus on the outer grooves, and the disc still drives the album-art colour theming. Honours `prefers-reduced-motion`, and the cover ⇄ vinyl choice is remembered across sessions.
- **Now playing in the browser tab** — the document title now shows `<Track> - <Artist> | Wiim Dashboard` for the selected device, updating live on every track change and falling back to the app name when nothing is playing.

### Changed
- **Clearer bit-rate readout** — the quality chip (kbps · bit-depth · kHz) was purple-on-tint and hard to read over the album-art colour wash. It's now a segmented chip: each value sits in its own cell divided by thin rules, the number emphasised and the unit muted, on a neutral frosted background — legible on any cover colour.

## [0.2.1] — 2026-06-20

Now-playing polish (album-art theming, Bluetooth), plus fixes for cloud-hosted
artwork and iPad rendering.

### Added
- **Album-art colour theming** — the Now Playing card tints to the current cover's dominant colour, with a matching glow around the artwork, crossfading smoothly on every track change. The colour is extracted client-side from the displayed cover (canvas) and normalised so dark or washed-out covers still read clearly; black-and-white covers tint nothing.
- **Bluetooth now-playing** — playing over Bluetooth leaves `getPlayerStatusEx` empty, so the dashboard now reads the track title / artist / album from `getMetaInfo` (AVRCP) and shows the **connected source device** alongside the source, e.g. "Bluetooth · @your-iPad" (via `getbtstatus`).
- **Bluetooth scrobbling** — the Last.fm scrobbler now covers Bluetooth too; since BT reports no track position/length, it uses a wall-clock eligibility rule instead of the position-based one.

### Fixed
- **Cloud-CDN artwork** — album art and preset tiles served by WiiM's cloud CDN (`*.wiimhome.com`) showed blank because the CDN mislabels them as `application/octet-stream`, so the `image/*` check dropped them. The art proxy now sniffs the image's magic bytes and serves the correct type, fixing **both** the album-art and preset-art proxies while keeping the SSRF guard, TLS verification and IP-pinning intact. Thanks to **@gthibo** for the report and original fix (#1, #2).
- **Slider fills on iOS / iPad** — the volume, seek, EQ and sub-out slider fills rendered as a dark track in Safari/WebKit, because Tailwind's `bg-gradient-*` helper relies on custom properties iOS doesn't parse here. Switched to an explicit CSS gradient so the purple→cyan fill shows on every browser.
- **WiiM Vibelink Amp** is no longer listed as a supported device — it's a passive power amplifier with no network / HTTP API, so the dashboard can't control it.

## [0.2.0] — 2026-06-14

A large update focused on the Now Playing experience and a full Last.fm integration.

### Added
- **Last.fm scrobbling** — a server-side background scrobbler that runs independently of any open browser tab. It detects track changes per device, sends `track.updateNowPlaying`, and scrobbles once Last.fm's eligibility rule is met (track > 30s, played ≥ half its length or 4 minutes). Enable it per device in Settings.
- **Last.fm Love** — a ❤ button on the Now Playing card (`track.love` / `track.unlove`) that reflects the track's current loved state. WiiM exposes no native favorite command, so this is wired through Last.fm.
- **Streaming service + format readout** under the controls: the service logo and name (Spotify / TIDAL / Qobuz Connect, AirPlay, DLNA, QPlay, Bluetooth, and in-app services detected from the art host), the inferred codec (FLAC / ALAC / OGG / AAC / MP3), and a graded quality tier — gold **Hi-Res Lossless** (24-bit / >48 kHz), silver **Lossless** (16-bit / CD), grey **Lossy** — so quality reads at a glance.
- Source icon shown in the Now Playing source pill.

### Changed
- Bit rate shown in kbps only (no Mbps conversion), ordered bitrate · bit-depth · sample-rate.
- Quality tier is inferred from **bitrate** (lossy ≤ 400 kbps vs lossless FLAC ~700 kbps+) instead of the device's decoded bit-depth — fixing lossy streams (e.g. Spotify 320 kbps OGG) being mislabeled as Lossless.

### Fixed
- **Repeat / Shuffle** mapping corrected to the official WiiM loop-mode tables (the previous python-linkplay/HA enum mislabeled and mis-set modes on current firmware). Buttons now also update optimistically.
- HTML entities in Title / Artist / Album are decoded (`&amp;` → `&`), fixing both the display and Last.fm scrobbles.

## [0.1.2] — 2026-06-13

### Added
- Full per-source **Graphic (10-band) + Parametric EQ** with a firmware kill-switch that hides the card if the EQ API breaks.
- In-app modal dialogs replacing browser pop-ups.
- Settings to toggle which dashboard cards are shown.

### Changed
- Built-in EQ presets are adjustable but protected from being overwritten.

## [0.1.1] — 2026-06-13

### Fixed
- EQ card not appearing — `EQ_support` is a firmware version string, not a boolean flag.

## [0.1.0] — 2026-06-13

Initial public release.

### Added
- Dark, mobile-first dashboard for WiiM / LinkPlay devices.
- **Now playing**: metadata (hex-decoded), proxied album art, live progress, seek, transport, shuffle/repeat.
- **Quality readout**: bit rate · sample rate · bit depth.
- **Volume / Sub-out / Crossover** sliders with touch-friendly −/+ buttons.
- **Sub-out** control (level, crossover, phase, enable) for supported models.
- **EQ** enable/disable + named presets.
- **Source** and **Output** switching, auto-detected per model; per-device custom source names.
- **Presets**: square artwork tiles (count per model), play via `MCUKeyShortClick`, names + art from `getPresetInfo`, horizontal-scroll on phones.
- **Temperature** gauge for amp models.
- **Multi-device** support with capability detection; add by IP or LAN scan.
- **Auth**: Argon2id login, HMAC-peppered server sessions, optional TOTP 2FA, Cloudflare Turnstile, per-IP + global rate-limiting.
- **Security**: SSRF-guarded device proxy (DNS-resolve + IP-pin), double-submit CSRF, nonce-based CSP + security headers.
- **Docker** single-image deploy with named-volume persistence.
- Docs: README, ARCHITECTURE, CONTRIBUTING, SECURITY, WiiM API reference.
