"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Repeat,
  Repeat1,
  Shuffle,
  Music4,
  Heart,
  FileAudio,
  Gem,
  Disc3,
  Image as ImageIcon,
  Maximize2,
  Mic2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { StepperSlider } from "@/components/ui/stepper-slider";
import { useToast } from "@/components/toast";
import { apiSend, apiGet, ApiError } from "@/lib/client/api";
import { formatTime, cn } from "@/lib/utils";
import { SOURCES } from "@/lib/wiim/constants";
import { DynIcon } from "@/components/ui/icon";
import { ServiceLogo } from "@/components/ui/service-logo";
import { VinylDisc } from "./vinyl-disc";
import { QualityPill } from "./quality-pill";
import { KioskView } from "./kiosk-view";
import { LyricsView } from "./lyrics-view";
import { extractColor, type RGB } from "@/lib/client/use-album-color";
import type { PlayerStatus, StreamService, AudioFormat, LyricLine } from "@/lib/wiim/types";

export function NowPlayingCard({
  deviceId,
  player,
  sourceLabels,
  autoSourceLabels,
  canLove,
  onChanged,
}: {
  deviceId: string;
  player: PlayerStatus;
  sourceLabels?: Record<string, string>;
  autoSourceLabels?: Record<string, string>;
  canLove?: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(player.position);
  const [vol, setVol] = useState(player.volume);
  const [draggingVol, setDraggingVol] = useState(false);
  const [draggingSeek, setDraggingSeek] = useState(false);
  // Local repeat/shuffle so the buttons update instantly (optimistic); the
  // device reading is asymmetric and lags the poll otherwise.
  const [repeat, setRepeat] = useState(player.repeat);
  const [shuffle, setShuffle] = useState(player.shuffle);
  const loopFreezeUntil = useRef(0);
  const [loved, setLoved] = useState(false);
  const lovedReqRef = useRef("");
  const [kiosk, setKiosk] = useState(false);
  const [kioskView, setKioskView] = useState<"vinyl" | "lyrics">("vinyl");
  const [lyrics, setLyrics] = useState<{ synced: LyricLine[] | null; plain: string | null } | null>(
    null,
  );
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const isPlaying = player.state === "playing";
  const srcDef = player.sourceKey ? SOURCES.find((s) => s.key === player.sourceKey) : undefined;
  const sourceDisplay =
    (player.sourceKey &&
      (sourceLabels?.[player.sourceKey]?.trim() ||
        autoSourceLabels?.[player.sourceKey]?.trim())) ||
    player.sourceLabel;
  // Physical inputs (Optical, Line-in, Coax, HDMI, Phono…) don't carry cover
  // art — show the source icon instead of a stale/blank image. Only
  // network/streaming sources display album art.
  const isPhysicalInput = !!player.sourceKey && player.sourceKey !== "wifi";
  const showArt = !!player.albumArt && !isPhysicalInput;
  // Stream-info block (service / format) — only network & Bluetooth have spare
  // vertical space beneath the cover for it.
  const showStreamInfo = player.sourceKey === "wifi" || player.sourceKey === "bluetooth";
  // Tint the card + glow the cover with the album art's dominant colour,
  // extracted from the displayed <img> on load (reliable — no separate load).
  const [albumColor, setAlbumColor] = useState<RGB | null>(null);
  const rgb = albumColor ? `${albumColor[0]}, ${albumColor[1]}, ${albumColor[2]}` : null;
  // Clear the tint when there's no cover (physical inputs / Bluetooth).
  useEffect(() => {
    if (!showArt) setAlbumColor(null);
  }, [showArt]);

  // Now Playing artwork view: cover ↔ vinyl. A real turntable (Phono) defaults
  // to the vinyl view; the choice is remembered across sessions.
  const isPhono = player.sourceKey === "phono";
  const canVinyl = showArt || isPhono;
  const canLyrics = !!(player.title && player.artist);
  const [viewPref, setViewPref] = useState<"cover" | "vinyl" | "lyrics" | null>(null);
  useEffect(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem("wiim:npView") : null;
    if (v === "cover" || v === "vinyl" || v === "lyrics") setViewPref(v);
  }, []);
  const viewRaw: "cover" | "vinyl" | "lyrics" = viewPref ?? (isPhono ? "vinyl" : "cover");
  const view: "cover" | "vinyl" | "lyrics" =
    viewRaw === "lyrics" && !canLyrics
      ? "cover"
      : viewRaw === "vinyl" && !canVinyl
        ? "cover"
        : viewRaw;
  function setView(v: "cover" | "vinyl" | "lyrics") {
    setViewPref(v);
    try {
      localStorage.setItem("wiim:npView", v);
    } catch {
      /* ignore */
    }
  }

  // Reset interpolated position on track / status change.
  useEffect(() => {
    if (!draggingSeek) setPos(player.position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.position, player.title, player.state]);

  // Sync volume from device unless the user is dragging it.
  useEffect(() => {
    if (!draggingVol) setVol(player.volume);
  }, [player.volume, draggingVol]);

  // Sync repeat/shuffle from device, but briefly freeze right after a tap so the
  // optimistic value isn't overwritten by a poll that fires before the device
  // reflects the change.
  useEffect(() => {
    if (Date.now() >= loopFreezeUntil.current) {
      setRepeat(player.repeat);
      setShuffle(player.shuffle);
    }
  }, [player.repeat, player.shuffle]);

  // Reflect the track's Last.fm "loved" status when it changes.
  useEffect(() => {
    setLoved(false);
    if (!canLove || !player.title || !player.artist) return;
    const key = `${player.artist} ${player.title}`;
    lovedReqRef.current = key;
    apiGet<{ loved: boolean }>(
      `/api/lastfm/love?artist=${encodeURIComponent(player.artist)}&track=${encodeURIComponent(player.title)}`,
    )
      .then((r) => {
        if (lovedReqRef.current === key) setLoved(!!r.loved);
      })
      .catch(() => {
        /* leave as not-loved */
      });
  }, [player.title, player.artist, canLove]);

  // Fetch lyrics (LRCLIB) when the lyrics view is open (card or kiosk); per track.
  const lyricsWanted =
    (view === "lyrics" || (kiosk && kioskView === "lyrics")) && !!player.title && !!player.artist;
  useEffect(() => {
    if (!lyricsWanted) return;
    const artist = player.artist;
    const title = player.title;
    if (!artist || !title) return;
    let cancelled = false;
    setLyricsLoading(true);
    setLyrics(null);
    apiGet<{ synced: LyricLine[] | null; plain: string | null }>(
      `/api/lyrics?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&album=${encodeURIComponent(player.album ?? "")}&duration=${player.duration || 0}`,
    )
      .then((r) => {
        if (!cancelled) {
          setLyrics(r);
          setLyricsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLyrics({ synced: null, plain: null });
          setLyricsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lyricsWanted, player.title, player.artist, player.album, player.duration]);

  // Tick position forward while playing.
  useEffect(() => {
    if (!isPlaying || draggingSeek) return;
    const t = setInterval(
      () => setPos((p) => (player.duration ? Math.min(player.duration, p + 1) : p + 1)),
      1000,
    );
    return () => clearInterval(t);
  }, [isPlaying, draggingSeek, player.duration]);

  async function send(body: Record<string, unknown>, optimistic?: () => void) {
    optimistic?.();
    setBusy(true);
    try {
      await apiSend(`/api/devices/${deviceId}/control`, "POST", body);
      onChanged();
    } catch (e) {
      toast((e as ApiError).message || "Command failed", "error");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const hasDuration = player.duration > 0;
  const VolIcon = player.muted || vol === 0 ? VolumeX : vol < 50 ? Volume1 : Volume2;

  function cycleRepeat() {
    const next = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
    setRepeat(next);
    loopFreezeUntil.current = Date.now() + 2500;
    void send({ action: "repeat", repeat: next, shuffle });
  }

  function toggleShuffle() {
    const next = !shuffle;
    setShuffle(next);
    loopFreezeUntil.current = Date.now() + 2500;
    void send({ action: "shuffle", repeat, shuffle: next });
  }

  async function toggleLove() {
    if (!player.title || !player.artist) return;
    const next = !loved;
    setLoved(next); // optimistic
    try {
      await apiSend("/api/lastfm/love", "POST", {
        artist: player.artist,
        track: player.title,
        love: next,
      });
    } catch (e) {
      setLoved(!next);
      toast((e as ApiError).message || "Last.fm action failed", "error");
    }
  }

  function enterKiosk() {
    setKioskView(view === "lyrics" ? "lyrics" : "vinyl");
    setKiosk(true);
    // Best-effort true fullscreen (desktop); the fixed overlay covers the rest.
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
  function exitKiosk() {
    setKiosk(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  return (
    <>
      <Card className="relative overflow-hidden p-5 sm:p-6">
      {/* Default tint so the dark artwork / vinyl never blends into the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 140% at 12% -10%, rgba(124,92,252,0.12), transparent 55%)",
        }}
      />
      {/* Album-art colour wash — crossfades on track change. */}
      <AnimatePresence>
        {rgb && (
          <motion.div
            key={rgb}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(120% 140% at 10% -15%, rgba(${rgb}, 0.55), transparent 55%), linear-gradient(110deg, rgba(${rgb}, 0.24) 0%, rgba(${rgb}, 0.06) 45%, transparent 70%)`,
            }}
          />
        )}
      </AnimatePresence>

      <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:gap-6">
        {/* Left column — artwork (cover or vinyl) + the view toggle */}
        <div className="flex shrink-0 flex-col items-center gap-3 sm:items-start">
          {view === "lyrics" && canLyrics ? (
            <LyricsView
              lines={lyrics?.synced ?? null}
              plain={lyrics?.plain ?? null}
              position={pos}
              loading={lyricsLoading}
              onSeek={(t) => {
                const v = Math.round(t);
                setPos(v);
                if (hasDuration) void send({ action: "seek", value: v });
              }}
            />
          ) : canVinyl && view === "vinyl" ? (
            <VinylDisc
              artSrc={showArt ? player.albumArt : null}
              spinning={isPlaying}
              rgb={rgb}
              onColor={setAlbumColor}
            />
          ) : (
            <div
              className="relative size-44 overflow-hidden rounded-2xl bg-white/5 shadow-xl sm:size-52"
              style={rgb ? { boxShadow: `0 10px 60px -8px rgba(${rgb}, 0.6)` } : undefined}
            >
              <AnimatePresence mode="wait">
                {showArt ? (
                  <motion.div
                    key={player.albumArt ?? "art"}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={player.albumArt ?? undefined}
                      alt=""
                      className="size-full object-cover"
                      draggable={false}
                      onLoad={(e) => setAlbumColor(extractColor(e.currentTarget))}
                    />
                  </motion.div>
                ) : (
                  // No cover art (physical input / radio) → show the source itself.
                  <div className="grid size-full place-items-center bg-gradient-to-br from-white/[0.07] to-transparent">
                    <div className="flex flex-col items-center gap-2 px-3 text-center text-muted-foreground/55">
                      {srcDef ? (
                        <DynIcon name={srcDef.icon} className="size-14" />
                      ) : (
                        <Music4 className="size-14" />
                      )}
                      <span className="text-[11px] font-medium uppercase tracking-wide">
                        {sourceDisplay}
                      </span>
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className="flex items-center gap-1 self-center rounded-full bg-white/8 p-1">
            {canVinyl && (
              <>
                <button
                  type="button"
                  onClick={() => setView("cover")}
                  aria-label="Cover view"
                  aria-pressed={view === "cover"}
                  className={cn(
                    "focus-ring grid size-7 place-items-center rounded-full transition",
                    view === "cover" ? "bg-white/15 text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <ImageIcon className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setView("vinyl")}
                  aria-label="Vinyl view"
                  aria-pressed={view === "vinyl"}
                  className={cn(
                    "focus-ring grid size-7 place-items-center rounded-full transition",
                    view === "vinyl" ? "bg-white/15 text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Disc3 className="size-4" />
                </button>
              </>
            )}
            {canLyrics && (
              <button
                type="button"
                onClick={() => setView("lyrics")}
                aria-label="Lyrics view"
                aria-pressed={view === "lyrics"}
                className={cn(
                  "focus-ring grid size-7 place-items-center rounded-full transition",
                  view === "lyrics" ? "bg-white/15 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Mic2 className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={enterKiosk}
              aria-label="Fullscreen"
              title="Fullscreen"
              className="focus-ring grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-white/15 hover:text-foreground"
            >
              <Maximize2 className="size-4" />
            </button>
          </div>
        </div>

        {/* Meta + transport */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {srcDef ? (
                <DynIcon name={srcDef.icon} className="size-3.5" />
              ) : (
                <Music4 className="size-3.5" />
              )}
              {sourceDisplay}
            </span>
            <QualityPill quality={player.quality} audio={player.audio} />
          </div>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-xl font-semibold text-foreground">
              {player.title ?? (player.state === "stopped" ? "Nothing playing" : "—")}
            </h2>
            {canLove && player.title && player.artist && (
              <button
                onClick={() => void toggleLove()}
                className={cn(
                  "focus-ring ml-auto grid size-9 shrink-0 place-items-center rounded-full transition",
                  loved ? "text-rose-400" : "text-muted-foreground hover:text-foreground",
                )}
                aria-label={loved ? "Unlove on Last.fm" : "Love on Last.fm"}
                title="Last.fm Love"
              >
                <Heart className={cn("size-5", loved && "fill-current")} />
              </button>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">{player.artist ?? ""}</p>
          {player.album && (
            <p className="truncate text-xs text-muted-foreground/70">{player.album}</p>
          )}

          {/* Progress — only for real tracks. Physical inputs (optical/line-in)
              have no seekable timeline, so the slider is hidden there. */}
          {!isPhysicalInput && (
            <div className="mt-4">
              <Slider
                value={Math.min(pos, player.duration || pos)}
                min={0}
                max={hasDuration ? player.duration : Math.max(pos, 1)}
                onChange={(v) => {
                  setDraggingSeek(true);
                  setPos(v);
                }}
                onCommit={(v) => {
                  setDraggingSeek(false);
                  if (hasDuration) void send({ action: "seek", value: v });
                }}
                disabled={!hasDuration}
                aria-label="Seek"
              />
              <div className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
                <span>{formatTime(pos)}</span>
                <span>{hasDuration ? formatTime(player.duration) : "—"}</span>
              </div>
            </div>
          )}

          {/* Transport buttons */}
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={toggleShuffle}
              className={cn(
                "focus-ring grid size-10 place-items-center rounded-full transition",
                shuffle ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Shuffle"
            >
              <Shuffle className="size-5" />
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void send({ action: "prev" })}
                disabled={busy}
                className="focus-ring grid size-12 place-items-center rounded-full text-foreground transition hover:bg-white/8"
                aria-label="Previous"
              >
                <SkipBack className="size-6 fill-current" />
              </button>
              <button
                onClick={() =>
                  void send({ action: "toggle" })
                }
                disabled={busy}
                style={{ backgroundImage: "linear-gradient(to bottom right, hsl(var(--primary)), hsl(var(--accent)))" }}
                className="focus-ring grid size-16 place-items-center rounded-full text-white shadow-lg shadow-primary/30 transition active:scale-95"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause className="size-7 fill-current" />
                ) : (
                  <Play className="size-7 translate-x-0.5 fill-current" />
                )}
              </button>
              <button
                onClick={() => void send({ action: "next" })}
                disabled={busy}
                className="focus-ring grid size-12 place-items-center rounded-full text-foreground transition hover:bg-white/8"
                aria-label="Next"
              >
                <SkipForward className="size-6 fill-current" />
              </button>
            </div>

            <button
              onClick={cycleRepeat}
              className={cn(
                "focus-ring grid size-10 place-items-center rounded-full transition",
                repeat !== "off" ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat off"}
            >
              {repeat === "one" ? <Repeat1 className="size-5" /> : <Repeat className="size-5" />}
            </button>
          </div>

          {/* Volume */}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void send({ action: player.muted ? "unmute" : "mute" })}
              className="focus-ring grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:text-foreground"
              aria-label={player.muted ? "Unmute" : "Mute"}
            >
              <VolIcon className="size-5" />
            </button>
            <StepperSlider
              value={vol}
              min={0}
              max={100}
              bigStep={1}
              onChange={(v) => {
                setDraggingVol(true);
                setVol(v);
              }}
              onCommit={(v) => {
                setDraggingVol(false);
                void send({ action: "volume", value: v });
              }}
              ariaLabel="Volume"
              className="flex-1"
            />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {player.muted ? "—" : vol}
            </span>
          </div>

          {showStreamInfo && player.service && (
            <StreamInfoLine service={player.service} audio={player.audio} />
          )}
        </div>
      </div>
      </Card>
      {kiosk && (
        <KioskView
          player={player}
          artSrc={showArt ? player.albumArt : null}
          rgb={rgb}
          isPlaying={isPlaying}
          sourceLabel={sourceDisplay}
          vol={vol}
          muted={player.muted}
          onColor={setAlbumColor}
          onSend={(b) => void send(b)}
          onVolume={(v) => {
            setDraggingVol(true);
            setVol(v);
          }}
          onVolumeCommit={(v) => {
            setDraggingVol(false);
            void send({ action: "volume", value: v });
          }}
          view={kioskView}
          onView={setKioskView}
          canLyrics={canLyrics}
          lines={lyrics?.synced ?? null}
          plain={lyrics?.plain ?? null}
          lyricsLoading={lyricsLoading}
          position={pos}
          onSeek={(t) => {
            const v = Math.round(t);
            setPos(v);
            if (hasDuration) void send({ action: "seek", value: v });
          }}
          onExit={exitKiosk}
        />
      )}
    </>
  );
}

/**
 * Single-line stream metadata in the controls column for network / Bluetooth
 * sources: "<logo> Service | FORMAT | TIER" (kept on one row — the stacked
 * version was cramped on mobile).
 */
function StreamInfoLine({ service, audio }: { service: StreamService; audio: AudioFormat | null }) {
  const tier = audio?.tier ?? null;
  const tierLabel =
    tier === "hires"
      ? "Hi-Res Lossless"
      : tier === "lossless"
        ? "Lossless"
        : tier === "lossy"
          ? "Lossy"
          : null;
  // Graded "metal" styling so quality reads at a glance:
  // gold (hi-res, 24-bit) → silver (lossless, 16-bit/CD) → grey (lossy).
  // Gradients are inline (not Tailwind bg-gradient-*) so the gold/silver text
  // renders on iOS/iPad Safari, which doesn't parse Tailwind's gradient vars.
  const tierTextStyle: CSSProperties | undefined =
    tier === "hires"
      ? {
          backgroundImage: "linear-gradient(to right, #fde68a, #fde047, #f59e0b)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }
      : tier === "lossless"
        ? {
            backgroundImage: "linear-gradient(to right, #f1f5f9, #94a3b8)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }
        : undefined;
  const tierTextClass =
    tier === "hires"
      ? "font-bold drop-shadow-[0_0_6px_rgba(251,191,36,0.25)]"
      : tier === "lossless"
        ? "font-semibold"
        : "text-muted-foreground";

  const parts: ReactNode[] = [
    <span key="svc" className="font-medium text-foreground/90">
      {service.name}
      {service.detail && (
        <span className="font-normal text-muted-foreground"> · {service.detail}</span>
      )}
    </span>,
  ];
  if (audio?.codec)
    parts.push(
      <span key="codec" className="inline-flex items-center gap-1">
        <FileAudio className="size-3.5" />
        {audio.codec}
      </span>,
    );
  if (tierLabel)
    parts.push(
      <span key="tier" className="inline-flex items-center gap-1 uppercase tracking-wide">
        {tier === "hires" && <Gem className="size-3.5 shrink-0 text-amber-300" />}
        <span className={tierTextClass} style={tierTextStyle}>
          {tierLabel}
        </span>
      </span>,
    );

  const nodes: ReactNode[] = [];
  parts.forEach((p, i) => {
    if (i > 0)
      nodes.push(
        <span key={`sep-${i}`} className="text-muted-foreground/40">
          |
        </span>,
      );
    nodes.push(p);
  });

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-muted-foreground">
      <ServiceLogo
        logo={service.logo}
        serviceKey={service.key}
        className="size-4 shrink-0 text-foreground/80"
      />
      {nodes}
    </div>
  );
}
