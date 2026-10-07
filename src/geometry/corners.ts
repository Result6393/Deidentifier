import type { Pt } from '../types';

/** Default quad: the whole image with a small inset, normalised. */
export function defaultQuad(inset = 0.02): Pt[] {
  return [
    { x: inset, y: inset },
    { x: 1 - inset, y: inset },
    { x: 1 - inset, y: 1 - inset },
    { x: inset, y: 1 - inset },
  ];
}

function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Guesses the corners (TL, TR, BR, BL, normalised) of the page or screen in a
 * small RGBA image: the largest bright connected region, with its corners
 * taken as the extreme points along each diagonal. Falls back to the whole
 * image when nothing convincing is found. Always user-adjustable.
 */
export function detectQuad(rgba: Uint8ClampedArray, w: number, h: number): Pt[] {
  const n = w * h;
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  }
  const t = otsu(gray);
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let bestLabel = -1;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || gray[start] <= t) continue;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    label[start] = next;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of neighbours) {
        if (j < 0 || j >= n || label[j] !== -1 || gray[j] <= t) continue;
        label[j] = next;
        stack[top++] = j;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
    next++;
  }
  if (bestLabel < 0 || bestSize < n * 0.2) return defaultQuad();

  let tl = { s: Infinity, x: 0, y: 0 };
  let br = { s: -Infinity, x: 0, y: 0 };
  let tr = { s: -Infinity, x: 0, y: 0 };
  let bl = { s: Infinity, x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    if (label[i] !== bestLabel) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x + y < tl.s) tl = { s: x + y, x, y };
    if (x + y > br.s) br = { s: x + y, x, y };
    if (x - y > tr.s) tr = { s: x - y, x, y };
    if (x - y < bl.s) bl = { s: x - y, x, y };
  }
  const norm = (p: { x: number; y: number }): Pt => ({ x: p.x / (w - 1), y: p.y / (h - 1) });
  return [norm(tl), norm(tr), norm(br), norm(bl)];
}
