import { describe, expect, it } from "vitest";
import { partitionVolumes, volumeLabel } from "./volumes";
import { volume } from "./testing";

describe("volumeLabel", () => {
  it("reduces a mount point to the name Finder shows", () => {
    expect(volumeLabel("/Volumes/PODSIM")).toBe("PODSIM");
    expect(volumeLabel("/Volumes/Ilia drive")).toBe("Ilia drive");
  });

  it("ignores a trailing slash", () => {
    expect(volumeLabel("/Volumes/PODSIM/")).toBe("PODSIM");
  });

  it("falls back to the input when there is no name to take", () => {
    // "/" trims to the empty string, and an empty toolbar label reads as a
    // rendering bug rather than as the root volume.
    expect(volumeLabel("/")).toBe("/");
    expect(volumeLabel("")).toBe("");
  });
});

describe("partitionVolumes", () => {
  it("splits iPods from everything else", () => {
    const { ipods, others } = partitionVolumes([
      volume({ path: "/Volumes/MOCKUSB" }),
      volume({ path: "/Volumes/PODSIM", isIpod: true }),
      volume({ path: "/Volumes/PODCLASSIC", isIpod: true }),
    ]);
    expect(ipods.map((v) => v.path)).toEqual(["/Volumes/PODSIM", "/Volumes/PODCLASSIC"]);
    expect(others.map((v) => v.path)).toEqual(["/Volumes/MOCKUSB"]);
  });

  it("keeps the order list_volumes returned inside each section", () => {
    // /Volumes order is stable between opens; re-sorting would make rows jump
    // around under the pointer as the menu reopens.
    const { ipods } = partitionVolumes([
      volume({ path: "/Volumes/Z", isIpod: true }),
      volume({ path: "/Volumes/A", isIpod: true }),
    ]);
    expect(ipods.map((v) => v.path)).toEqual(["/Volumes/Z", "/Volumes/A"]);
  });

  it("returns empty sections for an empty list", () => {
    expect(partitionVolumes([])).toEqual({ ipods: [], others: [] });
  });

  it("keeps unsupported devices in the iPods section", () => {
    // A Shuffle is still an iPod. It is shown and disabled, not hidden —
    // hiding it turns "this device is not supported" into "PodSync did not
    // see my iPod", which is a worse bug report.
    const { ipods } = partitionVolumes([
      volume({ path: "/Volumes/PODSHUFFLE", isIpod: true, unsupported: true }),
    ]);
    expect(ipods).toHaveLength(1);
  });
});
