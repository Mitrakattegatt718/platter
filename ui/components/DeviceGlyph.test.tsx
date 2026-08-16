import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceGlyph } from "./DeviceGlyph";

const draw = (family: string | null) =>
  renderToStaticMarkup(<DeviceGlyph family={family} />);

/** Every slug `family_slug` in tauri-src/bridging/GpodHelpers.c can return.
 * The mapping is a contract across the FFI boundary that nothing else checks:
 * a slug renamed in C shows up here as a row of fallback bodies rather than a
 * compile error. */
const SLUGS = [
  "classic",
  "shuffle",
  "nano",
  "mini",
  "video",
  "color",
  "regular",
  "touch",
  "iphone",
  "ipad",
  "mobile",
  "unknown",
];

describe("DeviceGlyph", () => {
  it("draws something for every family libgpod reports", () => {
    for (const slug of SLUGS) {
      expect(draw(slug), slug).toContain("<svg");
    }
  });

  it("gives each distinct device its own silhouette", () => {
    // The families that are genuinely different objects. `color`, `iphone` and
    // `mobile` are deliberately aliased and so are excluded — they are checked
    // below instead.
    const distinct = ["classic", "shuffle", "nano", "mini", "video", "regular", "touch", "ipad"];
    const drawn = distinct.map(draw);
    expect(new Set(drawn).size).toBe(distinct.length);
  });

  it("aliases the families that share a body", () => {
    // A photo Color is a Video with the same shell, and both iPhone and the
    // ROKR-era "mobile" are slabs. Drawing them apart would invent differences
    // the hardware does not have.
    expect(draw("color")).toBe(draw("video"));
    expect(draw("iphone")).toBe(draw("touch"));
    expect(draw("mobile")).toBe(draw("touch"));
  });

  it("falls back to a plain body rather than nothing", () => {
    // An unidentified iPod still has to look like a device. Both the null the
    // scan produces before it lands and a slug this build has never heard of
    // land on the same mark.
    expect(draw(null)).toBe(draw("unknown"));
    expect(draw("ipod-quantum")).toBe(draw("unknown"));
  });

  it("keeps every mark on the same 24-unit grid", () => {
    // Rows size these with a className; a glyph drawn on its own viewBox would
    // come out a different size from its neighbours at the same class.
    for (const slug of SLUGS) {
      expect(draw(slug), slug).toContain('viewBox="0 0 24 24"');
    }
  });

  it("inherits the row's colour instead of carrying its own", () => {
    // Disabled and selected rows recolour the glyph through currentColor. A
    // hardcoded fill would survive the state change and look broken.
    const markup = draw("classic");
    expect(markup).not.toMatch(/(fill|stroke)="#/);
    expect(markup).toContain("current");
  });
});
