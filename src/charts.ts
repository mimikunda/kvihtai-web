// Charts drawn on canvas: the bar path, the velocity curve, the live trail and
// the path over the set's video. Canvas rather than DOM or SVG because a set
// is hundreds of points and the live trail is redrawn many times a second.

import type { Rise, TrajectoryPoint } from "./api";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface Surface {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

// Size the canvas to its CSS box at the screen's pixel density.
export function surface(canvas: HTMLCanvasElement): Surface | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cw = Math.round(rect.width * dpr);
  const ch = Math.round(rect.height * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, w: rect.width, h: rect.height };
}

// Redraw when the canvas changes size; returns a function that stops watching.
export function redrawOnResize(canvas: HTMLCanvasElement, draw: () => void): () => void {
  const observer = new ResizeObserver(() => draw());
  observer.observe(canvas);
  return () => observer.disconnect();
}

function inRise(t: number, r: Rise): boolean {
  return t >= r.start_ms && t <= r.end_ms;
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(target, 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

// --- bar path ----------------------------------------------------------------------------

export function drawBarPath(
  canvas: HTMLCanvasElement,
  points: TrajectoryPoint[],
  rises: Rise[],
  selected: number | null,
): void {
  const s = surface(canvas);
  if (!s || points.length < 2) return;
  const { ctx, w, h } = s;
  const pad = 14;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x_mm); x1 = Math.max(x1, p.x_mm);
    y0 = Math.min(y0, p.y_mm); y1 = Math.max(y1, p.y_mm);
  }
  // equal scale on both axes, with room for at least 30 cm across so that a
  // straight bar path does not look like a zigzag
  const spanX = Math.max(x1 - x0, 300);
  const spanY = Math.max(y1 - y0, 300);
  const k = Math.min((w - 2 * pad) / spanX, (h - 2 * pad - 14) / spanY);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = (x: number) => w / 2 + (x - cx) * k;
  const Y = (y: number) => (h - 14) / 2 - (y - cy) * k;

  // grid every 10 cm
  ctx.strokeStyle = css("--line");
  ctx.lineWidth = 1;
  const step = 100;
  ctx.beginPath();
  for (let x = Math.ceil((cx - w / 2 / k) / step) * step; X(x) < w; x += step) {
    ctx.moveTo(Math.round(X(x)) + 0.5, 0); ctx.lineTo(Math.round(X(x)) + 0.5, h - 14);
  }
  for (let y = Math.ceil((cy - (h / 2) / k) / step) * step; Y(y) > 0; y += step) {
    ctx.moveTo(0, Math.round(Y(y)) + 0.5); ctx.lineTo(w, Math.round(Y(y)) + 0.5);
  }
  ctx.stroke();

  // plumb line through where the first rep started
  const first = rises[0];
  const startPt = first ? points.find((p) => p.t_ms >= first.start_ms) ?? points[0] : points[0];
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = css("--faint");
  ctx.beginPath();
  ctx.moveTo(X(startPt.x_mm), 0); ctx.lineTo(X(startPt.x_mm), h - 14);
  ctx.stroke();
  ctx.setLineDash([]);

  // the whole path, faint, then each rep on top
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  strokePath(ctx, points, X, Y, css("--faint"), 1.5);
  rises.forEach((r, i) => {
    const seg = points.filter((p) => inRise(p.t_ms, r));
    const dim = selected !== null && selected !== i;
    strokePath(ctx, seg, X, Y, dim ? "rgba(255,122,26,0.28)" : css("--accent"), selected === i ? 3.5 : 2.5);
  });

  // start and highest point
  ctx.fillStyle = css("--text");
  dot(ctx, X(startPt.x_mm), Y(startPt.y_mm), 4);
  const top = points.reduce((a, p) => (p.y_mm > a.y_mm ? p : a), points[0]);
  ctx.fillStyle = css("--accent");
  dot(ctx, X(top.x_mm), Y(top.y_mm), 4);

  // scale bar
  ctx.strokeStyle = css("--muted");
  ctx.fillStyle = css("--muted");
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, h - 6); ctx.lineTo(pad + 100 * k, h - 6);
  ctx.stroke();
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText("10 cm", pad + 100 * k + 6, h - 2);
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: TrajectoryPoint[],
  X: (x: number) => number,
  Y: (y: number) => number,
  color: string,
  width: number,
): void {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let prev: TrajectoryPoint | null = null;
  for (const p of pts) {
    // a gap in the measurements is left as a gap, not bridged by a line
    if (prev === null || p.t_ms - prev.t_ms > 150) ctx.moveTo(X(p.x_mm), Y(p.y_mm));
    else ctx.lineTo(X(p.x_mm), Y(p.y_mm));
    prev = p;
  }
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

// --- velocity over time --------------------------------------------------------------------

export function drawVelocity(
  canvas: HTMLCanvasElement,
  points: TrajectoryPoint[],
  rises: Rise[],
  selected: number | null,
): void {
  const s = surface(canvas);
  const pts = points.filter((p) => p.vy_mps !== null);
  if (!s || pts.length < 2) return;
  const { ctx, w, h } = s;
  const left = 34, right = 8, top = 16, bottom = 20;
  const t0 = points[0].t_ms;
  const tEnd = points[points.length - 1].t_ms;
  let vMin = -0.5, vMax = 1.0;
  for (const p of pts) {
    vMin = Math.min(vMin, p.vy_mps!);
    vMax = Math.max(vMax, p.vy_mps!);
  }
  vMax += 0.15 * (vMax - vMin);
  const X = (t: number) => left + ((t - t0) / Math.max(tEnd - t0, 1)) * (w - left - right);
  const Y = (v: number) => top + ((vMax - v) / (vMax - vMin)) * (h - top - bottom);

  // reps, shaded
  rises.forEach((r, i) => {
    ctx.fillStyle = selected === i ? "rgba(255,122,26,0.26)" : "rgba(255,122,26,0.10)";
    ctx.fillRect(X(r.start_ms), top, X(r.end_ms) - X(r.start_ms), h - top - bottom);
  });

  // axes
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillStyle = css("--muted");
  ctx.strokeStyle = css("--line");
  ctx.lineWidth = 1;
  const vStep = niceStep(vMax - vMin, 4);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = Math.ceil(vMin / vStep) * vStep; v <= vMax; v += vStep) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    ctx.fillText(v.toFixed(1), left - 6, y);
  }
  ctx.strokeStyle = css("--faint");
  ctx.beginPath(); ctx.moveTo(left, Math.round(Y(0)) + 0.5); ctx.lineTo(w - right, Math.round(Y(0)) + 0.5); ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const tStep = niceStep((tEnd - t0) / 1000, 5);
  for (let t = 0; t <= (tEnd - t0) / 1000 + 1e-9; t += tStep) {
    ctx.fillText(`${+t.toFixed(1)}s`, X(t0 + t * 1000), h - 4);
  }

  // the curve
  ctx.strokeStyle = css("--velocity");
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let prev: TrajectoryPoint | null = null;
  for (const p of pts) {
    if (prev === null || p.t_ms - prev.t_ms > 150) ctx.moveTo(X(p.t_ms), Y(p.vy_mps!));
    else ctx.lineTo(X(p.t_ms), Y(p.vy_mps!));
    prev = p;
  }
  ctx.stroke();

  // peaks
  ctx.textAlign = "center";
  rises.forEach((r, i) => {
    const x = X(r.peak_ms), y = Y(r.peak_velocity_mps);
    ctx.fillStyle = selected === null || selected === i ? css("--accent") : "rgba(255,122,26,0.4)";
    dot(ctx, x, y, 3.5);
    ctx.fillStyle = css("--text");
    ctx.fillText(r.peak_velocity_mps.toFixed(2), Math.min(Math.max(x, left + 14), w - 16), Math.max(y - 7, 11));
  });
}

