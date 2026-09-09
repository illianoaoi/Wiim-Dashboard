"use client";

import { useState } from "react";
import {
  Plus,
  Radar,
  Trash2,
  RefreshCw,
  Pencil,
  Check,
  X,
  Thermometer,
  Waves,
  SlidersHorizontal,
  Speaker,
  Tags,
  ChevronDown,
} from "lucide-react";
import { SOURCES } from "@/lib/wiim/constants";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/modal";
import { apiSend, ApiError } from "@/lib/client/api";
import { useDevices, type DeviceListItem } from "@/lib/client/hooks";
import type { DeviceCapabilities } from "@/lib/wiim/types";

interface Found {
  host: string;
  name: string;
  model: string;
  firmware: string;
  alreadyAdded: boolean;
}

function CapChips({ caps }: { caps: DeviceCapabilities | null }) {
  if (!caps) return null;
  const chips: { icon: React.ReactNode; label: string }[] = [];
  if (caps.temperature) chips.push({ icon: <Thermometer className="size-3.5" />, label: "Temp" });
  if (caps.subwoofer) chips.push({ icon: <Waves className="size-3.5" />, label: "Sub-out" });
  if (caps.equalizer) chips.push({ icon: <SlidersHorizontal className="size-3.5" />, label: "EQ" });
  if (caps.outputSwitch) chips.push({ icon: <Speaker className="size-3.5" />, label: "Output" });
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {c.icon}
          {c.label}
        </span>
      ))}
      <span className="inline-flex items-center rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-muted-foreground">
        {caps.sources.length} sources
      </span>
    </div>
  );
}

