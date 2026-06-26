import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { AudioFormat } from "@/lib/wiim/types";

/**
 * Quality chip next to the source, colour-graded by tier so quality reads at a
 * glance: gold = Hi-Res, silver = Lossless, grey = Lossy. Renders as a single
 * pill — "9216 kbps | 24-bit/192 kHz" — built from the structured audio numbers
 * when available, otherwise the raw quality string.
 */
export function QualityPill({
  quality,
  audio,
  className,
}: {
  quality: string | null;
  audio?: AudioFormat | null;
  className?: string;
}) {
  let label = (quality ?? "").trim();
  if (audio && (audio.bitRate || audio.bitDepth || audio.sampleRate)) {
    const left = audio.bitRate ? `${audio.bitRate} kbps` : null;
    const depth = audio.bitDepth ? `${audio.bitDepth}-bit` : null;
    const rate = audio.sampleRate
      ? `${(audio.sampleRate / 1000).toFixed(1).replace(/\.0$/, "")} kHz`
      : null;
    const right = [depth, rate].filter(Boolean).join("/");
    label = [left, right].filter(Boolean).join(" | ");
  }
  if (!label) return null;

  const tier = audio?.tier ?? null;
  // Graded "metal" pill: gold (hi-res) → silver (lossless) → neutral (lossy).
  // Inline gradients (not Tailwind bg-gradient-*) so they render on iOS/iPad Safari.
  const style: CSSProperties | undefined =
    tier === "hires"
      ? { backgroundImage: "linear-gradient(to right, #fde68a, #fbbf24)", color: "#451a03" }
      : tier === "lossless"
        ? { backgroundImage: "linear-gradient(to right, #e2e8f0, #94a3b8)", color: "#0f172a" }
        : undefined;
  const cls =
    tier === "hires"
      ? "shadow-sm shadow-amber-500/20"
      : tier === "lossy"
        ? "bg-white/10 text-muted-foreground"
        : tier === "lossless"
          ? ""
          : "bg-white/10 text-foreground/90";

  return (
    <span
      style={style}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
        cls,
        className,
      )}
    >
      {label}
    </span>
  );
}
