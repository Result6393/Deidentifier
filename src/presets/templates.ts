import type { DocType, Rect } from '../types';
import { DEFAULT_PRESETS } from './defaults';

// Templates hold box geometry only: never text, stamps or image content.
const KEY = 'deidentifier.templates.v1';
const TYPES: DocType[] = ['notes', 'optos1', 'optos2', 'cirrus', 'generic'];

type Store = Partial<Record<DocType, Rect[]>>;

const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Keeps only well-formed rectangles with coordinates in 0..1. */
export function sanitise(raw: unknown): Store {
  const out: Store = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const t of TYPES) {
    const list = (raw as Record<string, unknown>)[t];
    if (!Array.isArray(list)) continue;
    out[t] = list
      .filter((r): r is Rect => !!r && unit(r.x) && unit(r.y) && unit(r.w) && unit(r.h))
      .map(({ x, y, w, h }) => ({ x, y, w, h }));
  }
  return out;
}

function read(): Store {
  try {
    return sanitise(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return {};
  }
}

export function hasTemplate(type: DocType): boolean {
  return !!read()[type];
}

export function loadPreset(type: DocType): Rect[] {
  return read()[type] ?? DEFAULT_PRESETS[type];
}

export function saveTemplate(type: DocType, rects: Rect[]): void {
  const store = read();
  store[type] = sanitise({ [type]: rects })[type] ?? [];
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function clearTemplate(type: DocType): void {
  const store = read();
  delete store[type];
  localStorage.setItem(KEY, JSON.stringify(store));
}
