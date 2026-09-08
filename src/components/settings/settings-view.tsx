"use client";

import { useState } from "react";
import {
  KeyRound,
  ShieldCheck,
  Bot,
  Gauge,
  Save,
  ShieldOff,
  QrCode,
  LayoutGrid,
  Radio,
  Heart,
  Link as LinkIcon,
  Image as ImageIcon,
  Plus,
  X,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/toast";
import { apiSend, ApiError } from "@/lib/client/api";
import { useSettings, useDevices, type CardVisibility } from "@/lib/client/hooks";

export function SettingsView({ totpEnabled }: { totpEnabled: boolean }) {
  return (
    <div className="space-y-5">
      <DisplayCards />
      <Scrobbling />
      <ChangePassword />
      <TwoFactor enabled={totpEnabled} />
      <TurnstileSettings />
      <ArtworkHosts />
      <GeneralSettings />
    </div>
  );
}

function Scrobbling() {
  const toast = useToast();
  const { settings, mutate } = useSettings();
  const { devices } = useDevices();
  const lf = settings?.lastfm;
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAuth, setPendingAuth] = useState(false);

  const keyVal = apiKey ?? lf?.apiKey ?? "";
  const hasSecret = lf?.hasSecret ?? false;
  const hasCreds = !!keyVal && hasSecret;
  const connected = lf?.connected ?? false;

  async function saveCreds() {
    setBusy(true);
    try {
      await apiSend("/api/lastfm/credentials", "POST", {
        apiKey: keyVal,
        apiSecret: apiSecret.length > 0 ? apiSecret : undefined,
      });
      toast("Last.fm credentials saved", "success");
      setApiSecret("");
      setApiKey(null);
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not save", "error");
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    try {
      const r = await apiSend<{ authUrl: string }>("/api/lastfm/connect", "POST");
      window.open(r.authUrl, "_blank", "noopener,noreferrer");
      setPendingAuth(true);
      toast("Approve access on Last.fm, then click Complete", "info");
    } catch (e) {
      toast((e as ApiError).message || "Could not start connection", "error");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    try {
      const r = await apiSend<{ username: string }>("/api/lastfm/session", "POST");
      toast(`Connected as ${r.username}`, "success");
      setPendingAuth(false);
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not complete connection", "error");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await apiSend("/api/lastfm/disconnect", "POST");
      setPendingAuth(false);
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not disconnect", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDevice(id: string, enabled: boolean) {
    setBusy(true);
    try {
      await apiSend("/api/lastfm/devices", "PATCH", { deviceId: id, enabled });
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not save", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader icon={<Radio className="size-4" />} title="Last.fm Scrobbling" className="px-0 pt-0" />
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Scrobble what your devices play (server-side, even with this tab closed) and enable the{" "}
          <Heart className="inline size-3.5 -translate-y-px text-rose-400" /> Love button. Create an
          API account at{" "}
          <a
            className="text-primary underline"
            href="https://www.last.fm/api/account/create"
            target="_blank"
            rel="noopener noreferrer"
          >
            last.fm/api/account/create
          </a>{" "}
          and paste the key + shared secret.
        </p>

        <Field label="API key">
          <Input
            value={keyVal}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Last.fm API key"
          />
        </Field>
        <Field
          label="Shared secret"
          hint={hasSecret ? "A secret is saved — leave blank to keep it." : undefined}
        >
          <Input
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder={hasSecret ? "•••••••• (unchanged)" : "Last.fm shared secret"}
          />
        </Field>
        <Button variant="secondary" onClick={() => void saveCreds()} disabled={busy || !keyVal}>
          {busy ? <Spinner /> : <Save className="size-5" />} Save credentials
        </Button>

        <div className="border-t border-border/60 pt-4">
          {connected ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-success">
                <ShieldCheck className="size-4" /> Connected as{" "}
                <span className="font-medium">{lf?.username}</span>
              </p>
              <Button variant="destructive" onClick={() => void disconnect()} disabled={busy}>
                Disconnect
              </Button>
            </div>
          ) : pendingAuth ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                A Last.fm tab opened — approve access there, then click Complete.
              </p>
              <Button onClick={() => void complete()} disabled={busy}>
                {busy ? <Spinner /> : <ShieldCheck className="size-5" />} Complete connection
              </Button>
            </div>
          ) : (
            <Button onClick={() => void connect()} disabled={busy || !hasCreds}>
              {busy ? <Spinner /> : <LinkIcon className="size-5" />} Connect Last.fm account
            </Button>
          )}
        </div>

        {connected && devices.length > 0 && (
          <div className="border-t border-border/60 pt-4">
            <p className="text-sm font-medium">Scrobble these devices</p>
            <div className="mt-2 divide-y divide-border/60">
              {devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm">{d.name}</span>
                  <Switch
                    checked={!!lf?.scrobbleDevices?.[d.id]}
                    onChange={(v) => void toggleDevice(d.id, v)}
                    disabled={busy}
                    aria-label={`Scrobble ${d.name}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function DisplayCards() {
  const toast = useToast();
  const { settings, mutate } = useSettings();
  const cards = settings?.cards;
  const [busy, setBusy] = useState(false);

  const items: { key: keyof CardVisibility; label: string }[] = [
    { key: "nowPlaying", label: "Now Playing" },
    { key: "presets", label: "Presets" },
    { key: "eq", label: "Equalizer" },
    { key: "source", label: "Source" },
    { key: "output", label: "Output" },
    { key: "sub", label: "Sub-out" },
    { key: "temperature", label: "Temperature" },
    { key: "device", label: "Device info" },
  ];

  async function toggle(key: keyof CardVisibility, value: boolean) {
    setBusy(true);
    try {
      await apiSend("/api/settings", "PATCH", { cards: { [key]: value } });
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not save", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader icon={<LayoutGrid className="size-4" />} title="Dashboard cards" className="px-0 pt-0" />
      <p className="mt-2 text-sm text-muted-foreground">Choose which cards appear on the dashboard.</p>
      <div className="mt-3 divide-y divide-border/60">
        {items.map((it) => (
          <div key={it.key} className="flex items-center justify-between py-2.5">
            <span className="text-sm">{it.label}</span>
            <Switch
              checked={cards ? cards[it.key] : true}
              onChange={(v) => void toggle(it.key, v)}
              disabled={busy || !cards}
              aria-label={it.label}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast("New passwords do not match", "error");
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/auth/password", "POST", { currentPassword: cur, newPassword: next });
      toast("Password changed", "success");
      setCur("");
      setNext("");
      setConfirm("");
    } catch (e) {
      toast((e as ApiError).message || "Could not change password", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader icon={<KeyRound className="size-4" />} title="Password" className="px-0 pt-0" />
      <form onSubmit={submit} className="mt-4 space-y-3">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 10 characters with upper/lower case and a number.">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner /> : <Save className="size-5" />} Update password
        </Button>
      </form>
    </Card>
  );
}

function TwoFactor({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin() {
    setBusy(true);
    try {
      const res = await apiSend<{ qr: string; secret: string }>("/api/auth/totp/setup", "POST");
      setSetup({ qr: res.qr, secret: res.secret });
    } catch (e) {
      toast((e as ApiError).message || "Could not start 2FA setup", "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await apiSend("/api/auth/totp/enable", "POST", { token: code });
      toast("Two-factor authentication enabled", "success");
      setIsEnabled(true);
      setSetup(null);
      setCode("");
    } catch (e) {
      toast((e as ApiError).message || "Invalid code", "error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await apiSend("/api/auth/totp/disable", "POST", { password: pwd });
      toast("Two-factor authentication disabled", "success");
      setIsEnabled(false);
      setPwd("");
    } catch (e) {
      toast((e as ApiError).message || "Could not disable 2FA", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader icon={<ShieldCheck className="size-4" />} title="Two-factor (TOTP)" className="px-0 pt-0" />

      {isEnabled ? (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 text-sm text-success">
            <ShieldCheck className="size-4" /> 2FA is active on your account.
          </p>
          <Field label="Enter password to disable">
            <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
          </Field>
          <Button variant="destructive" onClick={() => void disable()} disabled={busy || !pwd}>
            {busy ? <Spinner /> : <ShieldOff className="size-5" />} Disable 2FA
          </Button>
        </div>
      ) : setup ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Scan this with your authenticator app, then enter the 6-digit code.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="TOTP QR code" className="rounded-2xl bg-white p-2" width={180} height={180} />
          <p className="break-all rounded-xl bg-white/5 p-2 text-center font-mono text-xs text-muted-foreground">
            {setup.secret}
          </p>
          <Field label="Verification code">
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => void confirm()} disabled={busy || code.length < 6}>
              {busy ? <Spinner /> : <ShieldCheck className="size-5" />} Verify & enable
            </Button>
            <Button variant="ghost" onClick={() => setSetup(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Add a second factor for extra protection when signing in.
          </p>
          <Button variant="secondary" onClick={() => void begin()} disabled={busy}>
            {busy ? <Spinner /> : <QrCode className="size-5" />} Set up 2FA
          </Button>
        </div>
      )}
    </Card>
  );
}

function TurnstileSettings() {
  const toast = useToast();
  const { settings, mutate } = useSettings();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [secretKey, setSecretKey] = useState("");
  const [busy, setBusy] = useState(false);

  const eff = enabled ?? settings?.turnstile.enabled ?? false;
  const sk = siteKey ?? settings?.turnstile.siteKey ?? "";
  const hasSecret = settings?.turnstile.hasSecret ?? false;

  async function save() {
    setBusy(true);
    try {
      await apiSend("/api/settings", "PATCH", {
        turnstile: {
          enabled: eff,
          siteKey: sk,
          secretKey: secretKey.length > 0 ? secretKey : undefined,
        },
      });
      toast("Turnstile settings saved", "success");
      setSecretKey("");
      setEnabled(null);
      setSiteKey(null);
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not save settings", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader
        icon={<Bot className="size-4" />}
        title="Cloudflare Turnstile"
        className="px-0 pt-0"
        action={<Switch checked={eff} onChange={setEnabled} aria-label="Enable Turnstile" />}
      />
      <div className="mt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Bot protection on the login form. Create a widget at Cloudflare → Turnstile and paste the
          keys below.
        </p>
        <Field label="Site key">
          <Input value={sk} onChange={(e) => setSiteKey(e.target.value)} placeholder="0x4AAAAAAA..." />
        </Field>
        <Field label="Secret key" hint={hasSecret ? "A secret is already saved — leave blank to keep it." : undefined}>
          <Input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder={hasSecret ? "•••••••• (unchanged)" : "0x4AAAAAAA..."}
          />
        </Field>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner /> : <Save className="size-5" />} Save
        </Button>
      </div>
    </Card>
  );
}

/**
 * Trusted artwork hosts. Cover art served by a local media server (JRiver,
 * Plex, Roon…) lives on that machine, not on the WiiM — and the server refuses
 * LAN artwork from anywhere but the device itself, because fetching arbitrary
 * internal URLs on request is how SSRF happens. This is the opt-in exception,
 * one `host:port` at a time. Validation lives in the API route.
 */
function ArtworkHosts() {
  const toast = useToast();
  const { settings, mutate } = useSettings();
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const hosts = settings?.artHosts ?? [];

  async function save(next: string[], okMessage: string) {
    setBusy(true);
    try {
      await apiSend("/api/settings", "PATCH", { artHosts: next });
      await mutate();
      setEntry("");
      toast(okMessage, "success");
    } catch (e) {
      toast((e as ApiError).message || "Could not save", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader
        icon={<ImageIcon className="size-4" />}
        title="Artwork hosts"
        className="px-0 pt-0"
      />
      <div className="mt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Album art from a media server on your network (JRiver, Plex, Roon…) is not fetched unless
          you name the server here — the dashboard only trusts artwork from the WiiM device itself.
          Add the exact <span className="font-medium text-foreground">host:port</span> its art URLs
          use; if a cover stays blank, the container log names the host it refused.
        </p>
        {hosts.length > 0 && (
          <ul className="space-y-2">
            {hosts.map((h) => (
              <li
                key={h}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-2"
              >
                <span className="truncate text-sm text-foreground">{h}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(hosts.filter((x) => x !== h), `Removed ${h}`)}
                  aria-label={`Remove ${h}`}
                  title={`Remove ${h}`}
                  className="rounded-lg p-1 text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field
          label="Add a host"
          hint="LAN addresses only — loopback, link-local and cloud-metadata addresses are rejected."
        >
          <Input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder="192.168.1.5:52199"
          />
        </Field>
        <Button
          onClick={() => void save([...hosts, entry], `Trusting artwork from ${entry.trim()}`)}
          disabled={busy || !entry.trim()}
        >
          {busy ? <Spinner /> : <Plus className="size-5" />} Add host
        </Button>
      </div>
    </Card>
  );
}

function GeneralSettings() {
  const toast = useToast();
  const { settings, mutate } = useSettings();
  const [busy, setBusy] = useState(false);
  const current = settings?.app.pollIntervalMs ?? 3000;

  const options = [
    { label: "1 second", value: 1000 },
    { label: "2 seconds", value: 2000 },
    { label: "3 seconds", value: 3000 },
    { label: "5 seconds", value: 5000 },
    { label: "10 seconds", value: 10000 },
  ];

  async function set(value: number) {
    setBusy(true);
    try {
      await apiSend("/api/settings", "PATCH", { app: { pollIntervalMs: value } });
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not save", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader icon={<Gauge className="size-4" />} title="Refresh rate" className="px-0 pt-0" />
      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            disabled={busy}
            onClick={() => void set(o.value)}
            className={
              "rounded-xl border px-3 py-2 text-sm font-medium transition " +
              (current === o.value
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-white/5")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
