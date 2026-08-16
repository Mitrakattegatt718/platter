/** Track-list column geometry.
 *
 * One definition drives the heading, the resize handles and the row template,
 * so the three can't drift apart. The widths reach the DOM as a CSS custom
 * property rather than a class: a drag then repaints by writing one property
 * on the list container, without re-rendering a virtualized list of thousands
 * of rows (TrackList sets `--track-cols` directly while the pointer is down
 * and commits to React state only on release).
 *
 * Title carries no width of its own — it absorbs the slack, and that is what
 * makes a drag track the pointer. Growing a fixed column pushes everything to
 * its right and shrinks Title, so the boundary under the cursor stays under
 * the cursor. `minmax(0, 1fr)` rather than a floor, deliberately: a floor
 * would overflow the row horizontally once the fixed columns outgrew the
 * window, and the heading does not scroll with the list, so the two would
 * silently misalign.
 *
 * The DOM-free half is what `columns.test.ts` covers; vitest runs without a
 * browser. */

export type ColumnKey =
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "trackNumber"
  | "year"
  | "time"
  | "bitrate"
  | "plays";

/** Every column but Title has an explicit, draggable width. */
export type ResizableColumnKey = Exclude<ColumnKey, "title">;

export type ColumnWidths = Record<ResizableColumnKey, number>;

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  align: "left" | "center" | "right";
  /** Null on the flexible column. */
  width: number | null;
  min: number;
  max: number;
  /** Tooltip, where the label alone doesn't say it. */
  hint?: string;
}

/** Order is the on-screen order, and `TrackRow` renders its cells in the same
 * one by hand — reorder here and you must reorder there. */
export const TRACK_COLUMNS: readonly ColumnDef[] = [
  { key: "title", label: "Title", align: "left", width: null, min: 0, max: 0 },
  { key: "artist", label: "Artist", align: "left", width: 120, min: 56, max: 400 },
  { key: "album", label: "Album", align: "left", width: 120, min: 56, max: 400 },
  { key: "genre", label: "Genre", align: "left", width: 80, min: 48, max: 400 },
  { key: "trackNumber", label: "#", align: "center", width: 30, min: 24, max: 120 },
  { key: "year", label: "Year", align: "center", width: 40, min: 32, max: 120 },
  { key: "time", label: "Time", align: "right", width: 40, min: 36, max: 120 },
  { key: "bitrate", label: "kbps", align: "right", width: 36, min: 30, max: 120 },
  {
    key: "plays",
    label: "Plays",
    align: "right",
    width: 36,
    min: 32,
    max: 120,
    hint: "Plays recorded by the iPod",
  },
];

const RESIZABLE: readonly ColumnDef[] = TRACK_COLUMNS.filter((c) => c.width !== null);

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = Object.fromEntries(
  RESIZABLE.map((c) => [c.key, c.width]),
) as ColumnWidths;

const BOUNDS = new Map(RESIZABLE.map((c) => [c.key, c]));

/** Whole pixels, inside the column's own bounds. Anything non-finite falls
 * back to the default: a hand-edited or corrupted stored value must not leave
 * a column at NaN wide, which CSS drops and which then silently reflows every
 * column after it. */
export function clampColumnWidth(key: ResizableColumnKey, px: number): number {
  const def = BOUNDS.get(key)!;
  if (!Number.isFinite(px)) return def.width!;
  return Math.min(def.max, Math.max(def.min, Math.round(px)));
}

/** Tolerant by design — this parses whatever was in localStorage, which may
 * predate a column being added or renamed. Unknown keys are dropped, missing
 * ones take their default. */
export function normalizeColumnWidths(raw: unknown): ColumnWidths {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_COLUMN_WIDTHS };
  const source = raw as Record<string, unknown>;
  const out = {} as ColumnWidths;
  for (const def of RESIZABLE) {
    const key = def.key as ResizableColumnKey;
    const value = source[key];
    out[key] = typeof value === "number" ? clampColumnWidth(key, value) : def.width!;
  }
  return out;
}

