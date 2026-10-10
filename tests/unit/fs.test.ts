import { describe, expect, it } from 'vitest';
import { freeName } from '../../src/fs';

describe('freeName', () => {
  it('keeps a name that is free', () => {
    expect(freeName('case-image-001.jpg', new Set(['other.jpg']))).toBe('case-image-001.jpg');
  });

  it('adds the first free number before the extension', () => {
    expect(freeName('case-image-001.jpg', new Set(['case-image-001.jpg']))).toBe('case-image-001 (2).jpg');
    expect(freeName('case-image-001.jpg', new Set(['case-image-001.jpg', 'case-image-001 (2).jpg']))).toBe('case-image-001 (3).jpg');
  });

  it('copes with names that have no extension or only a leading dot', () => {
    expect(freeName('notes', new Set(['notes']))).toBe('notes (2)');
    expect(freeName('.hidden', new Set(['.hidden']))).toBe('.hidden (2)');
  });

  it('only changes the last extension', () => {
    expect(freeName('a.b.png', new Set(['a.b.png']))).toBe('a.b (2).png');
  });
});
