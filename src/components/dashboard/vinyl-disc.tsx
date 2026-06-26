"use client";

import { useEffect, useRef } from "react";
import { extractColor, type RGB } from "@/lib/client/use-album-color";

/**
 * A spinning vinyl record for the Now Playing "vinyl" view and the kiosk
 * display. The record itself is a public-domain (CC0) illustration
 * (`/vinyl-record.svg`, BenBois via OpenClipart); the album art (when present)
 * is composited as the centre label and rotates while playing, while physical
 * inputs like Phono show a plain cream label. Rotation is rAF-driven with eased
 * spin-up / spin-down (like a real turntable). Pass `sizeClass` to scale it.
 */
export function VinylDisc({
  artSrc,
  spinning,
  rgb,
  onColor,
  sizeClass = "size-44 sm:size-52",
}: {
  artSrc: string | null;
  spinning: boolean;
  rgb: string | null;
  onColor: (c: RGB | null) => void;
  sizeClass?: string;
}) {
  const discRef = useRef<HTMLDivElement | null>(null);
  const angle = useRef(0);
  const vel = useRef(0); // degrees per ms
  const rafId = useRef<number | null>(null);
  const lastT = useRef(0);
  const spinningRef = useRef(spinning);
  spinningRef.current = spinning;

  useEffect(() => {
    const MAX = 0.09; // deg/ms ≈ one revolution / 4s
    const TAU = 650; // ms — exponential ease for spin-up / spin-down
    const reduce =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const tick = (t: number) => {
      const dt = lastT.current ? Math.min(80, t - lastT.current) : 16;
      lastT.current = t;
      const target = spinningRef.current && !reduce ? MAX : 0;
      vel.current = target + (vel.current - target) * Math.exp(-dt / TAU);
      if (target > 0 && vel.current < MAX * 0.02) vel.current = MAX * 0.08; // kick off
      angle.current = (angle.current + vel.current * dt) % 360;
      const el = discRef.current;
      if (el) el.style.transform = `rotate(${angle.current}deg)`;
      if (target === 0 && vel.current < 0.0008) {
        rafId.current = null;
        lastT.current = 0;
        return; // fully stopped — idle until the next play/pause
      }
      rafId.current = requestAnimationFrame(tick);
    };

    if (rafId.current === null) {
      lastT.current = 0;
      rafId.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [spinning]);

  return (
    <div className={`relative ${sizeClass}`}>
      {/* Coloured glow (kept off the spinning layer so it doesn't orbit) */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: rgb
            ? `0 14px 60px -12px rgba(${rgb}, 0.5)`
            : "0 14px 45px -16px rgba(0,0,0,0.7)",
        }}
      />

      {/* The record (CC0 asset) — rotation applied via rAF */}
      <div
        ref={discRef}
        className="absolute inset-0 will-change-transform"
        style={{
          backgroundImage: "url('/vinyl-record.svg')",
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Centre label — album art, or a cream label for physical inputs */}
        <div
          className="absolute left-1/2 top-1/2 size-[35%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full"
          style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.35)" }}
        >
          {artSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artSrc}
              alt=""
              draggable={false}
              className="size-full object-cover"
              onLoad={(e) => onColor(extractColor(e.currentTarget))}
            />
          ) : (
            <div
              className="size-full"
              style={{
                background:
                  "radial-gradient(circle at 50% 40%, #ece0c4 0%, #d3c197 72%, #bfa97f 100%)",
              }}
            />
          )}
        </div>

        {/* Spindle hole — dead centre, on top of the label */}
        <div className="absolute left-1/2 top-1/2 size-[3%] min-h-[5px] min-w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#08080a]" />
      </div>

      {/* Static reflection sheen (a real reflection doesn't spin) */}
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(130% 100% at 28% 18%, rgba(255,255,255,0.10), transparent 46%)",
        }}
      />

      {/* Tonearm — overlaid, does not spin. Arm runs through the pivot and
          headshell centres; positions picked to rest on the outer grooves. */}
      <svg
        viewBox="0 0 220 220"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <filter id="tonearm-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>
        {/* soft drop shadow */}
        <g opacity="0.28" filter="url(#tonearm-shadow)" transform="translate(2.5,3.5)">
          <rect x="124.02" y="78.7" width="123.97" height="4.6" rx="2.3" fill="#000" transform="rotate(107.9 186 81)" />
          <rect x="159" y="133" width="16" height="14" rx="2.5" fill="#000" transform="rotate(107.9 167 140)" />
        </g>
        {/* arm tube (centre line: pivot 205,22 → headshell 167,140) */}
        <rect x="124.02" y="78.7" width="123.97" height="4.6" rx="2.3" fill="#9a9aa1" transform="rotate(107.9 186 81)" />
        {/* headshell, centred on the arm end */}
        <g transform="rotate(107.9 167 140)">
          <rect x="159" y="133" width="16" height="14" rx="2.5" fill="#3a3a40" />
          <rect x="159" y="133" width="16" height="3.5" rx="1.5" fill="#c9c9d0" opacity="0.45" />
        </g>
        {/* stylus contact */}
        <circle cx="164.24" cy="148.57" r="1.9" fill="#0c0c10" />
        {/* counterweight behind the pivot */}
        <g transform="rotate(107.9 209.9 6.77)">
          <rect x="204.4" y="0.77" width="11" height="12" rx="3" fill="#8d8d95" />
          <rect x="204.4" y="0.77" width="11" height="4" rx="2" fill="#bdbdc4" />
        </g>
        {/* pivot bearing (bigger), centred on the arm base */}
        <circle cx="205" cy="22" r="11" fill="#2c2c31" />
        <circle cx="201.15" cy="18.15" r="3.3" fill="#dadae0" opacity="0.85" />
        <circle cx="209.4" cy="26.95" r="1.6" fill="#6a6a72" />
      </svg>
    </div>
  );
}
