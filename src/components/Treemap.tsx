import { useMemo } from "react";
import { ArtworkThumb } from "@/components/ArtworkThumb";
import { formatCount, type RankedItem } from "@/lib/stats";
import { cn } from "@/lib/utils";

/**
 * Stock-heatmap-style treemap (TradingView): each block's SIZE is its share
 * of the leader's plays (the market-cap analogue) and its COLOR is play
 * intensity (the change analogue). Layout is squarified — Bruls et al.'s
 * algorithm keeps rectangles close to square so labels survive at small
 * sizes — computed once in the unit square and scaled with percentages,
 * so the map reflows for free with the window.
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Worst aspect ratio a row of areas would produce along a strip of the
 * given side length — the algorithm's stop signal. */
function worstRatio(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum <= 0 || side <= 0) return Infinity;
  let m = 0;
  for (const r of row) {
    const a = (side * side * r) / (sum * sum);
    m = Math.max(m, Math.max(a, 1 / a));
  }
  return m;
}

/** Squarified layout of values (sorted desc) in the unit square. */
function squarify(values: number[]): Rect[] {
  const rects: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return rects;
  const areas = values.map((v) => v / total);
  let x = 0;
  let y = 0;
  let w = 1;
  let h = 1;
  let i = 0;
  while (i < areas.length && w > 0 && h > 0) {
    const side = Math.min(w, h);
    const row = [areas[i]];
    let j = i + 1;
    while (
      j < areas.length &&
      worstRatio([...row, areas[j]], side) <= worstRatio(row, side)
    ) {
      row.push(areas[j]);
      j++;
    }
    const rowSum = row.reduce((a, b) => a + b, 0);
    if (rowSum <= 0) break;
    if (w >= h) {
      // Vertical strip: width from the row's share of the height.
      const stripW = rowSum / h;
      let yy = y;
      for (let k = 0; k < row.length; k++) {
        const hh = row[k] / stripW;
        rects[i + k] = { x, y: yy, w: stripW, h: hh };
        yy += hh;
      }
      x += stripW;
      w -= stripW;
    } else {
      const stripH = rowSum / w;
      let xx = x;
      for (let k = 0; k < row.length; k++) {
        const ww = row[k] / stripH;
        rects[i + k] = { x: xx, y, w: ww, h: stripH };
        xx += ww;
      }
      y += stripH;
      h -= stripH;
    }
    i = j;
  }
  return rects;
}

/** Intensity bands relative to the leader — absolute thresholds would
 * recolor with library size, ratios keep the visual language stable. */
const BAND_CLASSES = [
  "bg-primary/5",
  "bg-primary/15",
  "bg-primary/30",
  "bg-primary/55",
  "bg-primary/85",
];

function band(ratio: number): number {
  if (ratio >= 0.6) return 4;
  if (ratio >= 0.35) return 3;
  if (ratio >= 0.15) return 2;
  if (ratio >= 0.05) return 1;
  return 0;
}

export function Treemap({ title, items }: { title: string; items: RankedItem[] }) {
  const cells = useMemo(() => {
    if (items.length === 0) return [];
    const max = Math.max(...items.map((i) => i.plays), 1);
    const rects = squarify(items.map((i) => i.plays));
    return items.map((item, i) => ({
      item,
      rect: rects[i],
      band: band(item.plays / max),
    }));
  }, [items]);

  if (cells.length === 0) return null;

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <div className="relative aspect-[16/7] w-full select-none">
        {cells.map(({ item, rect, band: b }) => {
          const cx = rect.x + rect.w / 2;
          const cy = rect.y + rect.h / 2;
          // Text yields to size, but the cover never hides — plates too small
          // for a name still carry their smallest thumb.
          const showName = rect.w >= 0.16 && rect.h >= 0.16;
          const showDetail = rect.w >= 0.3 && rect.h >= 0.3;
          const coverSize = showDetail
            ? 40
            : showName
              ? 20
              : rect.w >= 0.05 && rect.h >= 0.12
                ? 14
                : 0;
          return (
            <div
              key={`${item.name}-${item.subtitle}`}
              className="group absolute"
              style={{
                left: pct(rect.x),
                top: pct(rect.y),
                width: pct(rect.w),
                height: pct(rect.h),
              }}
            >
              <div
                className={cn(
                  "flex h-full w-full items-start gap-1.5 overflow-hidden rounded-[3px] p-1.5 ring-1 ring-background hover:ring-foreground/50",
                  BAND_CLASSES[b],
                )}
              >
                {/* Null id renders the music-note placeholder — artless
                    albums still get a tile so plates don't look empty. */}
                {coverSize > 0 && (
                  <ArtworkThumb
                    trackId={item.artTrackId}
                    size={coverSize}
                    className="rounded-[2px]"
                  />
                )}
                <div className="flex min-w-0 flex-col">
                  {showName && (
                    <span
                      className={cn(
                        "truncate text-xs leading-tight font-medium",
                        b >= 3 ? "text-primary-foreground" : "text-foreground",
                      )}
                    >
                      {item.name}
                    </span>
                  )}
                  {/* Artist rides along on every named plate; the play text
                      joins it only when the cell has room for detail. */}
                  {(showDetail || (showName && item.subtitle)) && (
                    <span
                      className={cn(
                        "truncate text-[10px] leading-tight tabular-nums",
                        b >= 3
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground",
                      )}
                    >
                      {item.subtitle}
                      {showDetail && ` · ${formatCount(item.plays)}`}
                    </span>
                  )}
                </div>
              </div>
              {/* Tooltip flips inside the map near its edges. */}
              <div
                role="tooltip"
                className={cn(
                  "pointer-events-none absolute z-20 whitespace-nowrap rounded-md border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100",
                  cy < 0.3 ? "top-full mt-1" : "bottom-full mb-1",
                  cx < 0.2
                    ? "left-0"
                    : cx > 0.8
                      ? "right-0"
                      : "left-1/2 -translate-x-1/2",
                )}
              >
                <span className="font-semibold tabular-nums">
                  {formatCount(item.plays)}
                </span>{" "}
                {item.plays === 1 ? "play" : "plays"}
                {" · "}
                <span className="text-muted-foreground">
                  {item.subtitle ? `${item.name} — ${item.subtitle}` : item.name}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
