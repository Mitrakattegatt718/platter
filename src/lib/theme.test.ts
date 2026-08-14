import { describe, expect, it } from "vitest";
import { normalizeThemePref, resolveAppearance, THEME_LABELS } from "./theme";

describe("normalizeThemePref", () => {
  it("keeps the three real values", () => {
    expect(normalizeThemePref("system")).toBe("system");
    expect(normalizeThemePref("light")).toBe("light");
    expect(normalizeThemePref("dark")).toBe("dark");
  });

  it("falls back to system for anything else", () => {
    // A first run, a hand-edited value, or a preference written by a build
    // that offered an option this one doesn't. None may leave the app in an
    // appearance the picker has no tile for.
    expect(normalizeThemePref(null)).toBe("system");
    expect(normalizeThemePref(undefined)).toBe("system");
    expect(normalizeThemePref("")).toBe("system");
    expect(normalizeThemePref("Dark")).toBe("system");
    expect(normalizeThemePref("sepia")).toBe("system");
  });
});

describe("resolveAppearance", () => {
  it("follows the system only when the preference is system", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });

  it("ignores the system once an appearance is pinned", () => {
    // The bug this guards: wiring the media listener so it repaints
    // unconditionally, which quietly overrides an explicit choice the moment
    // macOS switches at sunset.
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("light", false)).toBe("light");
    expect(resolveAppearance("dark", true)).toBe("dark");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });
});

describe("THEME_LABELS", () => {
  it("labels every preference the picker can produce", () => {
    expect(Object.keys(THEME_LABELS).sort()).toEqual(["dark", "light", "system"]);
    expect(Object.values(THEME_LABELS).every((l) => l.length > 0)).toBe(true);
  });
});
