"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { apiGet } from "@/lib/client/api";
import { cn } from "@/lib/utils";

interface StatItem {
  name: string;
  artist?: string;
  playcount: number;
  url: string;
}
interface Stats {
  topArtists: StatItem[];
  topTracks: StatItem[];
  totalScrobbles: number | null;
}

const PERIODS = [
  { key: "7day", label: "7 days" },
  { key: "1month", label: "Month" },
  { key: "overall", label: "All time" },
];

/** Top artists/tracks from the connected Last.fm account (no images → no CSP/SSRF). */
export function LastfmStatsCard() {
  const [period, setPeriod] = useState("1month");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<Stats>(`/api/lastfm/stats?period=${period}`)
      .then((s) => {
        if (!cancelled) {
          setStats(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStats(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const hasData = !!stats && (stats.topArtists.length > 0 || stats.topTracks.length > 0);

  return (
    <Card className="pb-5">
      <CardHeader icon={<BarChart3 className="size-4" />} title="Last.fm stats" />
      <div className="px-5 pt-2">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-white/8 p-1 text-xs">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-full px-3 py-1 font-medium transition",
                  period === p.key
                    ? "bg-white/15 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {stats?.totalScrobbles != null && (
            <span className="ml-auto text-xs text-muted-foreground">
              {stats.totalScrobbles.toLocaleString()} scrobbles
            </span>
          )}
        </div>

        {loading ? (
          <div className="grid place-items-center py-8 text-muted-foreground">
            <Spinner className="size-6" />
          </div>
        ) : hasData ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <StatList
              title="Top artists"
              items={stats!.topArtists.map((a) => ({ primary: a.name, count: a.playcount, url: a.url }))}
            />
            <StatList
              title="Top tracks"
              items={stats!.topTracks.map((t) => ({
                primary: t.name,
                secondary: t.artist,
                count: t.playcount,
                url: t.url,
              }))}
            />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No scrobbles yet for this period.
          </p>
        )}
      </div>
    </Card>
  );
}

function StatList({
  title,
  items,
}: {
  title: string;
  items: { primary: string; secondary?: string; count: number; url: string }[];
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ol className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground/60">
              {i + 1}
            </span>
            <a
              href={it.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate hover:underline"
              title={it.secondary ? `${it.primary} · ${it.secondary}` : it.primary}
            >
              <span className="font-medium">{it.primary}</span>
              {it.secondary && <span className="text-muted-foreground"> · {it.secondary}</span>}
            </a>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {it.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
