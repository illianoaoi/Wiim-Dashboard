#!/usr/bin/env sh
# Map the Home Assistant add-on options (/data/options.json) to the app's env,
# then start the server. Runs unprivileged (uid 1001) — the base image's
# entrypoint has already fixed /data ownership and dropped privileges before
# exec-ing this. `node` is in the image, so we read the JSON with it (no bashio
# / jq needed).
set -e

OPTS=/data/options.json
opt() {
  node -e "try{const v=require('$OPTS')['$1'];process.stdout.write(v==null?'':String(v))}catch(e){}"
}

# AUTH_SECRET: auto-generated once and persisted in /data (64 chars), so login
# sessions survive restarts without the user having to create a secret. Kept in
# /data, which is backed up with the add-on.
if [ ! -s /data/.auth_secret ]; then
  node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))" > /data/.auth_secret
fi
export AUTH_SECRET="$(cat /data/.auth_secret)"

export DATA_DIR=/data
export PORT=3000
export HOSTNAME=0.0.0.0
# The add-on is reached directly on the LAN, not through a reverse proxy, so
# don't trust X-Forwarded-* and (by default) don't require HTTPS-only cookies.
export TRUST_PROXY=false
CS="$(opt cookie_secure)"
export COOKIE_SECURE="${CS:-false}"

# Optional passthroughs — only exported when set.
V="$(opt app_origin)";           [ -n "$V" ] && export APP_ORIGIN="$V"
V="$(opt turnstile_site_key)";   [ -n "$V" ] && export TURNSTILE_SITE_KEY="$V"
V="$(opt turnstile_secret_key)"; [ -n "$V" ] && export TURNSTILE_SECRET_KEY="$V"

exec node server.js
