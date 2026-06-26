import Link from "next/link";
import { Disc3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div
        className="mb-5 grid size-20 place-items-center rounded-3xl"
        style={{ backgroundImage: "linear-gradient(to bottom right, hsl(var(--primary) / 0.3), hsl(var(--accent) / 0.2))" }}
      >
        <Disc3 className="size-10 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">No devices yet</h2>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        Add your WiiM device to start controlling playback, EQ, sub-out and more.
      </p>
      <Link href="/devices" className="mt-5">
        <Button size="lg">
          <Plus className="size-5" /> Add a device
        </Button>
      </Link>
    </div>
  );
}
