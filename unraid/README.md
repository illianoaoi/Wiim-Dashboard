# Unraid

A [Community Applications](https://unraid.net/community/apps) template for running Wiim Dashboard on Unraid.

## Install (manual template)

Until this is listed in Community Applications, add it by hand:

1. Unraid → **Docker** tab → **Add Container** → switch **Template** to *(none)* and fill in, or import the [`wiim-dashboard.xml`](wiim-dashboard.xml) template:
   - **Repository:** `illianoaoi/wiim-dashboard:latest`
   - **WebUI port:** `39446` → container `3000`
   - **`AUTH_SECRET`** (required): a long random string — generate with `openssl rand -base64 48`
   - **`COOKIE_SECURE`** = `false` (for plain-http LAN access)
   - **App Data path:** `/mnt/user/appdata/wiim-dashboard` → `/data`
2. Apply, then open the WebUI, create your admin login, and add your WiiM by its IP.

> The container starts as root only to fix the appdata folder's ownership, then drops to a non-root user — so a normal `/mnt/user/appdata` path works without manual `chmod`.

## Auto-updates

Install the **CA Auto Update Applications** plugin — it updates the GHCR/Docker Hub image automatically. The image is published to both `illianoaoi/wiim-dashboard` (Docker Hub) and `ghcr.io/illianoaoi/wiim-dashboard` (GHCR) on every release.

## Reverse proxy / HTTPS

For LAN-only use you don't need one. To expose it over HTTPS, put it behind a reverse proxy, set `COOKIE_SECURE` unset + `APP_ORIGIN=https://your-domain`, and see the main [README](../README.md#public-access--reverse-proxy).
