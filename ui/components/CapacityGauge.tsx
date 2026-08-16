import type { Capacity } from "@/lib/types";
import { formatBytes } from "@/lib/format";

/** Free space on the connected iPod, so a nearly-full disk is visible before
 * an import fails halfway through. Blue wedge = used space, from 12 o'clock. */
export function CapacityGauge({ capacity }: { capacity: Capacity | null }) {
  if (!capacity || capacity.totalBytes <= 0) return null;
  const { freeBytes, totalBytes } = capacity;
  const fraction = Math.min(1, Math.max(0, (totalBytes - freeBytes) / totalBytes));

  // Sized against the header's 36px controls, not on its own: the dial and the
  // figure beside it are one readout sitting in a row of 36px buttons, and a
  // 12px dot with 12px text next to a 14px label read as a footnote to them.
  const r = 7;
  const c = { x: r, y: r };
  const angle = -Math.PI / 2 + 2 * Math.PI * fraction;
  const end = { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
  const largeArc = fraction > 0.5 ? 1 : 0;
  const wedge =
    fraction >= 1
      ? null
      : `M ${c.x} ${c.y} L ${c.x} ${c.y - r} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;

  return (
    <div
      className="mx-2.5 flex shrink-0 items-center gap-1.5"
      title={`${formatBytes(totalBytes - freeBytes)} used of ${formatBytes(totalBytes)} on the connected iPod`}
    >
      <svg width={r * 2} height={r * 2} className="shrink-0">
        <circle cx={c.x} cy={c.y} r={r} className="fill-muted-foreground/25" />
        {fraction >= 1 ? (
          <circle cx={c.x} cy={c.y} r={r} className="fill-primary" />
        ) : (
          wedge && <path d={wedge} className="fill-primary" />
        )}
      </svg>
      <span className="text-sm tabular-nums whitespace-nowrap text-muted-foreground">
        {formatBytes(freeBytes)} free
      </span>
    </div>
  );
}
