"use client";

import {
  Wifi,
  Bluetooth,
  Cable,
  Lightbulb,
  CircleDot,
  Tv,
  Disc3,
  Disc,
  Usb,
  Headphones,
  Speaker,
  HelpCircle,
  type LucideProps,
} from "lucide-react";

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  Wifi,
  Bluetooth,
  Cable,
  Lightbulb,
  CircleDot,
  Tv,
  Disc3,
  Disc,
  Usb,
  Headphones,
  Speaker,
};

/** Render a lucide icon by the string name stored in SOURCES/OUTPUTS. */
export function DynIcon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = MAP[name] ?? HelpCircle;
  return <Cmp {...props} />;
}
