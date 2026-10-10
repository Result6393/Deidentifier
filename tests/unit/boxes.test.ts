import { describe, expect, it } from 'vitest';
import { clampRect, makeBox } from '../../src/editor/boxes';

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
});
