/** The webview's half of the session log.
 *
 * Lines go to the same file the Rust side writes (`logging.rs`), under the
 * `ui` target, so one file tells the whole story: what the user did, what it
 * asked the backend for, and what came back. That is the artifact a bug report
 * attaches, so the bar for a line is "would this have told me what happened",
 * not "is this interesting today".
 *
 * Batched, because a line costs an IPC round trip and a search field would
 * otherwise fire one per keystroke. Ordering is what batching threatens, and
 * ordering is most of the value, so `api.ts` flushes before every command:
 * "user clicked Connect" is guaranteed to sit above `open_library` rather than
 * arriving 200ms later. Errors flush immediately — the next thing to happen
 * may be a crash, and an error still sitting in the buffer helps nobody.
 *
 * `createLogBuffer` is the whole mechanism and takes its sink, so `log.test.ts`
 * can drive it without a webview; the module-level `log` is that factory wired
 * to `invoke`. */

import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "info" | "warn" | "error";

export interface LogLine {
  level: LogLevel;
  message: string;
}

/** Enough to cover a burst without letting a runaway loop eat memory. */
const MAX_PENDING = 500;
const FLUSH_DELAY_MS = 250;

export interface LogBuffer {
  info(event: string, detail?: unknown): void;
  warn(event: string, detail?: unknown): void;
  error(event: string, detail?: unknown): void;
  /** Send whatever is buffered now. Safe to call when empty. */
  flush(): void;
}

export function createLogBuffer(
  sink: (lines: LogLine[]) => void,
  { flushDelayMs = FLUSH_DELAY_MS, maxPending = MAX_PENDING } = {},
): LogBuffer {
  let pending: LogLine[] = [];
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (dropped > 0) {
      // Ahead of the surviving lines, where it reads as the gap it describes.
      pending.unshift({
        level: "warn",
        message: `log buffer overflowed, ${dropped} line(s) dropped`,
      });
      dropped = 0;
    }
    if (pending.length === 0) return;
    const lines = pending;
    pending = [];
    sink(lines);
  }

  function push(level: LogLevel, event: string, detail?: unknown) {
    pending.push({ level, message: formatLine(event, detail) });
    if (pending.length > maxPending) {
      // Oldest first: the lines nearest the failure are the ones worth keeping.
      pending.shift();
      dropped++;
    }
    if (level === "error") {
      flush();
    } else if (timer === null) {
      timer = setTimeout(flush, flushDelayMs);
    }
  }

  return {
    info: (event, detail) => push("info", event, detail),
    warn: (event, detail) => push("warn", event, detail),
    error: (event, detail) => push("error", event, detail),
    flush,
  };
}

/** `event` is a dotted name — `view.change`, `library.connect` — so a reader
 * can grep a subsystem out of a busy file. */
export function formatLine(event: string, detail?: unknown): string {
  if (detail === undefined) return event;
  const rendered = typeof detail === "string" ? detail : summarizeValue(detail);
  return rendered === "" ? event : `${event} ${rendered}`;
}

/** Long enough to recognise a path or a title, short enough that one line
 * stays one line. */
const MAX_STRING = 80;

/** Arguments are summarized, never dumped. `import_tracks` carries thousands
 * of records and a base64 cover per row; a faithful log of that call is
 * megabytes, unreadable, and pushes the lines that matter out of the file. */
export function summarizeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${JSON.stringify(value.slice(0, MAX_STRING))}…` : JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.length === 1 ? `[${summarizeValue(value[0])}]` : `[${value.length} items]`;
  }
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return keys.length === 0 ? "{}" : `{${keys.join(",")}}`;
  }
  return String(value);
}

/** `mountPoint="/Volumes/IPOD" ids=[412 items]` — the shape of a call, with
 * enough of the values to tell two calls apart. */
export function summarizeArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  return Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${summarizeValue(v)}`)
    .join(" ");
}

/** Platform noise that reaches window.onerror without anything being wrong.
 *
 * The global handlers exist so a failure can't die silently in a console
 * nobody can open, and they toast because a user who saw nothing happen
 * deserves to know why. That only works while a toast means something. These
 * two never do:
 *
 * - The ResizeObserver line is a notification, not a fault. The spec has the
 *   browser report it whenever observations are still pending when the
 *   delivery loop ends, and it fires for layout that has already settled.
 * - The devtools denial is the app working as designed. The capability carries
 *   `core:webview:deny-internal-toggle-devtools`, so pressing the shortcut is
 *   supposed to be refused — announcing that as an error tells the user their
 *   app is broken because they pressed a key that does nothing.
 *
 * Matched on substring rather than exactly: both strings carry a browser
 * version, an origin or a capability trailer that varies. Still logged, at
 * warn — invisible is not the same as unrecorded, and if one of these ever
 * does precede a real failure, the line is in the file. */
const BENIGN_ERRORS = [
  "ResizeObserver loop",
  "internal_toggle_devtools",
];

export function isBenignError(text: string): boolean {
  return BENIGN_ERRORS.some((fragment) => text.includes(fragment));
}

/** Errors reach the log as whatever the thrower chose to be — Tauri commands
 * reject with a plain string, the rest with an Error. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return summarizeValue(error);
}

// ---------------------------------------------------------------- transport

/** Deliberately not routed through `api.ts`: that wrapper logs every command
 * it makes, and logging the log is a loop. Failures are swallowed — a log that
 * can't be written must not become an error the user sees, and the toast it
 * would raise would log another line and fail again. */
function send(lines: LogLine[]) {
  void invoke("ui_log", { lines }).catch(() => {});
}

export const log = createLogBuffer(send);

/** The tail of the session. `beforeunload` is best-effort by nature — the IPC
 * may not complete before the webview goes — but a closing window is exactly
 * when the last few lines explain the most. */
export function installLogFlushOnUnload() {
  window.addEventListener("beforeunload", () => log.flush());
  // A window hidden on the way to a quit gets no beforeunload on macOS in
  // every path; visibility change is the reliable one.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") log.flush();
  });
}