export function DeviceManager({ initialDevices }: { initialDevices: DeviceListItem[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { devices, mutate } = useDevices(initialDevices);

  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [subnet, setSubnet] = useState("192.168.1.0/24");
  const [found, setFound] = useState<Found[] | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editHostId, setEditHostId] = useState<string | null>(null);
  const [editHost, setEditHost] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [labelEditId, setLabelEditId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});

  function toggleLabelEdit(d: DeviceListItem) {
    if (labelEditId === d.id) {
      setLabelEditId(null);
    } else {
      setLabelEditId(d.id);
      setLabelDraft({ ...(d.sourceLabels ?? {}) });
    }
  }

  async function saveLabels(id: string) {
    setBusyId(id);
    try {
      await apiSend(`/api/devices/${id}`, "PATCH", { sourceLabels: labelDraft });
      toast("Source names saved", "success");
      setLabelEditId(null);
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not save names", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function addDevice(h: string, n?: string) {
    setAdding(true);
    try {
      await apiSend("/api/devices", "POST", { host: h.trim(), name: n?.trim() || undefined });
      toast("Device added", "success");
      setHost("");
      setName("");
      setFound((f) => (f ? f.map((x) => (x.host === h ? { ...x, alreadyAdded: true } : x)) : f));
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Could not add device", "error");
    } finally {
      setAdding(false);
    }
  }

  async function scan() {
    setScanning(true);
    setFound(null);
    try {
      const res = await apiSend<{ found: Found[] }>("/api/discover", "POST", { subnet });
      setFound(res.found);
      if (res.found.length === 0) toast("No devices found on that range", "info");
    } catch (e) {
      toast((e as ApiError).message || "Scan failed", "error");
    } finally {
      setScanning(false);
    }
  }

  async function refresh(id: string) {
    setBusyId(id);
    try {
      await apiSend(`/api/devices/${id}/refresh`, "POST");
      toast("Capabilities refreshed", "success");
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Refresh failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string, label: string) {
    const ok = await confirm({
      title: "Remove device",
      message: `Remove “${label}”? This only removes it from the dashboard.`,
      confirmText: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusyId(id);
    try {
      await apiSend(`/api/devices/${id}`, "DELETE");
      toast("Device removed", "success");
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Remove failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Change a device's address. Router DHCP hands WiiM devices a new IP often
   * enough that this is the difference between "the dashboard is broken" and a
   * ten-second fix. The stored capabilities were probed at the OLD address, so
   * re-probe afterwards — best-effort, since the device may still be settling.
   */
  async function saveHost(id: string) {
    const h = editHost.trim();
    if (!h) return;
    setBusyId(id);
    try {
      await apiSend(`/api/devices/${id}`, "PATCH", { host: h });
      setEditHostId(null);
      await apiSend(`/api/devices/${id}/refresh`, "POST").catch(() => {
        /* the address is saved; capabilities refresh on the next Refresh tap */
      });
      await mutate();
      toast(`Address updated to ${h}`, "success");
    } catch (e) {
      toast((e as ApiError).message || "Could not update the address", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function saveName(id: string) {
    const n = editName.trim();
    if (!n) return;
    setBusyId(id);
    try {
      await apiSend(`/api/devices/${id}`, "PATCH", { name: n });
      setEditingId(null);
      await mutate();
    } catch (e) {
      toast((e as ApiError).message || "Rename failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Add by IP */}
      <Card className="p-5">
        <CardHeader icon={<Plus className="size-4" />} title="Add by IP" className="px-0 pt-0" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (host.trim()) void addDevice(host, name);
          }}
          className="mt-4 space-y-3"
        >
          <Field label="Device IP address" hint="e.g. 192.168.1.50 — must be on your local network">
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.50"
              inputMode="decimal"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
          <Field label="Name (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Living Room" />
          </Field>
          <Button type="submit" disabled={adding || !host.trim()} className="w-full">
            {adding ? <Spinner /> : <Plus className="size-5" />}
            {adding ? "Probing device…" : "Add device"}
          </Button>
        </form>
      </Card>

      {/* Discover */}
      <Card className="p-5">
        <CardHeader icon={<Radar className="size-4" />} title="Discover on LAN" className="px-0 pt-0" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void scan();
          }}
          className="mt-4 flex items-end gap-2"
        >
          <div className="flex-1">
            <Field label="Network range">
              <Input
                value={subnet}
                onChange={(e) => setSubnet(e.target.value)}
                placeholder="192.168.1.0/24"
                inputMode="decimal"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={scanning} className="shrink-0">
            {scanning ? <Spinner className="size-4" /> : <Radar className="size-4" />}
            {scanning ? "Scanning…" : "Scan"}
          </Button>
        </form>
        {found && found.length > 0 && (
          <div className="mt-4 space-y-2">
            {found.map((f) => (
              <div
                key={f.host}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white/[0.03] p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{f.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {f.model} · {f.host}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={f.alreadyAdded ? "outline" : "primary"}
                  disabled={f.alreadyAdded || adding}
                  onClick={() => void addDevice(f.host, f.name)}
                >
                  {f.alreadyAdded ? "Added" : "Add"}
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Scans your LAN range with direct probes — works inside Docker. Set the range to match
          your network (e.g. <span className="font-mono">192.168.1.0/24</span>). SSDP multicast is
          also tried when the container uses host networking.
        </p>
      </Card>

      {/* Existing devices */}
      <div>
        <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your devices
        </h2>
        <div className="space-y-2">
          {devices.length === 0 && (
            <p className="px-1 text-sm text-muted-foreground">No devices added yet.</p>
          )}
          {devices.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editingId === d.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-9"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveName(d.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <button
                        onClick={() => void saveName(d.id)}
                        className="grid size-9 place-items-center rounded-xl text-success hover:bg-white/8"
                        aria-label="Save"
                      >
                        <Check className="size-5" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="grid size-9 place-items-center rounded-xl text-muted-foreground hover:bg-white/8"
                        aria-label="Cancel"
                      >
                        <X className="size-5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{d.name}</p>
                      <button
                        onClick={() => {
                          setEditingId(d.id);
                          setEditName(d.name);
                        }}
                        className="text-muted-foreground transition hover:text-foreground"
                        aria-label="Rename"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </div>
                  )}
                  {editHostId === d.id ? (
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        value={editHost}
                        onChange={(e) => setEditHost(e.target.value)}
                        className="h-9"
                        autoFocus
                        placeholder="192.168.1.50"
                        aria-label="Device IP address"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveHost(d.id);
                          if (e.key === "Escape") setEditHostId(null);
                        }}
                      />
                      <button
                        onClick={() => void saveHost(d.id)}
                        className="grid size-9 place-items-center rounded-xl text-success hover:bg-white/8"
                        aria-label="Save address"
                      >
                        <Check className="size-5" />
                      </button>
                      <button
                        onClick={() => setEditHostId(null)}
                        className="grid size-9 place-items-center rounded-xl text-muted-foreground hover:bg-white/8"
                        aria-label="Cancel"
                      >
                        <X className="size-5" />
                      </button>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <span className="truncate">
                        {d.info?.model ?? "WiiM"} · {d.host}
                      </span>
                      <button
                        onClick={() => {
                          setEditHostId(d.id);
                          setEditHost(d.host);
                        }}
                        className="shrink-0 transition hover:text-foreground"
                        aria-label="Change IP address"
                        title="Change IP address"
                      >
                        <Pencil className="size-3" />
                      </button>
                    </p>
                  )}
                  <CapChips caps={d.capabilities} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void refresh(d.id)}
                    disabled={busyId === d.id}
                    className="grid size-9 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
                    aria-label="Refresh capabilities"
                  >
                    {busyId === d.id ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
                  </button>
                  <button
                    onClick={() => void remove(d.id, d.name)}
                    disabled={busyId === d.id}
                    className="grid size-9 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/8 hover:text-destructive"
                    aria-label="Remove device"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              {d.capabilities?.sources && d.capabilities.sources.length > 0 && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <button
                    onClick={() => toggleLabelEdit(d)}
                    className="flex items-center gap-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    <Tags className="size-3.5" /> Custom source names
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        labelEditId === d.id && "rotate-180",
                      )}
                    />
                  </button>

                  {labelEditId === d.id && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        WiiM&apos;s API doesn&apos;t expose the names you set in the WiiM app, so set
                        them here. Leave blank to use the default.
                      </p>
                      {d.capabilities.sources.map((key) => {
                        const def = SOURCES.find((s) => s.key === key);
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                              {def?.label ?? key}
                            </span>
                            <Input
                              value={labelDraft[key] ?? ""}
                              placeholder={def?.label ?? key}
                              maxLength={32}
                              className="h-9"
                              onChange={(e) =>
                                setLabelDraft((d2) => ({ ...d2, [key]: e.target.value }))
                              }
                            />
                          </div>
                        );
                      })}
                      <Button size="sm" onClick={() => void saveLabels(d.id)} disabled={busyId === d.id}>
                        {busyId === d.id ? <Spinner className="size-4" /> : <Check className="size-4" />}
                        Save names
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
