#!/bin/sh
# Make the data dir writable by the non-root app user, then drop privileges.
#
# The container starts as root ONLY to fix ownership of a bind-mounted /data
# (e.g. Unraid appdata or a plain host bind-mount, which are root-owned), then
# runs the app as the unprivileged "nextjs" user (uid 1001). With a Docker
# named volume the chown is a harmless no-op. The app itself never runs as root.
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R nextjs:nodejs "$DATA_DIR" 2>/dev/null || true
  exec gosu nextjs:nodejs "$@"
fi

# Already non-root (e.g. the user overrode --user) — just run.
exec "$@"
