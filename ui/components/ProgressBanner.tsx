import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Progress as ProgressState } from "@/lib/types";

/** Bottom-center overlay while the backend is busy — linear bar for countable
 * work (imports), spinner otherwise. */
export function ProgressBanner({
  busy,
  progress,
}: {
  busy: boolean;
  progress: ProgressState | null;
}) {
  if (!busy) return null;
  const text = progress?.text ?? "Working…";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <div className="flex min-w-80 flex-col items-stretch gap-1.5 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {progress?.fraction == null && <Loader2 className="size-3.5 animate-spin" />}
          <span className="truncate">{text}</span>
        </div>
        {progress?.fraction != null && <Progress value={progress.fraction * 100} />}
      </div>
    </div>
  );
}
