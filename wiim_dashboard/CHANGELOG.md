# Changelog

Add-on versions track the app image they wrap (`ghcr.io/illianoaoi/wiim-dashboard`).

## 0.3.17

- Tracks app **0.3.17** — 12-band parametric EQ where the firmware exposes it, a lyrics timing nudge, and http-only installs no longer get HSTS / `upgrade-insecure-requests` forced on them ([#12](https://github.com/illianoaoi/Wiim-Dashboard/issues/12)).

## 0.3.16

- Tracks app **0.3.16** — device-quirk robustness pass: Headphone EQ, amp Speaker output, position/quality/source decode fixes, source-aware transport controls.

## 0.3.15

- Tracks app **0.3.15** — the USB output button now shows the connected DAC's name ([#11](https://github.com/illianoaoi/Wiim-Dashboard/issues/11)).

## 0.3.14

- Tracks app **0.3.14** — USB output no longer vanishes from the Output card after switching away ([#11](https://github.com/illianoaoi/Wiim-Dashboard/issues/11)).

## 0.3.13

- Tracks app **0.3.13** — Low/High-Pass PEQ filters, simultaneous-output display, and `GetAcousticCapability`-based EQ detection.

## 0.3.12

- Tracks app **0.3.12** — USB output now shown/selectable in the Output card ([#11](https://github.com/illianoaoi/Wiim-Dashboard/issues/11)).

## 0.3.11

- Initial Home Assistant add-on (beta). Wraps the published multi-arch image
  (amd64 + aarch64); maps add-on options to the app's environment; auto-generates
  and persists `AUTH_SECRET`; stores the SQLite database in the add-on's `/data`.
