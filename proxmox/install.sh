#!/usr/bin/env bash
# Wiim Dashboard — Proxmox VE helper script.
#
# Run on the Proxmox VE HOST as root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/illianoaoi/Wiim-Dashboard/main/proxmox/install.sh)"
#
# Creates an unprivileged Debian 12 LXC (with nesting + keyctl so Docker works),
# installs Docker, and runs Wiim Dashboard. Prints the URL when done.
#
# ⚠️ BETA — community-tested, not yet validated by the maintainer on every
# Proxmox setup. Override the defaults below via env vars if your storage /
# bridge names differ, e.g.:  STORAGE=local-zfs BRIDGE=vmbr1 bash install.sh
#
# The polished, catalog version lives at https://community-scripts.github.io/ProxmoxVE/
set -euo pipefail

# --- defaults (override via env) --------------------------------------------
CTID="${CTID:-}"                       # LXC ID (auto-picks the next free one if empty)
CT_HOSTNAME="${CT_HOSTNAME:-wiim-dashboard}"
DISK_GB="${DISK_GB:-8}"
CORES="${CORES:-2}"
RAM_MB="${RAM_MB:-1024}"
BRIDGE="${BRIDGE:-vmbr0}"
STORAGE="${STORAGE:-local-lvm}"        # rootfs storage
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
PORT="${PORT:-39446}"
IMAGE="${IMAGE:-illianoaoi/wiim-dashboard:latest}"

msg() { echo -e "\e[1;34m==>\e[0m $*"; }
err() { echo -e "\e[1;31mError:\e[0m $*" >&2; exit 1; }

# --- preflight --------------------------------------------------------------
command -v pct >/dev/null 2>&1 || err "This must run on a Proxmox VE host (pct not found)."
[ "$(id -u)" = "0" ] || err "Run as root."

[ -n "$CTID" ] || CTID="$(pvesh get /cluster/nextid)"
pct status "$CTID" >/dev/null 2>&1 && err "LXC $CTID already exists — set CTID=<free id>."

# --- Debian 12 template -----------------------------------------------------
msg "Finding a Debian 12 LXC template…"
pveam update >/dev/null 2>&1 || true
TEMPLATE="$(pveam available --section system 2>/dev/null | awk '/debian-12-standard/{print $2}' | sort -V | tail -n1)"
[ -n "$TEMPLATE" ] || err "No debian-12-standard template available from pveam."
if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  msg "Downloading $TEMPLATE to $TEMPLATE_STORAGE…"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

# --- create + start the container -------------------------------------------
msg "Creating LXC $CTID ($CT_HOSTNAME) — ${CORES} cores, ${RAM_MB}MB, ${DISK_GB}GB on $STORAGE…"
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$RAM_MB" --swap "$RAM_MB" \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
  --features "nesting=1,keyctl=1" \
  --unprivileged 1 --onboot 1 --start 1

msg "Waiting for network…"
for _ in $(seq 1 30); do
  pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
  sleep 2
done

# --- install Docker + run the app (inside the LXC) --------------------------
msg "Installing Docker + Wiim Dashboard inside the container…"
pct exec "$CTID" -- bash -euo pipefail -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates >/dev/null
  curl -fsSL https://get.docker.com | sh >/dev/null
  SECRET="$(tr -dc "A-Za-z0-9" </dev/urandom | head -c 48)"
  printf "%s\n" "$SECRET" > /root/wiim-auth-secret.txt
  docker run -d --name wiim-dashboard --restart unless-stopped \
    -p '"$PORT"':3000 \
    -e AUTH_SECRET="$SECRET" \
    -e COOKIE_SECURE=false \
    -v wiim-data:/data \
    '"$IMAGE"'
'

IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
echo
msg "✅ Done!"
echo "   Wiim Dashboard → http://${IP:-<container-ip>}:${PORT}"
echo "   LXC ID:          $CTID"
echo "   AUTH_SECRET:     saved in the container at /root/wiim-auth-secret.txt"
echo "   Open it, create your admin login, then add your WiiM by its IP. 🎶"
