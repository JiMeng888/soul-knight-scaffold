export interface Vec2 { x: number; y: number }

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export const len = (x: number, y: number): number => Math.hypot(x, y);

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export function normalize(x: number, y: number): Vec2 {
  const l = Math.hypot(x, y);
  return l > 1e-6 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

export const angleOf = (x: number, y: number): number => Math.atan2(y, x);

/** 把角度差收敛到 [-PI, PI]，用于扇区判定与转向。 */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const circleHit = (
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
): boolean => {
  const r = ar + br;
  return dist2(ax, ay, bx, by) <= r * r;
};

/** 圆 vs 轴对齐矩形（格子墙）。用最近点法，避免方形角色卡角。 */
export function circleRect(
  cx: number, cy: number, r: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  return dist2(cx, cy, nx, ny) < r * r;
}

/** 点是否落在以 (cx,cy) 为顶点、angle 为中线、half 为半角的扇区内。 */
export function inArc(
  px: number, py: number,
  cx: number, cy: number,
  angle: number, half: number, radius: number,
): boolean {
  const dx = px - cx;
  const dy = py - cy;
  if (dx * dx + dy * dy > radius * radius) return false;
  return Math.abs(angleDiff(Math.atan2(dy, dx), angle)) <= half;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
