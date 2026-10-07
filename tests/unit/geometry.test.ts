import { describe, expect, it } from 'vitest';
import { apply, flatSize, homography } from '../../src/geometry/homography';
import { warpQuad } from '../../src/geometry/warp';

class FakeImageData {
  data: Uint8ClampedArray;
  constructor(public width: number, public height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}
(globalThis as { ImageData?: unknown }).ImageData ??= FakeImageData;

describe('homography', () => {
  it('maps the four points exactly', () => {
    const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const to = [{ x: 10, y: 5 }, { x: 90, y: 12 }, { x: 95, y: 70 }, { x: 3, y: 60 }];
    const h = homography(from, to);
    from.forEach((p, i) => {
      const q = apply(h, p);
      expect(q.x).toBeCloseTo(to[i].x, 6);
      expect(q.y).toBeCloseTo(to[i].y, 6);
    });
  });

  it('caps the output size', () => {
    const quad = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 0, y: 2000 }];
    expect(flatSize(quad, 3000)).toEqual({ w: 3000, h: 1500 });
  });
});

describe('warpQuad', () => {
  // A bright skewed quad on a dark background flattens to (almost) all bright.
  const W = 120;
  const H = 90;
  const quad = [{ x: 20, y: 15 }, { x: 100, y: 10 }, { x: 105, y: 80 }, { x: 15, y: 75 }];
  const img = new ImageData(W, H);
  const inside = (x: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
    }
    return true;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = inside(x, y) ? 230 : 20;
      img.data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }

  it('flattens the quad', () => {
    const out = warpQuad(img, quad);
    let dark = 0;
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i] < 128) dark++;
    expect(dark / (out.width * out.height)).toBeLessThan(0.05);
  });
});
