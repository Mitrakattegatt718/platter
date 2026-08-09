/** Renders the listening stats as a PNG for sharing. Drawn with the 2D canvas
 * API rather than rasterizing the DOM: an offscreen render is deterministic,
 * crisp (2×), and doesn't depend on a rasterizer understanding oklch tokens.
 * Colors are hardcoded parallels of index.css's light/dark tokens — canvas
 * fillStyle can't promise oklch across engines. */
import { formatCount, formatListenTime, type ListeningStats, type RankedItem } from "./stats";

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  /** The bar fill; primary at low alpha against the background. */
  bar: string;
  hairline: string;
}

/** Parallels of the :root tokens in index.css. */
const LIGHT: Palette = {
  bg: "#ffffff",
  fg: "#161617",
  muted: "#545457",
  bar: "rgba(66, 105, 245, 0.14)",
  hairline: "rgba(22, 22, 23, 0.12)",
};

/** Parallels of the .dark tokens — dark grey, not black, like the window. */
const DARK: Palette = {
  bg: "#2a2a2c",
  fg: "#f5f5f5",
  muted: "#a4a4a8",
  bar: "rgba(113, 144, 240, 0.22)",
  hairline: "rgba(255, 255, 255, 0.12)",
};

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
const W = 640;
const PAD = 44;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Truncates with an ellipsis to fit `maxWidth` in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const letters = [...text];
  while (letters.length > 1 && ctx.measureText(letters.join("") + "…").width > maxWidth) {
    letters.pop();
  }
  return letters.join("").trimEnd() + "…";
}

function drawRanking(
  ctx: CanvasRenderingContext2D,
  items: RankedItem[],
  x: number,
  y: number,
  width: number,
  p: Palette,
): number {
  const rowH = 30;
  const max = Math.max(...items.map((i) => i.plays), 1);
  for (const item of items) {
    const frac = Math.max(0.06, item.plays / max); // keep rank 10 visible
    ctx.fillStyle = p.bar;
    roundRect(ctx, x, y, width * frac, rowH - 8, 5);
    ctx.fill();

    const rowY = y + (rowH - 8) / 2 + 4.5;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillStyle = p.fg;
    const label = item.subtitle ? `${item.name} — ${item.subtitle}` : item.name;
    ctx.fillText(fit(ctx, label, width - 76), x + 8, rowY);

    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(formatCount(item.plays), x + width - 4, rowY);
    ctx.textAlign = "left";
    y += rowH;
  }
  return y;
}

function sectionHeading(ctx: CanvasRenderingContext2D, text: string, y: number, p: Palette) {
  ctx.font = `600 12px ${FONT}`;
  ctx.fillStyle = p.muted;
  ctx.fillText(text, PAD, y);
  return y + 14;
}

/** Draws the card and resolves with a PNG blob; null when canvas/blobbing is
 * unavailable (headless contexts). `covers` are data URLs for the top albums —
 * up to five, skipped cleanly when the library has no art. */
export async function renderShareCard(
  stats: ListeningStats,
  deviceName: string | null,
  covers: string[] = [],
): Promise<Blob | null> {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const p = dark ? DARK : LIGHT;
  const artists = stats.topArtists.slice(0, 5);
  const tracks = stats.topTracks.slice(0, 5);

  // Decode covers up front so failed images shrink the strip rather than
  // leaving holes in it.
  const imgs: HTMLImageElement[] = [];
  for (const url of covers.slice(0, 5)) {
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      imgs.push(img);
    } catch {
      // one broken cover shouldn't sink the export
    }
  }

  const coverH = imgs.length > 0 ? 96 : 0;
  const dpr = 2;
  const metricsY =
    PAD + 34 /* title */ + coverH + (coverH > 0 ? 18 : 0) + 6 /* gap */ + 58; /* metrics block */
  let height = metricsY + 26; // breathing room after metrics
  if (artists.length > 0) height += 14 + artists.length * 30;
  if (tracks.length > 0) height += 18 + 14 + tracks.length * 30;
  height += 34; // footer
  height += 12; // bottom pad

  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, height);

  // Header: quiet fact, not a poster title.
  ctx.font = `600 18px ${FONT}`;
  ctx.fillStyle = p.fg;
  ctx.fillText("Listening Stats", PAD, PAD);
  ctx.font = `500 12px ${FONT}`;
  ctx.fillStyle = p.muted;
  const date = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  ctx.fillText([deviceName, date].filter(Boolean).join(" · "), PAD, PAD + 18);

  // Cover strip: the five most-played albums, evenly spaced squares.
  if (imgs.length > 0) {
    const size = 96;
    const gap = (W - PAD * 2 - imgs.length * size) / Math.max(imgs.length - 1, 1);
    imgs.forEach((img, i) => {
      const x = PAD + i * (size + gap);
      const y = PAD + 34;
      ctx.save();
      roundRect(ctx, x, y, size, size, 8);
      ctx.clip();
      // object-cover behavior: scale to fill the square, centered.
      const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, x - (dw - size) / 2, y - (dh - size) / 2, dw, dh);
      ctx.restore();
    });
  }

  // Metrics row, label over value.
  const playedPct =
    stats.totalTracks > 0
      ? Math.round((stats.playedTracks / stats.totalTracks) * 100)
      : 0;
  const metrics: [string, string][] = [
    ["Plays", formatCount(stats.totalPlays)],
    ["Listening time", formatListenTime(stats.listenMs)],
    ["Tracks played", `${formatCount(stats.playedTracks)} of ${formatCount(stats.totalTracks)}`],
    ["Library coverage", `${playedPct}%`],
  ];
  const colW = (W - PAD * 2) / metrics.length;
  let y = metricsY;
  metrics.forEach(([label, value], i) => {
    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = p.muted;
    ctx.fillText(label, PAD + i * colW, y);
    ctx.font = `600 17px ${FONT}`;
    ctx.fillStyle = p.fg;
    ctx.fillText(value, PAD + i * colW, y + 20);
  });
  y += 34;

  ctx.strokeStyle = p.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y + 0.5);
  ctx.lineTo(W - PAD, y + 0.5);
  ctx.stroke();
  y += 6;

  if (artists.length > 0) {
    y = sectionHeading(ctx, "Top Artists", y + 12, p);
    y = drawRanking(ctx, artists, PAD, y, W - PAD * 2, p);
  }
  if (tracks.length > 0) {
    y = sectionHeading(ctx, "Top Tracks", y + 18, p);
    y = drawRanking(ctx, tracks, PAD, y, W - PAD * 2, p);
  }

  ctx.font = `500 10px ${FONT}`;
  ctx.fillStyle = p.muted;
  ctx.fillText("Play counts recorded by the iPod · synced by PodSync", PAD, height - 18);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** Writes a PNG to the system clipboard; false when the webview lacks the
 * async image clipboard API or the write was refused. */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    const item = new ClipboardItem({ "image/png": blob });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}
