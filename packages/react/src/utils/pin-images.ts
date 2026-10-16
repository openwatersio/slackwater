import { GAUGE_BUCKETS, PIN_RADIUS, type PinState } from "./pin.js";

/** Drawn at four device pixels per CSS pixel, so the 1.8× station zoom stays sharp on a 2× screen. */
const RATIO = 4;
/** The ink rim every dot and arrow plate is stroked wider by. */
const HALO = 1.5;

const ARROW = { width: 10, height: 13, head: 3.6, cap: 1.2, line: 2.3 };

const GAUGE_BAR = { width: 5.5, height: 15 };
const GAUGE_CARET = 3.2;
const GAUGE_CORNER = 1.2;
/** The stroke that softens the gauge's corners and caret tips. */
const GAUGE_ROUNDING = 0.6;
/** The gauge's rim: the plate is the silhouette grown by this much on every side. */
const GAUGE_RIM = 1.6;
const GAUGE_INFLATE = GAUGE_RIM - GAUGE_ROUNDING / 2;
/** Bar and caret sit exactly one rim apart, so the dark band between them reads as the same shadow. */
const GAUGE_GAP = GAUGE_RIM + GAUGE_ROUNDING / 2;
const GAUGE_HEIGHT = GAUGE_BAR.height + GAUGE_GAP + GAUGE_CARET;

/** The image name a pin draws with: its shape, fill, and trend, so each look is drawn once. */
export function pinImageId(state: PinState, color: string): string {
  const trend = state.tone === "falling" ? "down" : "up";
  return state.shape === "gauge"
    ? `sw-pin|gauge|${state.bucket}|${trend}|${color}`
    : `sw-pin|${state.shape}|${color}`;
}

function canvas(width: number, height: number) {
  const el = document.createElement("canvas");
  el.width = Math.ceil(width * RATIO);
  el.height = Math.ceil(height * RATIO);
  const ctx = el.getContext("2d")!;
  ctx.scale(RATIO, RATIO);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return ctx;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function drawDot(color: string, ink: string) {
  const c = PIN_RADIUS + HALO;
  const ctx = canvas(c * 2, c * 2);
  ctx.fillStyle = ink;
  circle(ctx, c, c, c);
  ctx.fill();
  ctx.fillStyle = color;
  circle(ctx, c, c, PIN_RADIUS);
  ctx.fill();
  return ctx;
}

/** The dot's circle stroked instead of filled: a station with nothing to say. */
function drawRing(color: string, ink: string) {
  const c = PIN_RADIUS + HALO;
  const r = PIN_RADIUS - HALO / 2;
  const ctx = canvas(c * 2, c * 2);
  circle(ctx, c, c, r);
  ctx.strokeStyle = ink;
  ctx.lineWidth = HALO * 3;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = HALO;
  ctx.stroke();
  return ctx;
}

/** S-57's tidal-stream arrow (B-407.4) pointing up, with a smaller head so it doesn't read as all head. */
function drawArrow(color: string, ink: string) {
  const { width: w, height: h, head, cap, line } = ARROW;
  const ctx = canvas(w + HALO * 2, h + HALO * 2);
  ctx.translate(HALO, HALO);
  ctx.beginPath();
  ctx.moveTo(w / 2, h - cap);
  ctx.lineTo(w / 2, cap);
  ctx.moveTo(w / 2 - head, cap + head);
  ctx.lineTo(w / 2, cap);
  ctx.lineTo(w / 2 + head, cap + head);
  ctx.strokeStyle = ink;
  ctx.lineWidth = line + HALO * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = line;
  ctx.stroke();
  return ctx;
}

/** The caret above the bar pointing up when rising, below it pointing down when falling. */
function caret(ctx: CanvasRenderingContext2D, rising: boolean) {
  const { width } = GAUGE_BAR;
  if (rising) {
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width, GAUGE_CARET);
    ctx.lineTo(0, GAUGE_CARET);
  } else {
    ctx.moveTo(0, GAUGE_HEIGHT - GAUGE_CARET);
    ctx.lineTo(width, GAUGE_HEIGHT - GAUGE_CARET);
    ctx.lineTo(width / 2, GAUGE_HEIGHT);
  }
  ctx.closePath();
}

/** A tide gauge: the ink barrel and caret as one plate, then the level and caret in the trend's color. */
function drawGauge(bucket: number, rising: boolean, color: string, ink: string) {
  const pad = GAUGE_INFLATE + GAUGE_ROUNDING / 2;
  const ctx = canvas(GAUGE_BAR.width + pad * 2, GAUGE_HEIGHT + pad * 2);
  ctx.translate(pad, pad);
  const top = rising ? GAUGE_HEIGHT - GAUGE_BAR.height : 0;

  ctx.beginPath();
  ctx.roundRect(0, top, GAUGE_BAR.width, GAUGE_BAR.height, GAUGE_CORNER);
  caret(ctx, rising);
  ctx.fillStyle = ctx.strokeStyle = ink;
  ctx.lineWidth = GAUGE_ROUNDING + GAUGE_INFLATE * 2;
  ctx.fill();
  ctx.stroke();

  // A 2 px floor keeps low water a sliver rather than an empty bar.
  const level = Math.max(2, (GAUGE_BAR.height * bucket) / GAUGE_BUCKETS);
  ctx.beginPath();
  ctx.roundRect(0, top + GAUGE_BAR.height - level, GAUGE_BAR.width, level, GAUGE_CORNER);
  caret(ctx, rising);
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineWidth = GAUGE_ROUNDING;
  ctx.fill();
  ctx.stroke();
  return ctx;
}

/** Draws the image `pinImageId` named, plate and glyph together, or undefined for another image. */
export function drawPinImage(
  id: string,
  ink: string,
): { image: ImageData; pixelRatio: number } | undefined {
  const [prefix, shape, ...rest] = id.split("|");
  if (prefix !== "sw-pin") return undefined;
  const color = rest[rest.length - 1];
  const ctx =
    shape === "gauge"
      ? drawGauge(Number(rest[0]), rest[1] === "up", color, ink)
      : shape === "arrow"
        ? drawArrow(color, ink)
        : shape === "ring"
          ? drawRing(color, ink)
          : drawDot(color, ink);
  const { width, height } = ctx.canvas;
  return { image: ctx.getImageData(0, 0, width, height), pixelRatio: RATIO };
}
