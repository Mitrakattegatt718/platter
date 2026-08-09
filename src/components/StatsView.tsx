import { useMemo, useState } from "react";
import { BarChart3, Check, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArtworkThumb } from "@/components/ArtworkThumb";
import { cachedArtwork } from "@/lib/api";
import {
  computeStats,
  coverTrackIds,
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
  const covers = useMemo(() => coverTrackIds(stats), [stats]);

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
  return <StatsBody stats={stats} covers={covers} deviceName={`iPod (${mountPoint})`} />;
}

function StatsBody({
  stats,
  covers,
  deviceName,
}: {
  stats: ListeningStats;
  covers: string[];
  deviceName: string;
}) {
  const [copied, setCopied] = useState<null | boolean>(null);

  async function share() {
    // Resolve the card's covers through the shared artwork cache — same data
    // URLs the mosaic already fetched, so export doesn't re-hit the backend.
    const urls = (
      await Promise.all(stats.topAlbums.slice(0, 5).map((a) =>
        a.artTrackId ? cachedArtwork(a.artTrackId, 200) : Promise.resolve(null),
      ))
    ).filter((u): u is string => u !== null);
    const blob = await renderShareCard(stats, deviceName, urls);
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
      {/* The covers are the B2C moment: a full-width wall of what the device
          actually played, fading into the page. Everything below stays quiet. */}
      {covers.length >= 4 && <CoverWall ids={covers} />}

      <div
        className={cn(
          "mx-auto flex max-w-3xl flex-col gap-9 px-6",
          covers.length >= 4 ? "-mt-2 pb-8" : "py-6",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-2xl font-semibold leading-snug text-balance">
              {formatListenTime(stats.listenMs)} of listening on this iPod
            </h1>
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              {formatCount(stats.totalPlays)} plays across{" "}
              {formatCount(stats.playedTracks)} tracks — counted by the device
              itself, merged in every time it connects.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={share}
              title="Copy a PNG of these stats to the clipboard"
            >
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
              <dd className="text-xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-1 gap-9 sm:grid-cols-2 sm:gap-8">
          <Ranking title="Top Artists" items={stats.topArtists} />
          <Ranking title="Top Albums" items={stats.topAlbums} showArt />
        </div>
        <Ranking title="Top Tracks" items={stats.topTracks} showArt />
      </div>
    </div>
  );
}

/** A ranked bar list: each row's fill is its share of the leader's plays.
 * The narrow end floors at a visible sliver so rank 10 isn't an empty row. */
function Ranking({
  title,
  items,
  showArt = false,
}: {
  title: string;
  items: RankedItem[];
  showArt?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.plays), 1);
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <ol className="flex flex-col gap-0.5">
        {items.map((item, i) => (
          <li
            key={`${item.name}-${i}`}
            className="relative overflow-hidden rounded-md py-1 pl-1.5 pr-2"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-md bg-primary/10"
              style={{ width: `${(Math.max(0.03, item.plays / max) * 100).toFixed(2)}%` }}
            />
            <div className="relative flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70">
                {i + 1}
              </span>
              {showArt && item.artTrackId && (
                <ArtworkThumb trackId={item.artTrackId} size={28} className="rounded" />
              )}
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

/** Full-width mosaic of the most-played covers, fading into the page.
 * Tiles are square and fluid; rows split evenly regardless of count. */
function CoverWall({ ids }: { ids: string[] }) {
  const top = ids.slice(0, Math.ceil(ids.length / 2));
  const bottom = ids.slice(Math.ceil(ids.length / 2));
  return (
    <div className="relative select-none overflow-hidden" aria-hidden>
      <div className="flex flex-col gap-1 px-1 pt-1">
        {[top, bottom].map((row, ri) => (
          <div
            key={ri}
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          >
            {row.map((id) => (
              <div
                key={id}
                className="aspect-square w-full overflow-hidden rounded-md ring-1 ring-black/5 dark:ring-white/10"
              >
                <ArtworkThumb trackId={id} size={160} fill className="rounded-none" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background to-transparent" />
    </div>
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
