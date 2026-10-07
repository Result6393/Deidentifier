import { describe, expect, it } from 'vitest';
import { sanitise } from '../../src/presets/templates';

describe('template storage', () => {
  it('keeps only box geometry, dropping text, stamps and bad values', () => {
    const raw = {
      notes: [
        { x: 0.5, y: 0, w: 0.5, h: 0.2, stamp: 'TESTPERSON', id: 'b1' },
        { x: 2, y: 0, w: 0.1, h: 0.1 },
        { x: '0.1', y: 0, w: 0.1, h: 0.1 },
      ],
      cirrus: 'not a list',
      unknown: [{ x: 0, y: 0, w: 1, h: 1 }],
    };
    expect(sanitise(raw)).toEqual({ notes: [{ x: 0.5, y: 0, w: 0.5, h: 0.2 }] });
    expect(JSON.stringify(sanitise(raw))).not.toContain('TESTPERSON');
  });

  it('tolerates garbage', () => {
    expect(sanitise(null)).toEqual({});
    expect(sanitise('x')).toEqual({});
  });
});
