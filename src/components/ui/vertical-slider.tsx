"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function VerticalSlider({
  value,
  min,
  max,
  step = 0.5,
  onChange,
  onCommit,
  disabled,
  className,
  ariaLabel,
}: Props) {
  return (
    <SliderPrimitive.Root
      orientation="vertical"
      className={cn("relative flex h-36 w-6 touch-none select-none flex-col items-center", className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onChange(v[0]!)}
      onValueCommit={(v) => onCommit?.(v[0]!)}
      aria-label={ariaLabel}
    >
      <SliderPrimitive.Track className="relative w-1.5 grow overflow-hidden rounded-full bg-white/10">
        <SliderPrimitive.Range className="absolute w-full rounded-full bg-gradient-to-t from-primary to-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className="block size-4 rounded-full border-2 border-primary bg-white shadow-md shadow-primary/30 transition-transform focus-ring active:scale-110 disabled:opacity-50"
        aria-label={ariaLabel}
      />
    </SliderPrimitive.Root>
  );
}
