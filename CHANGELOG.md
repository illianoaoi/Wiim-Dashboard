# Changelog

All notable changes to this project are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.16] — 2026-08-13

A robustness pass from auditing [@ozbenh](https://github.com/ozbenh)'s rustywiim for WiiM/LinkPlay device quirks the dashboard didn't yet handle.

### Added
- **Headphone EQ** — devices with a dedicated headphone-output EQ (reported by `GetAcousticCapability`) now get a **Headphones** tab in the Equalizer, editable like any source. Read + write confirmed on a WiiM Ultra.
- **Speaker output** — the built-in speaker of a WiiM **Amp / Amp Ultra** (output mode 7) is now a recognised, selectable output instead of leaving the Output card with nothing highlighted.

### Fixed
- **Track time was wrong on some services** — position/duration now handle sources that report time in **microseconds** (no wire flag), and ignore the device's documented `position > duration` garbage readings; the timeline is also hidden when nothing is playing (it used to show a frozen, stale position).
- **USB-drive playback** was shown as "Network" — playback from an attached USB drive (mode 10 + vendor `UDiskLocal`) is now correctly identified as USB.
- **Missing album art on some devices** — the `albumArtURI` key is read even when the firmware appends a trailing space, and non-URL placeholders like `un_known` are rejected.
- **Transport controls now match the source** — prev / next / shuffle / repeat / seek appear only where they apply (hidden for line-in / optical / HDMI / phono, radio, and cast / AirPlay) instead of showing but doing nothing.
- **Low/High-Pass PEQ filters were rejected by the API** — validation capped the filter type below the Low-Pass/High-Pass values added in 0.3.13, so selecting them failed; now accepted.
- **Phantom input buttons** — `plm_support` is cross-checked against the device's real input list (`getAudioInputEnable`), dropping inputs the device doesn't actually have.
- **Amp speaker mislabelled "Line Out"** — an amp that routes its speaker through the line-out slot now shows its real name.
- **EQ preset names** are restricted to letters / numbers / underscores, matching the firmware's fragile name parser.
- **Hi-res quality badge** — a service's own quality tag (TIDAL HI_RES, Qobuz Hi-Res, Amazon UHD) is trusted, so hi-res streams that fold to 16/44.1 PCM aren't under-labelled as CD-quality.

## [0.3.15] — 2026-08-12

### Changed
- **The USB output button now shows the connected DAC's name** ([#11](https://github.com/illianoaoi/Wiim-Dashboard/issues/11)) instead of a generic “USB” — taken from `getSoundCardModeSupportList`'s `devName` (trimmed to the device name, with a repeated leading word collapsed and over-long names shortened). Thanks to [@MennoH](https://github.com/MennoH) for the suggestion.

## [0.3.14] — 2026-08-12

### Fixed
- **USB output vanished from the Output card after switching away from it** ([#11](https://github.com/illianoaoi/Wiim-Dashboard/issues/11)) — the Output card now builds its list from the device's **live** `getSoundCardModeSupportList` roster instead of the cached capability set, so a volatile output like USB stays listed and switchable for as long as its DAC is connected — and correctly disappears only when the DAC is powered off (matching the WiiM app). Thanks to [@MennoH](https://github.com/MennoH) for testing 0.3.12 and catching it.

## [0.3.13] — 2026-08-11

### Added
- **Low-Pass / High-Pass parametric EQ filters** — the per-band filter-type picker now offers Low Pass and High Pass (the WiiM app's remaining two filter shapes) alongside Peak / Low Shelf / High Shelf. Their gain control is disabled, since the device ignores gain for these slope filters. Filter→mode mapping confirmed on a WiiM Ultra.
- **Simultaneous-output awareness** — devices that drive more than one output at once (e.g. the WiiM Ultra feeds Line Out alongside Optical or COAX) now show it on the Output card (“Also playing through Line Out at the same time”), read from `getSoundCardModeSupportList`'s `coexistMode`.

### Changed
- **EQ/acoustics capability detection via `GetAcousticCapability`** — the dashboard now reads the device's acoustics descriptor (supported PEQ filter set; GEQ / room-correction / headphone-EQ / sub-LPF / output-delay presence) for more reliable EQ detection. Devices that don't expose it (older / OEM firmware) are unaffected.

## [0.3.12] — 2026-08-11

### Fixed
- **USB output missing from the Output card** ([#11](https://github.com/illianoaoi/Wiim-Dashboard/issues/11)) — devices sending audio to an external DAC over USB (`getNewAudioOutputHardwareMode` returns `hardware:8`) had no USB entry, so the active output was invisible and couldn't be switched. USB is now a recognised output mode; the card always renders the device's current output even when it's an undocumented mode; and capability detection additionally offers whatever output the device is currently on. Thanks to [@MennoH](https://github.com/MennoH) for the report and the exact diagnostic (WiiM Ultra).

## [0.3.11] — 2026-07-24

### Added
- **Source detection for OEM streamers via UPnP `GetInfoEx`** ([#9](https://github.com/illianoaoi/Wiim-Dashboard/issues/9)) — some LinkPlay-based OEM boxes (e.g. Audio Pro) return an incomplete HTTP-API player status with no usable source `mode`, so their source/service card never showed. When the HTTP API can't resolve the source, the dashboard now falls back to `GetInfoEx`'s `PlayType` — and on devices that omit that field, derives it from `PlayMedium`. WiiM devices, which always report a good mode, are unaffected.

## [0.3.10] — 2026-07-24

### Fixed
- **Repeat / shuffle could apply the wrong mode** — the write mapping wasn't the inverse of the read mapping, so turning repeat **off** actually wrote the "repeat all" value, and enabling shuffle dropped the current repeat setting. The loopmode table is now symmetric (a written value reads back unchanged), verified on WiiM Ultra + Mini. Thanks to [@ozbenh](https://github.com/ozbenh) for round-tripping it on real hardware.

## [0.3.9] — 2026-07-24

### Changed
- **Play/pause for cast & network sources now comes from UPnP `GetInfoEx`** ([#4](https://github.com/illianoaoi/Wiim-Dashboard/issues/4), [#9](https://github.com/illianoaoi/Wiim-Dashboard/issues/9)) — the HTTP API reports a permanently-stuck "stop" for DLNA/cast push sessions (Plex) and is incomplete on some OEM streamers, so the dashboard now takes the real transport state from `GetInfoEx`'s `CurrentTransportState` for those sources. This fixes the wrong play/pause on Plex, correctly reflects pause and multiroom followers, and removes the previous position-delta heuristic. Physical inputs and Bluetooth are unchanged.

## [0.3.8] — 2026-07-13

### Changed
- **Now-playing metadata now reads from UPnP `GetInfoEx`** ([#4](https://github.com/illianoaoi/Wiim-Dashboard/issues/4), [#8](https://github.com/illianoaoi/Wiim-Dashboard/issues/8), [#9](https://github.com/illianoaoi/Wiim-Dashboard/issues/9)) — the cover art, title/artist/album and the audio-quality readout are now taken from the device's UPnP `GetInfoEx` call, which returns fuller, more reliable data than the HTTP API for **DLNA / cast and OEM sources** (Plex, JRiver, and LinkPlay-based boxes such as iEAST / AudioPro). It falls back to the HTTP API automatically for Bluetooth, physical inputs, and any device that doesn't expose it, so nothing regresses. Transport state, position, source and volume still come from the HTTP API. (Groundwork from [@ozbenh](https://github.com/ozbenh)'s rustywiim.)

### Fixed
- **Scrollbar showing in full-screen kiosk / wall-display mode** — the dashboard behind the full-screen overlay kept its scrollbar in the right gutter; page scroll is now locked while the kiosk view is open and restored on exit.

## [0.3.7] — 2026-07-13

Fixes from community bug reports (thanks [@gthibo](https://github.com/gthibo)).

### Fixed
- **Parametric EQ in L/R mode showed flat, default bands** ([#7](https://github.com/illianoaoi/Wiim-Dashboard/issues/7)) — when the EQ is put in L/R channel mode from the WiiM app, the device returns per-channel bands (`EQBandL`/`EQBandR`) instead of a flat array, which the dashboard didn't read, so every band showed its default. It now reads both channels and adds a **Left/Right view toggle**. L/R editing stays read-only for now (adjust it in the WiiM app) — the per-channel write path needs a device round-trip to confirm it's safe first.
- **Sub-Out card appeared on devices with no sub-out hardware** ([#6](https://github.com/illianoaoi/Wiim-Dashboard/issues/6)) — subwoofer support was inferred from `getSubLPF` fields that *every* LinkPlay device returns. It's now keyed on hardware-only fields (`plugged` / `delay_main_sub` / `linein_delay`). After updating, hit **Refresh** on the Devices page to re-detect an already-added device.
- **Plex / DLNA casts showed a bare "Network" label and the wrong play/pause state** ([#4](https://github.com/illianoaoi/Wiim-Dashboard/issues/4)) — these push sessions carry a `vendor` field the dashboard ignored (so no service name or format) and report a permanently-stuck "stop" while the track advances. The dashboard now names the casting app (Plex, Roon, …), surfaces its format, and derives play/stop from track progress — without disturbing multiroom followers. (Album art for cross-host Plex servers is a known follow-up.)
- **"No lyrics found" for real, popular tracks** ([#5](https://github.com/illianoaoi/Wiim-Dashboard/issues/5)) — LRCLIB's exact-match lookup 404s on any album-name difference (deluxe / single / regional titles). The dashboard now falls back to a search, uses a longer timeout for the (genuinely slow) LRCLIB service, and no longer caches a transient failure as a permanent "no lyrics".

## [0.3.6] — 2026-06-27

### Fixed
- **Last.fm scrobbler reported success for plays it never recorded** — Last.fm returns `HTTP 200` even when it *silently drops* a scrobble (most commonly when the artist is `"Various Artists"`, its anti-spam rule for compilation albums). The client never inspected the `ignored` field in the response, so the log showed `scrobbled ✓` for tracks that never reached your profile. The scrobbler now reads `scrobbles.@attr.ignored` and logs the real outcome (`✗ Last.fm ignored …: <reason>`) instead of a false success — and skips retrying, since a re-submit would be dropped again. (Tracks with a real artist were unaffected and continue to scrobble; Last.fm genuinely will not accept `"Various Artists"`.)

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
