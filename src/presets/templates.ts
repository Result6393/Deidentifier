import type { DocType, Rect } from '../types';
import { DEFAULT_PRESETS } from './defaults';

// Saved layouts hold box geometry and a name only: never image content or stamps.
const KEY = 'deidentifier.presets.v2';
const LEGACY_KEY = 'deidentifier.templates.v1';
const TYPES: DocType[] = ['notes', 'optos1', 'optos2', 'cirrus', 'generic'];

export interface Preset {
  id: string;
  name: string;
  boxes: Rect[];
}

interface TypeStore {
  /** The preset new images of this type start with; null means the built-in layout. */
  defaultId: string | null;
  presets: Preset[];
}

type Store = Partial<Record<DocType, TypeStore>>;

const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isRect = (r: unknown): r is Rect => !!r && unit((r as Rect).x) && unit((r as Rect).y) && unit((r as Rect).w) && unit((r as Rect).h);
const cleanRects = (list: unknown): Rect[] => (Array.isArray(list) ? list.filter(isRect).map(({ x, y, w, h }) => ({ x, y, w, h })) : []);
const cleanName = (n: unknown): string => (typeof n === 'string' ? n.trim().slice(0, 40) : '');
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{1,24}$/.test(id);

/** Keeps only well-formed presets: valid ids, short names, rectangles with coordinates in 0..1. */
export function sanitise(raw: unknown): Store {
  const out: Store = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const t of TYPES) {
    const entry = (raw as Record<string, unknown>)[t] as Partial<TypeStore> | undefined;
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.presets)) continue;
    const seen = new Set<string>();
    const presets: Preset[] = [];
    for (const p of entry.presets as Partial<Preset>[]) {
      const name = cleanName(p?.name);
      if (!validId(p?.id) || seen.has(p.id) || !name) continue;
      seen.add(p.id);
      presets.push({ id: p.id, name, boxes: cleanRects(p.boxes) });
    }
    out[t] = { defaultId: typeof entry.defaultId === 'string' && seen.has(entry.defaultId) ? entry.defaultId : null, presets };
  }
  return out;
}

/** Turns the old one-layout-per-type format into a default preset per type. */
export function migrateLegacy(raw: unknown): Store {
  const out: Store = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const t of TYPES) {
    const list = (raw as Record<string, unknown>)[t];
    if (!Array.isArray(list)) continue;
    out[t] = { defaultId: 'legacy', presets: [{ id: 'legacy', name: 'My layout', boxes: cleanRects(list) }] };
  }
  return out;
}

function read(): Store {
  try {
    const v2 = localStorage.getItem(KEY);
    if (v2) return sanitise(JSON.parse(v2));
    const v1 = localStorage.getItem(LEGACY_KEY);
    return v1 ? migrateLegacy(JSON.parse(v1)) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

const entryOf = (store: Store, type: DocType): TypeStore => (store[type] ??= { defaultId: null, presets: [] });

export function listPresets(type: DocType): Preset[] {
  return read()[type]?.presets ?? [];
}

export function getDefaultId(type: DocType): string | null {
  return read()[type]?.defaultId ?? null;
}

/** Box rectangles for a saved preset, or the built-in layout when id is null or unknown. */
export function presetBoxes(type: DocType, id: string | null): Rect[] {
  const found = id ? read()[type]?.presets.find((p) => p.id === id) : undefined;
  return found ? found.boxes : DEFAULT_PRESETS[type];
}

/** The preset id new images of this type start with (null = built-in). */
export function startingPreset(type: DocType): string | null {
  const id = getDefaultId(type);
  return id && listPresets(type).some((p) => p.id === id) ? id : null;
}

const newPresetId = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Saves a new preset (or overwrites `id`) and returns it. */
export function savePreset(type: DocType, name: string, rects: Rect[], id?: string): Preset {
  const store = read();
  const entry = entryOf(store, type);
  const boxes = cleanRects(rects);
  const existing = id ? entry.presets.find((p) => p.id === id) : undefined;
  if (existing) {
    existing.boxes = boxes;
    if (name) existing.name = cleanName(name) || existing.name;
    write(store);
    return existing;
  }
  const preset = { id: newPresetId(), name: cleanName(name) || 'My layout', boxes };
  entry.presets.push(preset);
  write(store);
  return preset;
}

export function setDefault(type: DocType, id: string | null): void {
  const store = read();
  entryOf(store, type).defaultId = id;
  write(store);
}

export function deletePreset(type: DocType, id: string): void {
  const store = read();
  const entry = entryOf(store, type);
  entry.presets = entry.presets.filter((p) => p.id !== id);
  if (entry.defaultId === id) entry.defaultId = null;
  write(store);
}
