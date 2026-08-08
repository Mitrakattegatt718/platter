import type { AppView } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABELS: Record<AppView, string> = {
  library: "Library",
  convert: "Convert",
};

/** The macOS segmented-control idiom, not a web nav bar: one recessed track,
 * the active segment raised. Reads as system chrome and stays quiet. */
export function ViewTabs({
  view,
  onChange,
  /** 0…1 while a conversion runs, null when idle. Drawn as a small arc inside
   * the Convert label so a user who switched back to Library can still see the
   * job is alive — and nothing shows when nothing is happening. */
  convertProgress,
}: {
  view: AppView;
  onChange: (view: AppView) => void;
  convertProgress: number | null;
}) {
  return (
    <div role="tablist" aria-label="View" className="flex items-center rounded-md bg-muted/60 p-0.5">
      {(Object.keys(LABELS) as AppView[]).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
            view === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABELS[v]}
          {v === "convert" && convertProgress !== null && (
            <ProgressArc fraction={convertProgress} />
          )}
        </button>
      ))}
    </div>
  );
}

function ProgressArc({ fraction }: { fraction: number }) {
  const r = 5;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.2} />
      <circle
        cx="6"
        cy="6"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, fraction)))}
        // Start the sweep at 12 o'clock rather than 3.
        transform="rotate(-90 6 6)"
      />
    </svg>
  );
}
