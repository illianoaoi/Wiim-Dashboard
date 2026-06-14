# Changelog

All notable changes to this project are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Bluetooth now-playing** — track title/artist/album (via `getMetaInfo` / AVRCP, since `getPlayerStatusEx` leaves them empty for BT) plus the connected source device, e.g. "Bluetooth · @illiano-iPadPro" (from `getbtstatus`). Bluetooth scrobbling works too, using a wall-clock eligibility rule (BT reports no position/length).

### Fixed
- The **WiiM Vibelink Amp** is no longer listed as a supported device — it's a passive power amplifier with no network / HTTP API, so it can't be controlled.

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