export function columnGridTemplate(widths: ColumnWidths): string {
  return TRACK_COLUMNS.map((c) =>
    c.width === null ? "minmax(0, 1fr)" : `${widths[c.key as ResizableColumnKey]}px`,
  ).join(" ");
}

/** Which column a given boundary actually resizes, and in which direction, so
 * that the boundary follows the pointer either way.
 *
 * Every boundary is a fixed column's right edge and resizes that column — bar
 * one. Title's right edge is the flexible column's edge, and there is nothing
 * there to widen; dragging it right instead *narrows* Artist, which hands the
 * pixels to Title and moves the same boundary the same way. */
export function resizeTargetOf(key: ColumnKey): { key: ResizableColumnKey; sign: 1 | -1 } {
  return key === "title" ? { key: "artist", sign: -1 } : { key, sign: 1 };
}

export function withColumnWidth(
  widths: ColumnWidths,
  key: ResizableColumnKey,
  px: number,
): ColumnWidths {
  return { ...widths, [key]: clampColumnWidth(key, px) };
}

/** What Title must keep. Below this it stops being a column and starts being
 * an ellipsis, and at zero its heading prints on top of Artist's. */
export const TITLE_MIN_WIDTH = 160;

/** The `gap-2` between every pair of columns, which is part of what the fixed
 * columns cost the row. */
const COLUMN_GAP = 8;

export function fixedColumnsWidth(widths: ColumnWidths): number {
  const fixed = RESIZABLE.reduce((sum, c) => sum + widths[c.key as ResizableColumnKey], 0);
  return fixed + COLUMN_GAP * (TRACK_COLUMNS.length - 1);
}

export function sameColumnWidths(a: ColumnWidths, b: ColumnWidths): boolean {
  return RESIZABLE.every((c) => a[c.key as ResizableColumnKey] === b[c.key as ResizableColumnKey]);
}

/** Shrink the fixed columns until Title has its floor back.
 *
 * Per-column clamps alone can't prevent this: each of eight columns can be
 * inside its own bounds while the eight of them together leave Title nothing.
 * Only the row's width says whether a set of widths is usable, and the row's
 * width is not known where a width is chosen.
 *
 * Proportional rather than newest-first, and never below a column's own
 * minimum: the widths the user set are a statement about their relative
 * importance, and halving one of them to spare the rest would discard that.
 * A row too narrow to satisfy every minimum keeps the minimums and lets Title
 * take what's left — a floor that cannot be met is not a reason to return
 * widths nobody asked for.
 *
 * `contentWidth` is the row's box inside its own padding. Zero or less means
 * the element hasn't been laid out yet; nothing to fit against, so nothing
 * changes. */
export function fitColumnWidths(widths: ColumnWidths, contentWidth: number): ColumnWidths {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return widths;

  const budget = contentWidth - TITLE_MIN_WIDTH - COLUMN_GAP * (TRACK_COLUMNS.length - 1);
  const fixed = RESIZABLE.reduce((sum, c) => sum + widths[c.key as ResizableColumnKey], 0);
  if (fixed <= budget) return widths;

  const floor = RESIZABLE.reduce((sum, c) => sum + c.min, 0);
  // Rounding is done against the running remainder rather than per column so
  // eight roundings can't add up to a column's worth of drift.
  const scale = (budget - floor) / (fixed - floor);
  const out = {} as ColumnWidths;
  for (const def of RESIZABLE) {
    const key = def.key as ResizableColumnKey;
    const over = widths[key] - def.min;
    out[key] = def.min + Math.max(0, Math.floor(over * Math.max(0, scale)));
  }
  return out;
}

// ---------------------------------------------------------------- DOM side

const STORAGE_KEY = "trackColumnWidths";

export function readColumnWidths(): ColumnWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeColumnWidths(raw === null ? null : JSON.parse(raw));
  } catch {
    return { ...DEFAULT_COLUMN_WIDTHS };
  }
}

export function writeColumnWidths(widths: ColumnWidths) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
}
