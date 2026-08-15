/** Decimal units, sizing like Foundation's ByteCountFormatter .file style:
 * "128 KB", "24.5 MB", "3.42 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const u of units) {
    value /= 1000;
    unit = u;
    if (value < 1000) break;
  }
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${unit}`;
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** "12 Mar 2024". Day-month-year in the user's locale, no time: the iPod's
 * clock and timezone offset are unreliable enough that showing an hour would
 * be claiming precision the data doesn't have. */
export function formatDate(unixSeconds: number | null): string {
  if (unixSeconds === null || unixSeconds <= 0) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "44.1 kHz", "48 kHz". */
export function formatSampleRate(hz: number): string {
  if (hz <= 0) return "—";
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

/** The iPod stores 0–100 in steps of 20. Half-stars exist in the format but
 * the Classic's own UI can't set them, so they round down rather than
 * inventing a glyph the device never shows. */
export function formatRating(rating: number): string {
  if (rating <= 0) return "—";
  const stars = Math.min(5, Math.floor(rating / 20));
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

/** ":iPod_Control:Music:F04:ABCD.mp3" → "/iPod_Control/Music/F04/ABCD.mp3".
 * The database's own separator is a colon; nobody reading the panel thinks in
 * those terms. */
export function formatIpodPath(path: string): string {
  if (!path) return "—";
  return path.replace(/:/g, "/");
}
