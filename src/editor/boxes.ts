import type { Box, Rect } from '../types';

let n = 1;
export const boxId = () => `b${n++}`;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Normalises a rectangle (any drag direction) and keeps it inside the image. */
export function clampRect<T extends Rect>(r: T): T {
  const x = clamp01(Math.min(r.x, r.x + r.w));
  const y = clamp01(Math.min(r.y, r.y + r.h));
  const x1 = clamp01(Math.max(r.x, r.x + r.w));
  const y1 = clamp01(Math.max(r.y, r.y + r.h));
  return { ...r, x, y, w: x1 - x, h: y1 - y };
}

export function makeBox(r: Rect): Box {
  return clampRect({ id: boxId(), x: r.x, y: r.y, w: r.w, h: r.h });
}
