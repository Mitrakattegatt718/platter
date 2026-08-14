import { useSyncExternalStore } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  type Toast,
  type ToastKind,
} from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICONS: Record<ToastKind, typeof Info> = {
  error: CircleAlert,
  success: CheckCircle2,
  info: Info,
};

const ICON_TINT: Record<ToastKind, string> = {
  error: "text-destructive",
  success: "text-green-600 dark:text-green-500",
  info: "text-muted-foreground",
};

/** Bottom-right toast stack. Non-modal by design: the ErrorDialog stays the
 * surface for failures that block what the user is doing right now; toasts
 * carry everything that must be seen but not acknowledged — background saves,
 * eject results, event-listener drops. */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const Icon = ICONS[toast.kind];
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card p-3 text-card-foreground shadow-lg",
        "animate-in slide-in-from-bottom-2 fade-in duration-200 motion-reduce:animate-none",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", ICON_TINT[toast.kind])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.detail && (
          <p className="mt-0.5 max-h-32 overflow-y-auto text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {toast.detail}
          </p>
        )}
      </div>
      <button
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss"
        onClick={() => dismissToast(toast.id)}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
