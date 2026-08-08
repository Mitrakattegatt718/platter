import { useMemo, useState } from "react";
import { BarChart3, Check, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  computeStats,
  formatCount,
  formatListenTime,
  type ListeningStats,
  type RankedItem,
} from "@/lib/stats";
import { copyImageToClipboard, renderShareCard } from "@/lib/shareCard";
import type { Track } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatsView({
  tracks,
  mountPoint,
}: {
  tracks: Track[];
  /** null when no iPod is connected. */
  mountPoint: string | null;
}) {
  const stats = useMemo(() => computeStats(tracks), [tracks]);

  if (mountPoint === null) {
    return (
      <EmptyState
        title="No iPod connected"
        body="Connect an iPod to see listening stats. Play counts live on the device and sync into the library when it mounts."
      />
    );
  }
  if (stats.totalPlays === 0) {
    return (
      <EmptyState
        title="No plays recorded yet"
        body="Go listen to some music on the iPod, then reconnect. The device writes its Play Counts file as you listen, and PodSync reads it on connect — your most-played artists, albums and tracks will appear here."
      />
    );
  }
  return <StatsBody stats={stats} deviceName={`iPod (${mountPoint})`} />;
}

function StatsBody({ stats, deviceName }: { stats: ListeningStats; deviceName: string }) {
  const [copied, setCopied] = useState<null | boolean>(null);

  async function share() {
    const blob = await renderShareCard(stats, deviceName);
    const ok = blob !== null && (await copyImageToClipboard(blob));
    setCopied(ok);
    window.setTimeout(() => setCopied(null), 1600);
  }

  const playedPct =
    stats.totalTracks > 0
      ? Math.round((stats.playedTracks / stats.totalTracks) * 100)
      : 0;
  const facts: [string, string][] = [
    ["Plays", formatCount(stats.totalPlays)],
    ["Listening time", formatListenTime(stats.listenMs)],
    ["Tracks played", `${formatCount(stats.playedTracks)} of ${formatCount(stats.totalTracks)}`],
    ["Library coverage", `${playedPct}%`],
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-9 px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-balance">Listening Stats</h1>
            <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
              What this iPod has actually been playing. Play counts merge in
              from the device each time it connects.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button variant="outline" size="sm" onClick={share} title="Copy a PNG of these stats to the clipboard">
              {copied === true ? <Check /> : <Share />}
              {copied === true ? "Copied" : "Copy Snapshot"}
            </Button>
            {copied === false && (
              <span className="text-[11px] text-destructive">
                Couldn’t write to the clipboard
              </span>
            )}
          </div>
        </div>

        {/* One divided strip, Get-Info style — facts, not hero metrics. */}
        <dl className="grid grid-cols-2 divide-border overflow-hidden rounded-lg border sm:grid-cols-4 sm:divide-x">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-1 gap-9 sm:grid-cols-2 sm:gap-8">
          <Ranking title="Top Artists" items={stats.topArtists} />
          <Ranking title="Top Albums" items={stats.topAlbums} />
        </div>
        <Ranking title="Top Tracks" items={stats.topTracks} />
      </div>
    </div>
  );
}

/** A ranked bar list: each row's fill is its share of the leader's plays.
 * The narrow end floors at a visible sliver so rank 10 isn't an empty row. */
function Ranking({ title, items }: { title: string; items: RankedItem[] }) {
  const max = Math.max(...items.map((i) => i.plays), 1);
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <ol className="flex flex-col gap-px">
        {items.map((item, i) => (
          <li
            key={`${item.name}-${i}`}
            className="relative overflow-hidden rounded-md px-2 py-1"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-md bg-primary/10"
              style={{ width: `${(Math.max(0.03, item.plays / max) * 100).toFixed(2)}%` }}
            />
            <div className="relative flex items-baseline gap-2">
              <span
                className={cn(
                  "w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70",
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  "min-w-0 truncate text-sm",
                  i === 0 && "font-semibold",
                )}
                title={item.subtitle ? `${item.name} — ${item.subtitle}` : item.name}
              >
                {item.name}
                {item.subtitle && (
                  <span className="text-muted-foreground"> — {item.subtitle}</span>
                )}
              </span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatCount(item.plays)}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
      <BarChart3 className="size-10" />
      <p className="font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs leading-relaxed">{body}</p>
    </div>
  );
}
