# Easy install guide (no experience needed) 🚀

The **plain-English, step-by-step** way to get Wiim Dashboard running — no command-line experience required. If you can install an app and copy-paste one line, you can do this. About 10 minutes.

> **What is it?** A free dashboard to see and control whatever's playing on your WiiM — now playing, volume, EQ, sources, presets — from any phone, tablet, or computer browser. It runs on **your own computer** (or a home server / NAS / Raspberry Pi), talks to your WiiM over your home network, and **never touches or changes the WiiM device itself**. WiiM firmware updates don't affect it.

## What you'll need
- A computer (Mac, Windows, or Linux) on the **same network** as your WiiM, that's on when you want to use the dashboard.
- Your WiiM's IP address (we'll find it in Step 4).
- ~10 minutes.

## Step 1 — Install Docker Desktop
"Docker" is a free tool that runs apps in a tidy, self-contained box so they don't mess with your computer.

1. Go to **https://www.docker.com/products/docker-desktop/**
2. Download Docker Desktop for your system (Mac / Windows) and install it like any normal app.
3. Open it and wait until it's finished starting (you'll see a little whale 🐳 when it's ready).

*(Linux: install Docker Engine + Compose from your distro instead.)*

## Step 2 — Run the dashboard (one copy-paste)
1. Open a terminal:
   - **Mac:** open the **Terminal** app (press Cmd+Space, type "Terminal").
   - **Windows:** open **PowerShell** (Start menu → type "PowerShell").
2. Copy this **whole line**, paste it, press Enter. **Change the text in quotes** to any long random text — this is your secret key, just mash the keyboard (30+ characters):

   ```
   docker run -d --name wiim-dashboard -p 39446:3000 -e AUTH_SECRET="change-this-to-any-long-random-text" -e COOKIE_SECURE=false -v wiim-data:/data ghcr.io/illianoaoi/wiim-dashboard:latest
   ```

   It downloads the app (first time only) and starts it. When your prompt comes back, it's running. 🎉

> 💡 The app is also on **Docker Hub** as `illianoaoi/wiim-dashboard` if you'd rather search for it in the Docker Desktop UI.

## Step 3 — Open it in your browser
- On the **same computer**: go to **http://localhost:39446**
- From your **phone / another device**: go to **http://YOUR-COMPUTER-IP:39446** — your computer's address on the home network, e.g. `http://192.168.1.20:39446`.

You'll land on a **first-run setup page** → create your login (username + password). You're in!

## Step 4 — Add your WiiM
1. Find your WiiM's IP: open the **WiiM Home app** → your device → **Device Info / Settings** (or check your router's device list). It looks like `192.168.1.50`.
2. In the dashboard: **Add device** → type that IP → Save.
3. Done — now playing + full controls show up 🎶

## If something doesn't work
| Problem | Fix |
|---|---|
| Blank/white page over `http://…` | Make sure `COOKIE_SECURE=false` was in the command (it is, above). Don't use `https://` for a local IP. |
| Can't reach it from my phone | Use your **computer's** IP, not `localhost`, and make sure the phone is on the same WiFi. |
| "Device offline" / can't add the WiiM | Re-check the WiiM's IP, that it's powered on, and on the same network. |
| Update it later | `docker pull ghcr.io/illianoaoi/wiim-dashboard:latest`, then in Docker Desktop delete the container and re-run the Step 2 command. |

## Want it reachable from outside your home, over HTTPS?
That's **optional** and a bit more advanced (a reverse proxy like Zoraxy/Caddy). For home use you don't need it — see the main [README](../README.md#public-access--reverse-proxy) if you ever want to set it up.

---
Stuck on any step? Open a [GitHub issue](https://github.com/illianoaoi/Wiim-Dashboard/issues) or ask in the group — happy to help. 🙌
