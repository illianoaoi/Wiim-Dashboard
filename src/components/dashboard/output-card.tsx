"use client";

import { useState } from "react";
import { Speaker } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { OptionGrid } from "./option-grid";
import { useToast } from "@/components/toast";
import { apiSend, ApiError } from "@/lib/client/api";
import { OUTPUTS } from "@/lib/wiim/constants";

/** Button label for the USB output: the connected DAC's name — collapsing a
 *  repeated leading word some DACs report ("Audio-gd Audio-gd …" → "Audio-gd")
 *  and trimming if long — else the generic "USB". (@MennoH request, #11) */
function usbLabel(usbDac?: string | null): string {
  if (!usbDac) return "USB";
  let name = usbDac.trim().replace(/^(\S+)\s+\1\b/i, "$1").trim();
  if (name.length > 16) name = name.slice(0, 15).trimEnd() + "…";
  return name || "USB";
}

export function OutputCard({
  deviceId,
  outputIds,
  available,
  usbDac,
  outputNames,
  current,
  coexist,
  onChanged,
}: {
  deviceId: string;
  outputIds: number[];
  /** live output roster from getSoundCardModeSupportList; preferred over the
   *  cached capability set so volatile outputs (USB) stay in sync. #11 */
  available?: number[];
  /** connected USB-DAC name, used to label the USB output button. #11 */
  usbDac?: string | null;
  /** device-reported output devName per hw id (amp speaker labelling). #10 */
  outputNames?: Record<number, string>;
  current: number | null;
  coexist?: Record<number, number[]>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Prefer the live output roster (getSoundCardModeSupportList) so a volatile
  // output like USB stays listed and switchable while its DAC is connected —
  // instead of vanishing the moment you switch away from it. Fall back to the
  // detected capability set, and always include the live current output. #11
  const base = available && available.length > 0 ? available : outputIds;
  const ids = current != null && !base.includes(current) ? [...base, current] : base;
  const options = OUTPUTS.filter((o) => ids.includes(o.id)).map((o) => ({
    id: String(o.id),
    label:
      o.id === 8
        ? usbLabel(usbDac) // USB button shows the DAC name (#11)
        : o.id === 2 && /speaker/i.test(outputNames?.[2] ?? "")
          ? "Speaker" // some amp firmware routes the built-in speaker via the Line Out slot (#10)
          : o.label,
    icon: o.icon,
  }));

  // Outputs this device drives at the same time as the current one (e.g. the
  // Ultra feeds Line Out alongside Optical/COAX). #5
  const coexistLabels =
    current != null
      ? (coexist?.[current] ?? [])
          .map((id) => OUTPUTS.find((o) => o.id === id)?.label)
          .filter((l): l is string => !!l)
      : [];

  async function select(id: string) {
    setBusyId(id);
    try {
      await apiSend(`/api/devices/${deviceId}/output`, "POST", { mode: Number(id) });
      onChanged();
    } catch (e) {
      toast((e as ApiError).message || "Could not switch output", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (options.length === 0) return null;

  return (
    <Card className="pb-5">
      <CardHeader icon={<Speaker className="size-4" />} title="Output" />
      <div className="px-5 pt-4">
        <OptionGrid
          options={options}
          currentId={current != null ? String(current) : null}
          busyId={busyId}
          onSelect={select}
        />
      </div>
      {coexistLabels.length > 0 && (
        <p className="mt-3 px-5 text-[11px] leading-snug text-muted-foreground">
          Also playing through {coexistLabels.join(" + ")} at the same time.
        </p>
      )}
    </Card>
  );
}
