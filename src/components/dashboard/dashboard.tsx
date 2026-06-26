"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import {
  useDevices,
  useSettings,
  useSnapshot,
  type DeviceListItem,
  type CardVisibility,
} from "@/lib/client/hooks";
import { AppHeader } from "./app-header";
import { EmptyState } from "./empty-state";
import { NowPlayingCard } from "./now-playing-card";
import { SourceCard } from "./source-card";
import { OutputCard } from "./output-card";
import { EqCard } from "./eq-card";
import { SubCard } from "./sub-card";
import { TempCard } from "./temp-card";
import { PresetCard } from "./preset-card";
import { DeviceInfoCard } from "./device-info-card";
import { LastfmStatsCard } from "./lastfm-stats-card";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AppFooter } from "@/components/app-footer";
import { SOURCES } from "@/lib/wiim/constants";

const STORAGE_KEY = "wiim:selectedDevice";

export function Dashboard({ initialDevices }: { initialDevices: DeviceListItem[] }) {
  const { devices } = useDevices(initialDevices);
  const { settings } = useSettings();
  const interval = settings?.app.pollIntervalMs ?? 3000;

  const [selectedId, setSelectedId] = useState<string | null>(initialDevices[0]?.id ?? null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved && initialDevices.some((d) => d.id === saved)) setSelectedId(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (devices.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !devices.some((d) => d.id === selectedId)) {
      setSelectedId(devices[0]!.id);
    }
  }, [devices, selectedId]);

  function select(id: string) {
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }

  const { snapshot, mutate, isLoading } = useSnapshot(selectedId, interval);
  const refresh = () => void mutate();

  // Reflect the selected device's current track in the browser tab title:
  // "<Track> - <Artist> | Wiim Dashboard", falling back to the app name.
  const titlePlayer = snapshot?.id === selectedId ? snapshot?.player : null;
  useEffect(() => {
    const base = "Wiim Dashboard";
    const t = titlePlayer?.title?.trim();
    const a = titlePlayer?.artist?.trim();
    document.title =
      t && titlePlayer?.state !== "stopped"
        ? a
          ? `${t} - ${a} | ${base}`
          : `${t} | ${base}`
        : base;
  }, [titlePlayer?.title, titlePlayer?.artist, titlePlayer?.state]);

  if (devices.length === 0) {
    return (
      <>
        <AppHeader devices={[]} selectedId={null} onSelect={() => {}} online={false} />
        <EmptyState />
        <AppFooter />
      </>
    );
  }

  const selectedDevice = devices.find((d) => d.id === selectedId) ?? null;
  const matches = snapshot?.id === selectedId;
  const snap = matches ? snapshot : null;
  const caps = snap?.capabilities ?? selectedDevice?.capabilities ?? null;
  const player = snap?.player ?? null;
  const online = snap ? snap.online : true;
  const did = selectedId!;
  const eqSource =
    player?.sourceKey === "wifi"
      ? snap?.info?.network ?? "wifi"
      : player?.sourceKey
        ? SOURCES.find((s) => s.key === player.sourceKey)?.value ?? null
        : null;
  // Card visibility (Settings). Defaults to visible while settings load.
  const vis = (k: keyof CardVisibility) => settings?.cards?.[k] ?? true;

  return (
    <>
      <AppHeader devices={devices} selectedId={selectedId} onSelect={select} online={online} />
      <main className="mx-auto max-w-5xl px-4 py-5">
        {!snap && isLoading && (
          <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
            <Spinner className="size-7 text-primary" />
          </div>
        )}

        {snap && !online && (
          <Card className="flex items-center gap-3 p-5 text-sm">
            <WifiOff className="size-5 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Device offline</p>
              <p className="text-muted-foreground">
                Can&apos;t reach {selectedDevice?.name} at {selectedDevice?.host}. Retrying…
              </p>
            </div>
          </Card>
        )}

        {snap && online && (
          <div className="animate-fade-in space-y-4">
            {vis("nowPlaying") && player && (
              <NowPlayingCard
                deviceId={did}
                player={player}
                sourceLabels={selectedDevice?.sourceLabels}
                autoSourceLabels={snap.sourceNames}
                canLove={!!settings?.lastfm?.connected}
                sleepExpiresAt={snap.sleepExpiresAt}
                onChanged={refresh}
              />
            )}

            {vis("presets") && snap.presets && snap.presets.length > 0 && (
              <PresetCard deviceId={did} presets={snap.presets} onChanged={refresh} />
            )}

            {/* Full per-source Graphic + Parametric EQ (self-hides if unsupported) */}
            {vis("eq") && <EqCard deviceId={did} initialSource={eqSource} />}

            {settings?.lastfm?.connected && <LastfmStatsCard />}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {vis("source") && player && caps?.sources && caps.sources.length > 0 && (
                <SourceCard
                  deviceId={did}
                  sourceKeys={caps.sources}
                  currentKey={player.sourceKey}
                  sourceLabels={selectedDevice?.sourceLabels}
                  autoSourceLabels={snap.sourceNames}
                  disabledSources={snap.disabledSources}
                  onChanged={refresh}
                />
              )}
              {vis("output") && caps?.outputSwitch && snap.output && (
                <OutputCard
                  deviceId={did}
                  outputIds={caps.outputs}
                  current={snap.output.hardware}
                  onChanged={refresh}
                />
              )}
              {vis("sub") && caps?.subwoofer && snap.sub && (
                <SubCard deviceId={did} sub={snap.sub} onChanged={refresh} />
              )}
              {vis("temperature") && caps?.temperature && snap.info && (
                <TempCard cpu={snap.info.temperatureCpu} board={snap.info.temperatureBoard} />
              )}
              {vis("device") && snap.info && <DeviceInfoCard info={snap.info} usbDac={snap.usbDac} />}
            </div>
          </div>
        )}
      </main>
      <AppFooter />
    </>
  );
}
