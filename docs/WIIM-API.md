# WiiM / LinkPlay HTTP API reference

The commands this project uses, as implemented in `src/lib/wiim/`. Sources: the official *HTTP API for WiiM Products v1.2* PDF, [`python-linkplay`](https://github.com/Velleman/python-linkplay), and [`pywiim`](https://github.com/mjcumming/pywiim). Where a command is **not** in the official PDF it's marked _community-verified_.

## Transport

```
GET https://<device-ip>/httpapi.asp?command=<COMMAND>
```

- **HTTPS on port 443**, self-signed cert (CN `www.linkplay.com`) — TLS verification must be disabled.
- Some firmware (e.g. WiiM Ultra fw 5.x) requires a **mutual-TLS client certificate** — the shared LinkPlay cert is embedded in `src/lib/wiim/linkplay-cert.ts`.
- Most queries return JSON (string-typed values); setters return `OK`. `unknown command` indicates the model doesn't support it.

## Device info — `getStatusEx`

Returns identity + capabilities. Fields this app reads:

| Field | Meaning |
|---|---|
| `DeviceName` / `ssid` | device name |
| `project` / `priv_prj` | model code (→ friendly name) |
| `firmware` / `Release` | firmware version |
| `MAC` / `STA_MAC` / `ETH_MAC` | MAC |
| `apcli0` / `eth0` / `ra0` | IP (active interface) |
| `uuid` | device UUID |
| `RSSI` / `internet` | wifi signal / internet flag |
| `EQ_support` | EQ capability flag |
| `plm_support` | **bitmask** of supported inputs (see below) |
| `preset_key` | number of preset slots |
| `temperature_cpu` / `temperature_tmp102` | °C — **amp models only** |

## Playback

| Purpose | Command |
|---|---|
| Status (extended) | `getPlayerStatusEx` |
| Metadata (art, rate) | `getMetaInfo` → `metaData.{…}` (see below) |
| Resume / Pause / Toggle | `setPlayerCmd:resume` / `:pause` / `:onepause` |
| Next / Prev / Stop | `setPlayerCmd:next` / `:prev` / `:stop` |
| Seek (seconds) | `setPlayerCmd:seek:<s>` |
| Volume (0–100) | `setPlayerCmd:vol:<n>` |
| Mute | `setPlayerCmd:mute:<0\|1>` |
| Loop/shuffle | `setPlayerCmd:loopmode:<n>` (see below) |

`getPlayerStatusEx` notes: `status` = `play|pause|stop|load`; `Title`/`Artist`/`Album` are **hex-encoded UTF-8** (and may contain HTML entities such as `&amp;`, which the app decodes); `curpos`/`totlen` are ms; `mode` = numeric source; `vol`, `mute`, `eq`, `loop`.

### `getMetaInfo` → `metaData`

Fields read: `album`, `title`, `subtitle`, `artist`, `albumArtURI`, `sampleRate`, `bitDepth`, `bitRate`, `trackId`. All values are strings.

- There is **no codec/format field** and **no vendor field** anywhere in the WiiM API. The playing service is derived from `mode` (see below) and the codec is **inferred** from the service + quality tier.
- `bitRate` and `trackId` are often the literal string `"unknow"` (sic), and `bitRate` may be reported in bps or kbps depending on firmware.
- The device reports a **decoded PCM `bitDepth`** (e.g. `16`) even for lossy streams, so bit-depth alone cannot tell lossy from lossless — `bitRate` is the reliable signal (a 320 kbps OGG still reports 16-bit).

### Loop / shuffle (`loop` read vs `loopmode` write)

The **read** field `loop` (from `getPlayerStatusEx`) and the **write** command `setPlayerCmd:loopmode` use **different, asymmetric** tables on current WiiM firmware:

| `loop` (read) | Meaning |
|---|---|
| `0` | loop all → repeat all |
| `1` | single loop → repeat one |
| `2` | shuffle loop → shuffle + repeat all |
| `3` | shuffle, no loop → shuffle, no repeat |
| `4` | no shuffle, no loop → off (default) |

| `loopmode` (write, documented `{-1,0,1,2}`) | Effect |
|---|---|
| `0` | off (reads back as `4`) |
| `1` | repeat one |
| `2` | shuffle (shuffle + repeat all) |
| `-1` | repeat all (reads back as `0`) |

The older python-linkplay / Home-Assistant loop-mode enum was written against older LinkPlay firmware and **mis-maps these on current WiiM units** (e.g. it would set Repeat-One when asked for Repeat-All).

### Playing-mode (`mode`) → source

`10/20…` network/streaming · `1` AirPlay · `2` DLNA · `31` Spotify · `32` TIDAL · `40` line-in · `41` Bluetooth · `43` optical · `45` coaxial · `49` HDMI · `51` USB-DAC · `54` phono · `58` HDMI ARC … (full map in `constants.ts`). Streaming modes are treated as the "Network/WiFi" source.

#### `mode` → streaming service

Because there is no vendor field, the now-playing **service** is derived from `mode`. Connect / cast / protocol sessions have dedicated codes:

| `mode` | Service |
|---|---|
| `1` | AirPlay |
| `2` | DLNA |
| `3` | QPlay |
| `31` | Spotify Connect |
| `32` | TIDAL Connect |
| `36` | Qobuz Connect |
| `41` | Bluetooth |

Generic in-app network streaming is **mode `10`/`20`** (and a few neighbours) — there's no dedicated code, so the service is guessed by sniffing the `albumArtURI` host (tidal / qobuz / deezer / amazon / spotify / soundcloud / youtubemusic / tunein).

#### Bluetooth (mode `41`)

`getPlayerStatusEx` leaves `Title`/`Artist` empty for Bluetooth — the track metadata arrives via **`getMetaInfo`** (AVRCP). The connected source device (the casting phone/tablet) comes from **`getbtstatus`** → `a2dp_sink.name` (when `a2dp_sink.link_state` is `"connected"`); **`getbthistory`** lists previously-paired devices (`name`, `ad` = MAC, `ct` = connected flag).

## EQ

| Purpose | Command |
|---|---|
| On / Off | `EQOn` / `EQOff` |
| State | `EQGetStat` |
| List presets | `EQGetList` |
| Load preset | `EQLoad:<name>` (e.g. `Bass Booster`) |

Per-band graphic/parametric EQ exists on newer firmware but is **community-only** and not implemented here.

## Sub-out _(community-verified; WiiM Ultra fw5.2+, Pro fw4.8+)_

| Purpose | Command |
|---|---|
| Get all sub settings | `getSubLPF` |
| Level (−15…+15 dB) | `setSubLPF:level:<n>` |
| Crossover (30–250 Hz) | `setSubLPF:cross:<n>` |
| Phase (0/180) | `setSubLPF:phase:<0\|180>` |
| Delay (−200…200 ms) | `setSubLPF:sub_delay:<n>` |
| Enable | `setSubLPF:status:<0\|1>` |

`getSubLPF` also reports `plugged` (subwoofer connected).

## Input source switching

```
setPlayerCmd:switchmode:<mode>   # case-sensitive
```

Official: `wifi`, `line-in`, `bluetooth`, `optical`, `udisk`. Community/extended: `co-axial`, `HDMI`, `ARC`, `phono`, `RCA`, `XLR`, `PCUSB`, `line-in2`, `optical2`, `co-axial2`, `cd`. The app shows only inputs present in the `plm_support` bitmask.

### `plm_support` bitmask
`2` line-in · `4` bluetooth · `8` usb · `16` optical · `32` rca · `64` coaxial · `256` line-in2 · `512` xlr · `1024` hdmi · `2048` cd · `32768` usb-dac · `65536` phono · `262144` optical2 · `524288` coaxial2 · `4194304` arc.

## Audio output

| Purpose | Command |
|---|---|
| Read | `getNewAudioOutputHardwareMode` → `{hardware,source,audiocast}` |
| Set | `setAudioOutputHardwareMode:<n>` |

`n`: `1`=optical, `2`=line-out, `3`=coax _(documented)_; `4`=headphones (Ultra) _(community)_.

## Presets (favourites)

| Purpose | Command |
|---|---|
| Count | `getStatusEx.preset_key` |
| List (names + artwork) | `getPresetInfo` → `preset_list[{number,name,url,source,picurl}]` |
| Play slot N | `MCUKeyShortClick:<n>` |

## Discovery

- **SSDP** `M-SEARCH` for `urn:schemas-upnp-org:device:MediaRenderer:1` (+ `urn:schemas-wiimu-com:service:PlayQueue:1`), then confirm via `getStatusEx`. Needs UDP multicast (host networking).
- **IP-range scan** — probe `getStatusEx` on each host in a `/24` (works in Docker bridge mode).

## Not implemented (by choice)

Destructive/administrative commands — `reboot`, `setShutdown`, factory reset, network config — are intentionally **not** proxied for safety.

## Not available in the HTTP API

- **No favorite / like / thumbs-up command** for the *current* track. Confirmed against the official PDF, `python-linkplay`, and the community OpenAPI. The WiiM app's heart calls each streaming service's own cloud API, which a server can't reach — so this project implements "Love" via **Last.fm `track.love`** instead.
- **Preset slots are read-only over HTTP** — you can list them (`getPresetInfo`) and **play** a slot (`MCUKeyShortClick:<n>`), but there is no command to set or reorder a preset from the API.
