import type { BBox, Box, BoxSource, BoxStatus, Rect } from '../types';

let n = 1;
export const boxId = () => `b${n++}`;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function clampRect<T extends Rect>(r: T): T {
  const x = clamp01(Math.min(r.x, r.x + r.w));
  const y = clamp01(Math.min(r.y, r.y + r.h));
  const x1 = clamp01(Math.max(r.x, r.x + r.w));
  const y1 = clamp01(Math.max(r.y, r.y + r.h));
  return { ...r, x, y, w: x1 - x, h: y1 - y };
}

export function makeBox(r: Rect, source: BoxSource, status: BoxStatus = 'accepted', reason?: string): Box {
  return clampRect({ id: boxId(), x: r.x, y: r.y, w: r.w, h: r.h, source, status, reason });
}

export const pxToRect = (b: BBox, w: number, h: number): Rect => ({
  x: b.x0 / w,
  y: b.y0 / h,
  w: (b.x1 - b.x0) / w,
  h: (b.y1 - b.y0) / h,
});

export const rectToPx = (r: Rect, w: number, h: number): BBox => ({
  x0: r.x * w,
  y0: r.y * h,
  x1: (r.x + r.w) * w,
  y1: (r.y + r.h) * h,
});