// --- live trail ----------------------------------------------------------------------------

export function drawTrail(canvas: HTMLCanvasElement, trail: { x: number; y: number }[]): void {
  const s = surface(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  if (trail.length === 0) {
    ctx.fillStyle = css("--faint");
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for the bar…", w / 2, h / 2);
    return;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of trail) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const k = Math.min((w - 30) / Math.max(x1 - x0, 400), (h - 30) / Math.max(y1 - y0, 400));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = (x: number) => w / 2 + (x - cx) * k;
  const Y = (y: number) => h / 2 - (y - cy) * k;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const n = trail.length;
  for (let i = 1; i < n; i++) {
    const age = (n - i) / n;
    ctx.strokeStyle = `rgba(255,122,26,${0.2 + 0.8 * (1 - age)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(X(trail[i - 1].x), Y(trail[i - 1].y));
    ctx.lineTo(X(trail[i].x), Y(trail[i].y));
    ctx.stroke();
  }
  const last = trail[n - 1];
  ctx.fillStyle = css("--text");
  dot(ctx, X(last.x), Y(last.y), 6);
}

// --- the path over the video ---------------------------------------------------------------

export function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  points: TrajectoryPoint[],
  frame: [number, number],
  tNow: number,
): void {
  const s = surface(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  // where the picture sits inside the element: object-fit contain
  const vw = video.videoWidth || frame[0], vh = video.videoHeight || frame[1];
  const k = Math.min(w / vw, h / vh);
  const ox = (w - vw * k) / 2, oy = (h - vh * k) / 2;
  const sx = (vw / frame[0]) * k, sy = (vh / frame[1]) * k;
  const shown = points.filter((p) => p.x_px !== undefined && p.t_ms <= tNow);
  if (shown.length < 1) return;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = css("--accent");
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.beginPath();
  let prev: TrajectoryPoint | null = null;
  for (const p of shown) {
    const x = ox + p.x_px! * sx, y = oy + p.y_px! * sy;
    if (prev === null || p.t_ms - prev.t_ms > 150) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    prev = p;
  }
  ctx.stroke();
  const last = shown[shown.length - 1];
  if (tNow - last.t_ms < 100) {
    ctx.fillStyle = css("--text");
    dot(ctx, ox + last.x_px! * sx, oy + last.y_px! * sy, 5);
  }
  ctx.shadowBlur = 0;
}
