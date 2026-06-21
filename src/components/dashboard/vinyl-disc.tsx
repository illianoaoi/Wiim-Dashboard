"use client";

import { useEffect, useRef } from "react";
import { Disc3 } from "lucide-react";
import { extractColor, type RGB } from "@/lib/client/use-album-color";

/**
 * A spinning vinyl record for the Now Playing "vinyl" view. The album art (when
 * available) is the centre label and rotates while playing; physical inputs like
 * Phono show a generic record. Rotation is driven by rAF with eased spin-up /
 * spin-down (like a real turntable) and follows the extracted album colour.
 */
export function VinylDisc({
  artSrc,
  spinning,
  rgb,
  onColor,
}: {
  artSrc: string | null;
  spinning: boolean;
  rgb: string | null;
  onColor: (c: RGB | null) => void;
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
    <div className="relative size-44 sm:size-52">
      {/* Static coloured glow (kept off the spinning layer so it doesn't orbit) */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: rgb
            ? `0 12px 55px -12px rgba(${rgb}, 0.5)`
            : "0 12px 40px -14px rgba(0,0,0,0.6)",
        }}
      />

      {/* The record — rotation applied via rAF */}
      <div
        ref={discRef}
        className="absolute inset-0 rounded-full will-change-transform"
        style={{
          background: "repeating-radial-gradient(circle at 50% 50%, #20202a 0 1px, #101015 1px 4px)",
        }}
      >
        <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/10" />

        {/* Centre label */}
        <div
          className="absolute left-1/2 top-1/2 size-[42%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2"
          style={{ borderColor: rgb ? `rgba(${rgb}, 0.65)` : "rgba(255,255,255,0.15)" }}
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
            <div className="grid size-full place-items-center bg-white/5 text-muted-foreground/55">
              <Disc3 className="size-7" />
            </div>
          )}
          {/* Spindle hole */}
          <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background ring-1 ring-black/50" />
        </div>
      </div>

      {/* Tonearm — overlaid, does not spin */}
      <svg
        viewBox="0 0 220 220"
        className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground/50"
        aria-hidden="true"
      >
        {/* Arm — pivots from the top-right corner down to the outer grooves */}
        <line x1="211" y1="11" x2="166" y2="158" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        {/* Counterweight behind the pivot */}
        <circle cx="215" cy="-3" r="7" fill="currentColor" />
        {/* Pivot bearing */}
        <circle cx="211" cy="11" r="10" fill="currentColor" />
        {/* Headshell + stylus resting on the grooves */}
        <rect x="157" y="153" width="18" height="10" rx="2" fill="currentColor" transform="rotate(107 166 158)" />
        <circle cx="166" cy="158" r="3" fill="currentColor" />
      </svg>
    </div>
  );
}
