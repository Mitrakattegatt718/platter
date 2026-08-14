/** Per-family device marks for the volume list.
 *
 * One lucide phone for every iPod made the list read as a row of identical
 * rectangles — the thing the user is scanning for (is that the Classic or the
 * Shuffle?) was only in the text. These draw the silhouette instead: a screen
 * over a click wheel for the wheel-era players, a bare wheel for a Shuffle, an
 * all-screen slab for a Touch.
 *
 * Everything is `currentColor`, so a row keeps its own state colour (primary
 * for an iPod, muted for a plain disk) without the glyph knowing about it. The
 * 24×24 box is drawn to survive 16 px: 1.5 stroke units land on ~1 device
 * pixel, and no mark carries detail finer than that.
 *
 * The family strings are libgpod's own slugs, produced by `family_slug` in
 * GpodHelpers.c. Unlisted or missing families fall back to a plain body — an
 * unidentified iPod still has to look like a device, not like an error. */

const BODY = "stroke-current opacity-70";
const SCREEN = "fill-current opacity-30";
const WHEEL = "stroke-current opacity-50";
const DOT = "fill-current opacity-35";

function Svg({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Screen over a click wheel — the shape shared by every wheel-era iPod. The
 * three numbers that vary between them (body width, screen height, wheel size)
 * are the whole difference, so they are parameters rather than three copies. */
function WheelBody({
  className,
  bodyX,
  bodyY,
  screenH,
  wheelR,
  wheelY,
}: {
  className?: string;
  bodyX: number;
  bodyY: number;
  screenH: number;
  wheelR: number;
  wheelY: number;
}) {
  const w = 24 - bodyX * 2;
  const h = 24 - bodyY * 2;
  return (
    <Svg className={className}>
      <rect x={bodyX} y={bodyY} width={w} height={h} rx={2.4} className={BODY} />
      <rect
        x={bodyX + 1.75}
        y={bodyY + 1.75}
        width={w - 3.5}
        height={screenH}
        rx={0.9}
        className={SCREEN}
      />
      <circle cx={12} cy={wheelY} r={wheelR} className={WHEEL} />
      <circle cx={12} cy={wheelY} r={wheelR * 0.29} className={DOT} />
    </Svg>
  );
}

/** All screen, one home button: a Touch, an iPhone, an iPad. */
function SlabBody({ className, bodyX }: { className?: string; bodyX: number }) {
  const w = 24 - bodyX * 2;
  return (
    <Svg className={className}>
      <rect x={bodyX} y={2.25} width={w} height={19.5} rx={2.4} className={BODY} />
      <rect
        x={bodyX + 1.5}
        y={4.25}
        width={w - 3}
        height={13.5}
        rx={0.9}
        className={SCREEN}
      />
      <circle cx={12} cy={19.75} r={1.15} className={WHEEL} />
    </Svg>
  );
}

const GLYPHS: Record<string, (className?: string) => React.ReactElement> = {
  // Tall body, small screen, big wheel.
  classic: (c) => (
    <WheelBody className={c} bodyX={6.25} bodyY={2.25} screenH={5.5} wheelR={3.9} wheelY={15.9} />
  ),
  // The 5G Video and the photo Colors: same body, the screen took the space.
  video: (c) => (
    <WheelBody className={c} bodyX={6.25} bodyY={2.25} screenH={7.5} wheelR={3.3} wheelY={16.6} />
  ),
  // First-generation whites — a wheel that nearly spans the body.
  regular: (c) => (
    <WheelBody className={c} bodyX={5.75} bodyY={2} screenH={4.75} wheelR={4.3} wheelY={15.9} />
  ),
  // Narrow enough to read as "not the Classic" at 16 px.
  nano: (c) => (
    <WheelBody className={c} bodyX={7.75} bodyY={2.5} screenH={5} wheelR={3} wheelY={15.4} />
  ),
  // Short and wide, the way a Mini sits against a Nano.
  mini: (c) => (
    <WheelBody className={c} bodyX={6} bodyY={4.25} screenH={4.5} wheelR={3.4} wheelY={15} />
  ),
  // No screen at all — the one iPod you identify by the wheel alone.
  shuffle: (c) => (
    <Svg className={c}>
      <rect x={5.25} y={5.25} width={13.5} height={13.5} rx={3} className={BODY} />
      <circle cx={12} cy={12} r={4.1} className={WHEEL} />
      <circle cx={12} cy={12} r={1.2} className={DOT} />
    </Svg>
  ),
  touch: (c) => <SlabBody className={c} bodyX={6.75} />,
  ipad: (c) => <SlabBody className={c} bodyX={4.5} />,
  // A body with a screen and nothing else: enough to say "device" without
  // claiming a model we did not identify.
  unknown: (c) => (
    <Svg className={c}>
      <rect x={6.25} y={2.25} width={11.5} height={19.5} rx={2.4} className={BODY} />
      <rect x={8} y={4.5} width={8} height={6} rx={0.9} className={SCREEN} />
    </Svg>
  ),
};

GLYPHS.color = GLYPHS.video;
GLYPHS.iphone = GLYPHS.touch;
GLYPHS.mobile = GLYPHS.touch;

/** The mark for a probed device. `family` is `VolumeInfo.family` — null for a
 * volume libgpod could not place. */
export function DeviceGlyph({
  family,
  className,
}: {
  family: string | null;
  className?: string;
}) {
  const draw = (family && GLYPHS[family]) || GLYPHS.unknown;
  return draw(className);
}
