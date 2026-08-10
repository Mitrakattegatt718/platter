import { useMemo } from "react";
import { dayKey } from "@/lib/activity";
import { formatCount } from "@/lib/stats";
import { cn } from "@/lib/utils";

/** Rolling window ending at the current week, GitHub-style. */
const WEEKS = 53;

/** 0 = none, then four deepening steps. Boundaries are absolute play counts
 * per day — quantiles would flatter quiet weeks by recoloring them hot. */
const LEVEL_CLASSES = [
  "bg-muted",
  "bg-primary/20",
  "bg-primary/40",
  "bg-primary/60",
  "bg-primary/90",
];

function level(count: number): number {
  if (count <= 0) return 0;
  if (count < 5) return 1;
  if (count < 10) return 2;
  if (count < 20) return 3;
  return 4;
}

interface Cell {
  key: string;
  count: number;
  /** Days after today occupy grid slots but render nothing. */
  future: boolean;
  today: boolean;
  /** "Mon, Aug 10" — compact, for the hover tooltip. */
  shortDate: string;
  /** Full date, for screen readers. */
  label: string;
}

const DAY_MS = 86_400_000;

function cellLabel(date: Date, count: number): string {
  const when = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (count <= 0) return `No plays · ${when}`;
  return `${formatCount(count)} ${count === 1 ? "play" : "plays"} · ${when}`;
}

/** One shared grid aligns everything: label column + 53 week columns, with a
 * month-label row above the 7 day rows. Day cells are aspect-square, and
 * because labels share their rows, they stay aligned at any window width. */
export function ActivityHeatmap({ data }: { data: Record<string, number> }) {
  const { columns, monthLabels, total } = useMemo(() => {
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    const todayMs = todayMid.getTime();
    // Monday-first columns: shift the JS Sunday-based weekday by 6.
    const mondayOffset = (todayMid.getDay() + 6) % 7;
    const thisWeekStart = todayMs - mondayOffset * DAY_MS;

    const columns: Cell[][] = [];
    const monthLabels: { key: string; label: string; col: number }[] = [];
    let total = 0;
    let prevMonth = -1;
    for (let col = 0; col < WEEKS; col++) {
      const weekStart = thisWeekStart - (WEEKS - 1 - col) * 7 * DAY_MS;
      const firstDay = new Date(weekStart);
      const month = firstDay.getMonth();
      if (col > 0 && month !== prevMonth) {
        monthLabels.push({
          key: firstDay.toISOString(),
          label: firstDay.toLocaleDateString(undefined, { month: "short" }),
          col: col + 1, // grid column line (label column is 1)
        });
      }
      prevMonth = month;

      const cells: Cell[] = [];
      for (let row = 0; row < 7; row++) {
        const dateMs = weekStart + row * DAY_MS;
        const date = new Date(dateMs);
        const future = dateMs > todayMs;
        const count = future ? 0 : (data[dayKey(date)] ?? 0);
        if (!future) total += count;
        cells.push({
          key: dayKey(date),
          count,
          future,
          today: dateMs === todayMs,
          shortDate: date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
          label: future ? "" : cellLabel(date, count),
        });
      }
      columns.push(cells);
    }
    return { columns, monthLabels, total };
  }, [data]);

  const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-medium text-muted-foreground">
          Listening activity
        </h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatCount(total)} {total === 1 ? "play" : "plays"} in the last year
        </span>
      </div>

      <div
        className="grid gap-[3px] select-none"
        style={{ gridTemplateColumns: `minmax(0, 1.75rem) repeat(${WEEKS}, minmax(0, 1fr))` }}
      >
        {/* Month labels; text overflows its ~1-week-wide cell into the gap
            without wrapping — adjacent starts are months apart, so no clash. */}
        <div />
        {columns.map((_, ci) => {
          const m = monthLabels.find((l) => l.col === ci + 1);
          return (
            <div key={`m${ci}`} className="overflow-visible text-[9px] leading-none whitespace-nowrap text-muted-foreground">
              {m?.label ?? ""}
            </div>
          );
        })}

        {Array.from({ length: 7 }, (_, row) => (
          <div key={`r${row}`} className="contents">
            <div className="flex items-center text-[9px] leading-none text-muted-foreground">
              {DAY_LABELS[row]}
            </div>
            {columns.map((colData, ci) => {
              const cell = colData[row];
              return (
                <div key={cell.key} className="group relative">
                  <div
                    aria-label={cell.label || undefined}
                    className={cn(
                      "aspect-square rounded-[2px]",
                      cell.future
                        ? "opacity-0"
                        : cn(
                            LEVEL_CLASSES[level(cell.count)],
                            "hover:ring-1 hover:ring-foreground/50",
                          ),
                      cell.today && !cell.future && "ring-1 ring-foreground/40",
                    )}
                  />
                  {/* Custom tooltip: the OS title popup is too slow to feel
                      hoverable. Anchors flip near the grid edges so the stats
                      scroller never clips it. */}
                  {!cell.future && (
                    <div
                      role="tooltip"
                      className={cn(
                        "pointer-events-none absolute z-20 whitespace-nowrap rounded-md border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100",
                        row < 2 ? "top-full mt-1" : "bottom-full mb-1",
                        ci < 3
                          ? "left-0"
                          : ci > WEEKS - 4
                            ? "right-0"
                            : "left-1/2 -translate-x-1/2",
                      )}
                    >
                      <span className="font-semibold tabular-nums">
                        {formatCount(cell.count)}
                      </span>{" "}
                      {cell.count === 1 ? "play" : "plays"}
                      {" · "}
                      <span className="text-muted-foreground">{cell.shortDate}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-1 text-[9px] text-muted-foreground">
        <span>Less</span>
        {LEVEL_CLASSES.map((c, i) => (
          <span key={i} className={cn("size-[10px] rounded-[2px]", c)} />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}
