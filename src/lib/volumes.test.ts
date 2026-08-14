import { describe, expect, it } from "vitest";
import { partitionVolumes, volumeCapacity, volumeLabel, volumeSubtitle } from "./volumes";
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

describe("volumeSubtitle", () => {
  it("names the model and generation, restoring the iPod prefix", () => {
    // libgpod's own model string omits "iPod": "Classic (Black)".
    expect(
      volumeSubtitle(
        volume({
          path: "/Volumes/PODSIM",
          isIpod: true,
          model: "Classic (Black)",
          generation: "Sixth Generation",
          family: "classic",
        }),
      ),
    ).toBe("iPod Classic (Black) · Sixth Generation");
  });

  it("drops a generation that only repeats the model name", () => {
    // Real fixture data: libgpod reports model "Classic (Silver)" alongside
    // generation "Classic", and printing both gives "Classic (Silver) ·
    // Classic" — the same word twice, dressed up as two facts.
    expect(
      volumeSubtitle(
        volume({
          path: "/Volumes/PODCLASSIC",
          isIpod: true,
          model: "Classic (Silver)",
          generation: "Classic",
        }),
      ),
    ).toBe("iPod Classic (Silver)");
    expect(
      volumeSubtitle(
        volume({
          path: "/Volumes/PODTOUCH",
          isIpod: true,
          model: "Touch (Silver)",
          generation: "Touch",
        }),
      ),
    ).toBe("iPod Touch (Silver)");
  });

  it("keeps the part of the generation the model does not already say", () => {
    // "Shuffle (2nd Gen.)" against model "Shuffle (Silver)": the repeated word
    // goes, the generation number stays — it is the only thing distinguishing
    // a 2nd-gen Shuffle (supported) from a 4th (not).
    expect(
      volumeSubtitle(
        volume({
          path: "/Volumes/PODSHUFFLE",
          isIpod: true,
          model: "Shuffle (Silver)",
          generation: "Shuffle (2nd Gen.)",
        }),
      ),
    ).toBe("iPod Shuffle (Silver) · 2nd Gen.");
  });

  it("drops libgpod's Unknown placeholders rather than printing them", () => {
    // itdb_info_get_ipod_generation_string returns the literal "Unknown" for
    // an unidentified device. Showing it reads as a value the device reported.
    expect(
      volumeSubtitle(
        volume({
          path: "/Volumes/PODSIM",
          isIpod: true,
          model: "Classic (Black)",
          generation: "Unknown",
        }),
      ),
    ).toBe("iPod Classic (Black)");
  });

  it("falls back to the family slug when there is no model name", () => {
    expect(
      volumeSubtitle(volume({ path: "/Volumes/P", isIpod: true, family: "classic" })),
    ).toBe("iPod Classic");
  });

  it("says so plainly when the device identified as nothing at all", () => {
    // A Classic with a wiped SysInfo still has to be connectable, so this is
    // a real state and not an error.
    expect(volumeSubtitle(volume({ path: "/Volumes/P", isIpod: true }))).toBe(
      "iPod · unidentified",
    );
    expect(
      volumeSubtitle(volume({ path: "/Volumes/P", isIpod: true, family: "unknown" })),
    ).toBe("iPod · unidentified");
  });

  it("says nothing about an ordinary volume mounted where they all are", () => {
    // The row already shows "MOCKUSB"; a second line reading
    // "/Volumes/MOCKUSB" is the same string with a prefix, and costs a line of
    // menu height to say it.
    expect(volumeSubtitle(volume({ path: "/Volumes/MOCKUSB" }))).toBe("");
  });

  it("shows the path of an ordinary volume mounted somewhere unusual", () => {
    expect(volumeSubtitle(volume({ path: "/mnt/scratch" }))).toBe("/mnt/scratch");
  });
});

describe("volumeCapacity", () => {
  it("reports free against total when both are known", () => {
    expect(
      volumeCapacity(volume({ path: "/p", freeBytes: 42_000_000_000, totalBytes: 160_000_000_000 })),
    ).toBe("42.0 GB free of 160 GB");
  });

  it("reports whichever half is known on its own", () => {
    expect(volumeCapacity(volume({ path: "/p", totalBytes: 160_000_000_000 }))).toBe("160 GB");
    expect(volumeCapacity(volume({ path: "/p", freeBytes: 42_000_000_000 }))).toBe("42.0 GB free");
  });

  it("says nothing when statfs failed", () => {
    // Empty, not "0 B": zero free space and "couldn't ask" must never look
    // the same — one blocks an import, the other means we don't know.
    expect(volumeCapacity(volume({ path: "/p" }))).toBe("");
  });
});
