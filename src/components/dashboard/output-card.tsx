"use client";

import { useState } from "react";
import { Speaker } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { OptionGrid } from "./option-grid";
import { useToast } from "@/components/toast";
import { apiSend, ApiError } from "@/lib/client/api";
import { OUTPUTS } from "@/lib/wiim/constants";

export function OutputCard({
  deviceId,
  outputIds,
  current,
  coexist,
  onChanged,
}: {
  deviceId: string;
  outputIds: number[];
  current: number | null;
  coexist?: Record<number, number[]>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Always render the live current output even if a stale cached capability set
  // (detected while on another output) didn't list it — e.g. USB=8. #11
  const ids =
    current != null && !outputIds.includes(current) ? [...outputIds, current] : outputIds;
  const options = OUTPUTS.filter((o) => ids.includes(o.id)).map((o) => ({
    id: String(o.id),
    label: o.label,
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
