/** UI appearance: follow macOS, or pin light/dark.
 *
 * Stored in localStorage rather than the backend `settings.json` that holds the
 * app icon, and the split is deliberate. The icon has to be known *before* a
 * webview exists, so it lives on the Rust side. The theme is the opposite: it
 * has to be applied synchronously, before React's first paint, and an IPC round
 * trip is async. The window stays hidden until that first frame commits
 * (App.tsx), so a synchronous read here means launch never flashes the wrong
 * appearance.
 *
 * The DOM-free half of this module is what `theme.test.ts` covers; vitest runs
 * without a browser. */

export type ThemePref = "system" | "light" | "dark";
export type Appearance = "light" | "dark";

const STORAGE_KEY = "theme";

export const THEME_LABELS: Record<ThemePref, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** Anything unrecognised means "system" — a hand-edited or stale value must not
 * leave the app stuck in an appearance the picker can't represent. */
export function normalizeThemePref(raw: string | null | undefined): ThemePref {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function resolveAppearance(
  pref: ThemePref,
  systemPrefersDark: boolean,
): Appearance {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

// ---------------------------------------------------------------- DOM side

export function readThemePref(): ThemePref {
  return normalizeThemePref(localStorage.getItem(STORAGE_KEY));
}

function systemQuery(): MediaQueryList {
  return window.matchMedia("(prefers-color-scheme: dark)");
}

function paint(pref: ThemePref) {
  const appearance = resolveAppearance(pref, systemQuery().matches);
  document.documentElement.classList.toggle("dark", appearance === "dark");
}

/** Applies the stored preference and keeps following the system while the
 * preference is "system". One listener for the process lifetime: it re-reads
 * the preference on every change, so switching to and from "system" needs no
 * subscribe/unsubscribe bookkeeping. */
export function initTheme() {
  paint(readThemePref());
  systemQuery().addEventListener("change", () => paint(readThemePref()));
}

export function setThemePref(pref: ThemePref) {
  localStorage.setItem(STORAGE_KEY, pref);
  paint(pref);
}
