"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Disc3, ChevronDown, Plus, Settings, LogOut, Check } from "lucide-react";
import { apiSend } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { DeviceListItem } from "@/lib/client/hooks";

export function AppHeader({
  devices,
  selectedId,
  onSelect,
  online,
}: {
  devices: DeviceListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  online: boolean;
}) {
  const selected = devices.find((d) => d.id === selectedId) ?? null;

  async function logout() {
    try {
      await apiSend("/api/auth/logout", "POST");
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
        <div
          className="grid size-9 shrink-0 place-items-center rounded-xl shadow-md shadow-primary/30"
          style={{ backgroundImage: "linear-gradient(to bottom right, hsl(var(--primary)), hsl(var(--accent)))" }}
        >
          <Disc3 className="size-5 text-white" />
        </div>

        {devices.length > 0 && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="focus-ring flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 transition hover:bg-white/8">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    online ? "bg-success shadow-[0_0_8px] shadow-success/60" : "bg-muted-foreground/50",
                  )}
                />
                <span className="truncate text-base font-semibold">
                  {selected?.name ?? "Select device"}
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={8}
                className="glass z-50 min-w-56 rounded-2xl p-1.5 shadow-2xl"
              >
                {devices.map((d) => (
                  <DropdownMenu.Item
                    key={d.id}
                    onSelect={() => onSelect(d.id)}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition data-[highlighted]:bg-white/8"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {d.info?.model ?? d.host}
                      </span>
                    </span>
                    {d.id === selectedId && <Check className="size-4 text-primary" />}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item asChild>
                  <Link
                    href="/devices"
                    className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-sm outline-none transition data-[highlighted]:bg-white/8"
                  >
                    <Plus className="size-4" /> Add device
                  </Link>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/devices"
            aria-label="Add device"
            className="focus-ring grid size-10 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
          >
            <Plus className="size-5" />
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            className="focus-ring grid size-10 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
          >
            <Settings className="size-5" />
          </Link>
          <button
            onClick={logout}
            aria-label="Sign out"
            className="focus-ring grid size-10 place-items-center rounded-xl text-muted-foreground transition hover:bg-white/8 hover:text-destructive"
          >
            <LogOut className="size-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
