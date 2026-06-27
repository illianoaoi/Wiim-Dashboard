# Proxmox VE

A helper script that creates a Debian LXC, installs Docker, and runs Wiim Dashboard — one command on your Proxmox host.

> ⚠️ **Beta.** This script hasn't been validated by the maintainer on every Proxmox setup yet. It uses common defaults (`local-lvm`, `local`, `vmbr0`); override them with env vars if yours differ. Please report issues. The polished, catalog version is intended for the [Proxmox VE Helper-Scripts](https://community-scripts.github.io/ProxmoxVE/) project.

## One-command install

On the **Proxmox host**, as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/illianoaoi/Wiim-Dashboard/main/proxmox/install.sh)"
```

Creates an unprivileged Debian 12 LXC (with `nesting` + `keyctl` so Docker runs), installs Docker, runs the dashboard, and prints the URL.

### Override defaults (if your setup differs)

```bash
STORAGE=local-zfs BRIDGE=vmbr1 PORT=39446 DISK_GB=8 CORES=2 RAM_MB=1024 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/illianoaoi/Wiim-Dashboard/main/proxmox/install.sh)"
```

| Var | Default | |
|---|---|---|
| `CTID` | next free | LXC ID |
| `STORAGE` | `local-lvm` | rootfs storage |
| `TEMPLATE_STORAGE` | `local` | where the Debian template lives |
| `BRIDGE` | `vmbr0` | network bridge |
| `DISK_GB` / `CORES` / `RAM_MB` | `8` / `2` / `1024` | container size |
| `PORT` | `39446` | dashboard host port |

When it finishes: open `http://<container-ip>:39446`, create your admin login, and add your WiiM by its IP. The generated `AUTH_SECRET` is saved in the container at `/root/wiim-auth-secret.txt`.

## Prefer to do it by hand?

1. In the Proxmox UI, create a **Debian 12 LXC** — enable **Nesting** (and **keyctl**) under Features so Docker works.
2. Inside the container, install Docker and run it:
   ```bash
   curl -fsSL https://get.docker.com | sh
   docker run -d --name wiim-dashboard --restart unless-stopped \
     -p 39446:3000 -e AUTH_SECRET="$(tr -dc A-Za-z0-9 </dev/urandom | head -c 48)" \
     -e COOKIE_SECURE=false -v wiim-data:/data illianoaoi/wiim-dashboard:latest
   ```
3. Open `http://<container-ip>:39446`.

See the main [EASY-INSTALL guide](../docs/EASY-INSTALL.md) for the plain-Docker version.
