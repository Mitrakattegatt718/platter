/** Per-day play counts for the listening-activity heatmap.
 *
 * The iPod keeps no play history — only a lifetime counter and a single
 * last-played date per track — so the calendar is reconstructed two ways:
 *
 *  - Seed: on first sight of a library, every played track contributes one
 *    play to its last-played day ("this song was definitely played then").
 *  - Log: each later snapshot's total-plays growth over the stored baseline
 *    is credited to the current day. Plays only ever reach us when the
 *    device connects, so the sync day is the finest honest resolution.
 *
 * State persists in localStorage, keyed by mount point so two iPods don't
 * share a calendar. */
import type { Track } from "./types";

const PREFIX = "platter.activity.v1.";

interface ActivityState {
  byDay: Record<string, number>;
  lastTotal: number;
  seeded: boolean;
}

/** Local YYYY-MM-DD — the calendar buckets by wall-clock days, not UTC. */
export function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

function load(mountPoint: string): ActivityState {
  try {
    const raw = localStorage.getItem(PREFIX + mountPoint);
    if (raw) return JSON.parse(raw) as ActivityState;
  } catch {
    // Corrupt or unavailable storage — start clean.
  }
  return { byDay: {}, lastTotal: 0, seeded: false };
}

function save(mountPoint: string, state: ActivityState): void {
  try {
    localStorage.setItem(PREFIX + mountPoint, JSON.stringify(state));
  } catch {
    // Full or blocked storage: lose the log rather than break opening a
    // library.
  }
}

// Devices with unset clocks report epoch-0 or future dates; both would
// poison the calendar's ends, so seeding only accepts plausible dates.
const MIN_EPOCH_S = Date.UTC(2005, 0, 1) / 1000;

function totalPlays(tracks: Track[]): number {
  let total = 0;
  for (const t of tracks) total += Math.max(0, t.playCount);
  return total;
}

/** Merge a fresh snapshot into the stored log: seed once, then credit any
 * play-count growth to today. Idempotent for a repeated snapshot (delta 0),
 * and never writes negative plays — a shrunk total (deleted tracks, a
 * different library at the same mount) just re-baselines. */
export function recordActivity(tracks: Track[], mountPoint: string): void {
  const state = load(mountPoint);
  const total = totalPlays(tracks);
  if (!state.seeded) {
    const maxEpochS = Date.now() / 1000 + 86_400; // one day of clock slack
    for (const t of tracks) {
      if (t.playCount <= 0 || t.lastPlayed === null) continue;
      if (t.lastPlayed < MIN_EPOCH_S || t.lastPlayed > maxEpochS) continue;
      const key = dayKey(new Date(t.lastPlayed * 1000));
      state.byDay[key] = (state.byDay[key] ?? 0) + 1;
    }
    state.seeded = true;
  } else if (total > state.lastTotal) {
    const key = dayKey(new Date());
    state.byDay[key] = (state.byDay[key] ?? 0) + (total - state.lastTotal);
  }
  state.lastTotal = total;
  save(mountPoint, state);
}

/** The merged day → plays calendar for a mounted library. */
export function readActivity(mountPoint: string): Record<string, number> {
  return { ...load(mountPoint).byDay };
}
