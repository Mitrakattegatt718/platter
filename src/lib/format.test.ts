import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  formatIpodPath,
  formatRating,
  formatSampleRate,
} from "./format";

describe("formatBytes", () => {
  it("uses decimal units and drops to plain bytes under 1 kB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.00 KB");
  });

  it("narrows the fraction as the number grows", () => {
    expect(formatBytes(5_120)).toBe("5.12 KB");
    expect(formatBytes(24_500_000)).toBe("24.5 MB");
    expect(formatBytes(128_000_000)).toBe("128 MB");
    expect(formatBytes(3_420_000_000)).toBe("3.42 GB");
  });
});

describe("formatDuration", () => {
  it("renders m:ss with a zero-padded seconds field", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9_000)).toBe("0:09");
    expect(formatDuration(215_000)).toBe("3:35");
  });

  it("counts past an hour in minutes rather than switching format", () => {
    expect(formatDuration(3_600_000)).toBe("60:00");
  });

  it("truncates sub-second remainders instead of rounding up", () => {
    expect(formatDuration(1_999)).toBe("0:01");
  });
});

describe("formatSampleRate", () => {
  it("keeps one decimal only when the kHz value needs it", () => {
    expect(formatSampleRate(44_100)).toBe("44.1 kHz");
    expect(formatSampleRate(48_000)).toBe("48 kHz");
  });

  it("shows a dash when the database recorded nothing", () => {
    expect(formatSampleRate(0)).toBe("—");
  });
});

describe("formatRating", () => {
  it("renders filled and empty stars in steps of 20", () => {
    expect(formatRating(100)).toBe("★★★★★");
    expect(formatRating(60)).toBe("★★★☆☆");
  });

  it("rounds half-stars down — the Classic cannot display them", () => {
    expect(formatRating(50)).toBe("★★☆☆☆");
  });

  it("shows a dash when unrated, and never exceeds five stars", () => {
    expect(formatRating(0)).toBe("—");
    expect(formatRating(200)).toBe("★★★★★");
  });
});

describe("formatIpodPath", () => {
  it("turns the database's colon form into a readable path", () => {
    expect(formatIpodPath(":iPod_Control:Music:F04:ABCD.mp3")).toBe(
      "/iPod_Control/Music/F04/ABCD.mp3",
    );
  });

  it("shows a dash for an empty path", () => {
    expect(formatIpodPath("")).toBe("—");
  });
});
