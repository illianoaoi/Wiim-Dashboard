# WiiM Dashboard

Self-hosted web dashboard to see and control what's playing on your WiiM /
LinkPlay streamers — now-playing, EQ, sub-out, sources, presets, Last.fm — from
any browser, running as a Home Assistant add-on.

## Install

1. Settings → Add-ons → Add-on Store → ⋮ (top-right) → **Repositories**.
2. Add: `https://github.com/illianoaoi/Wiim-Dashboard`.
3. Install **WiiM Dashboard**, then **Start** it.
4. Open the Web UI (the "OPEN WEB UI" button, or `http://<home-assistant>:8099`).
5. You'll land on a first-run page — create your login. Then **Add device** and
   enter your WiiM's IP address.

Everything (your login, added devices, Last.fm connection) is stored in the
add-on's data folder and is included in Home Assistant backups.

## Options

Sensible defaults work out of the box — you normally don't need to change
anything.

| Option | Default | When to change |
|--------|---------|----------------|
| `cookie_secure` | `false` | Set **true** only if you reach the add-on over **HTTPS** (e.g. behind your own reverse proxy). Leave false for plain `http://…:8099`. |
| `app_origin` | *(empty)* | Only if you front the add-on with a reverse proxy on a **different hostname** — set it to that public `https://…` URL. Not needed for direct access. |
| `turnstile_site_key` / `turnstile_secret_key` | *(empty)* | Optional Cloudflare Turnstile bot-protection on the login form. |

A strong `AUTH_SECRET` is generated automatically on first start and kept in the
add-on's data (so logins survive restarts) — you don't need to set one.

## Notes

- **Port 8099** maps to the app's internal port 3000. Change the host port under
  the add-on's *Network* tab if 8099 is taken.
- **Not ingress (yet).** The dashboard has its own login and CSRF protection, so
  it runs on its own port rather than through the HA sidebar/ingress.
- **Finding your WiiM's IP:** WiiM Home app → your device → Device Info, or your
  router's device list.
- This is a **community project** — not affiliated with WiiM / LinkPlay.

## Support

Issues and ideas: <https://github.com/illianoaoi/Wiim-Dashboard/issues>
