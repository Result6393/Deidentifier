import { beforeEach, describe, expect, it } from 'vitest';
import {
  deletePreset,
  getDefaultId,
  listPresets,
  migrateLegacy,
  presetBoxes,
  sanitise,
  savePreset,
  setDefault,
  startingPreset,
} from '../../src/presets/templates';
import { DEFAULT_PRESETS } from '../../src/presets/defaults';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const box = { x: 0.5, y: 0, w: 0.5, h: 0.2 };

describe('sanitise', () => {
  it('keeps only valid presets: geometry and a short name, nothing else', () => {
    const raw = {
      notes: {
        defaultId: 'a1',
        presets: [
          { id: 'a1', name: '  Clinic A  ', boxes: [{ ...box, stamp: 'TESTPERSON' }, { x: 2, y: 0, w: 0.1, h: 0.1 }, { x: '0.1', y: 0, w: 1, h: 1 }] },
          { id: 'bad id!', name: 'x', boxes: [box] },
          { id: 'a1', name: 'duplicate id', boxes: [box] },
          { id: 'a2', name: '   ', boxes: [box] },
        ],
      },
      cirrus: 'not an object',
      unknown: { defaultId: null, presets: [] },
    };
    const out = sanitise(raw);
    expect(out).toEqual({ notes: { defaultId: 'a1', presets: [{ id: 'a1', name: 'Clinic A', boxes: [box] }] } });
    expect(JSON.stringify(out)).not.toContain('TESTPERSON');
  });

  it('drops a default that points at a missing preset', () => {
    expect(sanitise({ notes: { defaultId: 'gone', presets: [] } }).notes?.defaultId).toBeNull();
  });

  it('tolerates garbage', () => {
    expect(sanitise(null)).toEqual({});
    expect(sanitise('x')).toEqual({});
  });
});

describe('migrateLegacy', () => {
  it('turns the old single layout per type into a default preset', () => {
    const out = migrateLegacy({ notes: [box, { x: 9, y: 0, w: 1, h: 1 }], junk: 1 });
    expect(out.notes).toEqual({ defaultId: 'legacy', presets: [{ id: 'legacy', name: 'My layout', boxes: [box] }] });
  });

  it('is used when only the old key exists', () => {
    store.clear();
    store.set('deidentifier.templates.v1', JSON.stringify({ cirrus: [box] }));
    expect(startingPreset('cirrus')).toBe('legacy');
    expect(presetBoxes('cirrus', 'legacy')).toEqual([box]);
  });
});

describe('saved presets', () => {
  beforeEach(() => store.clear());

  it('falls back to the built-in layout', () => {
    expect(presetBoxes('notes', null)).toEqual(DEFAULT_PRESETS.notes);
    expect(startingPreset('notes')).toBeNull();
  });

  it('saves several presets per type and tracks the default', () => {
    const a = savePreset('notes', 'Clinic A', [box]);
    const b = savePreset('notes', 'Clinic B', [{ x: 0, y: 0, w: 0.4, h: 0.2 }]);
    expect(listPresets('notes').map((p) => p.name)).toEqual(['Clinic A', 'Clinic B']);
    expect(presetBoxes('notes', b.id)).toEqual([{ x: 0, y: 0, w: 0.4, h: 0.2 }]);
    expect(listPresets('cirrus')).toEqual([]);

    setDefault('notes', a.id);
    expect(startingPreset('notes')).toBe(a.id);
    setDefault('notes', null);
    expect(startingPreset('notes')).toBeNull();
  });

  it('updates a preset in place and keeps its name', () => {
    const a = savePreset('optos1', 'Mine', [box]);
    savePreset('optos1', '', [{ x: 0, y: 0, w: 1, h: 0.1 }], a.id);
    expect(listPresets('optos1')).toEqual([{ id: a.id, name: 'Mine', boxes: [{ x: 0, y: 0, w: 1, h: 0.1 }] }]);
  });

  it('clears the default when its preset is deleted', () => {
    const a = savePreset('notes', 'A', [box]);
    setDefault('notes', a.id);
    deletePreset('notes', a.id);
    expect(listPresets('notes')).toEqual([]);
    expect(getDefaultId('notes')).toBeNull();
    expect(presetBoxes('notes', a.id)).toEqual(DEFAULT_PRESETS.notes);
  });

  it('never stores anything but geometry', () => {
    savePreset('notes', 'Clinic A', [{ ...box, stamp: 'TESTPERSON', id: 'b1' } as never]);
    expect(store.get('deidentifier.presets.v2')).not.toContain('TESTPERSON');
    expect(store.get('deidentifier.presets.v2')).not.toContain('"stamp"');
  });
});
