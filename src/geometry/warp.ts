import type { Pt } from '../types';
import { apply, flatSize, homography } from './homography';

/**
 * Warps the quad (TL, TR, BR, BL, in source pixels) of `src` to a flat
 * rectangle, using inverse mapping with bilinear sampling.
 */
export function warpQuad(src: ImageData, quad: Pt[], maxEdge = 3000): ImageData {
  const { w, h } = flatSize(quad, maxEdge);
  const dstCorners = [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: w - 1, y: h - 1 },
    { x: 0, y: h - 1 },
  ];
  const hm = homography(dstCorners, quad);
  const out = new ImageData(w, h);
  const s = src.data;
  const d = out.data;
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = apply(hm, { x, y });
      const px = Math.min(Math.max(p.x, 0), sw - 1);
      const py = Math.min(Math.max(p.y, 0), sh - 1);
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = px - x0;
      const fy = py - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * fx;
        const bot = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * fx;
        d[o + c] = top + (bot - top) * fy;
      }
      d[o + 3] = 255;
    }
  }
  return out;
}
