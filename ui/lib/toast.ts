// Tiny toast store with no dependencies — module state + subscribe, the same
// shape the artwork cache uses. Kept outside React so anything (event
// listeners, window.onerror, api helpers) can raise one without a hook.

import { log } from "./log";

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  /** Longer body under the title, pre-wrapped. */
  detail?: string;
  /** Sticky toasts stay until dismissed — for failures that lose data if the
   * user never sees them (a failed save, not a failed thumbnail). */
  sticky?: boolean;
}

const MAX_VISIBLE = 5;
const ERROR_DURATION_MS = 8000;
const DEFAULT_DURATION_MS = 4000;

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot for useSyncExternalStore — a new array only on change. */
export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (toasts.some((t) => t.id === id)) {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }
}

export function toast(
  kind: ToastKind,
  title: string,
  opts: { detail?: string; sticky?: boolean; durationMs?: number } = {},
): number {
  // A repeated failure (poll loop, retry storm) refreshes the existing toast
  // instead of stacking duplicates of the same message.
  const dup = toasts.find(
    (t) => t.kind === kind && t.title === title && t.detail === opts.detail,
  );
  if (dup) {
    const timer = timers.get(dup.id);
    if (timer) {
      clearTimeout(timer);
      timers.set(
        dup.id,
        setTimeout(() => dismissToast(dup.id), opts.durationMs ?? durationFor(kind)),
      );
    }
    return dup.id;
  }

  // Every toast is logged: this is the whole of what the app ever said to the
  // user, so a report of "it showed me an error" can be matched to the line
  // that raised it. Repeats above take the early return and log once.
  const spoken = opts.detail ? `${title} — ${opts.detail}` : title;
  if (kind === "error") log.error("toast.error", spoken);
  else log.info(`toast.${kind}`, spoken);

  const t: Toast = { id: nextId++, kind, title, detail: opts.detail, sticky: opts.sticky };
  const next = [...toasts, t];
  // Overflow drops the oldest non-sticky toast, never a sticky one.
  while (next.length > MAX_VISIBLE) {
    const victim = next.findIndex((x) => !x.sticky);
    if (victim === -1) break;
    dismissToast(next[victim].id);
    next.splice(victim, 1);
  }
  toasts = next;
  emit();
  if (!t.sticky) {
    timers.set(
      t.id,
      setTimeout(() => dismissToast(t.id), opts.durationMs ?? durationFor(kind)),
    );
  }
  return t.id;
}

function durationFor(kind: ToastKind): number {
  return kind === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS;
}

export const toastError = (title: string, detail?: string) =>
  toast("error", title, { detail });
export const toastSuccess = (title: string, detail?: string) =>
  toast("success", title, { detail });
export const toastInfo = (title: string, detail?: string) =>
  toast("info", title, { detail });
