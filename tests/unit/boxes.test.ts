import { describe, expect, it } from 'vitest';
import { clampRect, makeBox, rotateRect90 } from '../../src/editor/boxes';

describe('boxes', () => {
  it('normalises drags in any direction and clamps to the image', () => {
    const r = clampRect({ x: 0.6, y: 0.5, w: -0.3, h: 2 });
    expect(r.x).toBeCloseTo(0.3);
    expect(r.w).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.5);
    expect(r.h).toBeCloseTo(0.5);
  });

  it('gives each box a unique id', () => {
    expect(makeBox({ x: 0, y: 0, w: 0.1, h: 0.1 }).id).not.toBe(makeBox({ x: 0, y: 0, w: 0.1, h: 0.1 }).id);
  });

  it('keeps a box on the same part of the picture when rotating 90° clockwise', () => {
    // Top-right corner box moves to the bottom-right corner.
    const r = rotateRect90({ x: 0.7, y: 0, w: 0.3, h: 0.2 });
    expect(r).toEqual({ x: 0.8, y: 0.7, w: 0.2, h: 0.3 });
    // Four turns are the identity.
    let q = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    for (let i = 0; i < 4; i++) q = rotateRect90(q);
    expect(q.x).toBeCloseTo(0.1);
    expect(q.y).toBeCloseTo(0.2);
    expect(q.w).toBeCloseTo(0.3);
    expect(q.h).toBeCloseTo(0.1);
  });
});
