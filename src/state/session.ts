import type { Box, DocType, Pt, SearchTerms } from '../types';

export interface WorkImage {
  id: string;
  /** Unredacted photo, held in memory only. */
  source: HTMLCanvasElement;
  type: DocType | null;
  /** Corners (TL, TR, BR, BL), normalised to `source`. */
  quad: Pt[] | null;
  /** Straightened image, held in memory only. */
  flat: HTMLCanvasElement | null;
  boxes: Box[];
  ocr: 'idle' | 'running' | 'done' | 'failed';
  exported: boolean;
}

interface SessionState {
  terms: SearchTerms;
  /** Replacement text for DOB, e.g. "67M". */
  label: string;
  images: WorkImage[];
}

const fresh = (): SessionState => ({ terms: { patient: [], clinician: [] }, label: '', images: [] });

/** All patient data lives here, in memory, and nowhere else. */
export const session: SessionState = fresh();

const listeners = new Set<() => void>();
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const changed = () => listeners.forEach((fn) => fn());

let nextId = 1;
export const newId = () => `i${nextId++}`;

/** Overwrites and releases a canvas's pixel buffer. */
export function zeroCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx?.clearRect(0, 0, c.width, c.height);
  c.width = 0;
  c.height = 0;
}

export function removeImage(id: string): void {
  const img = session.images.find((i) => i.id === id);
  if (!img) return;
  zeroCanvas(img.source);
  zeroCanvas(img.flat);
  session.images = session.images.filter((i) => i !== img);
  changed();
}

const wipeHooks = new Set<() => void>();
/** Registers extra cleanup (e.g. stopping the camera) to run on wipe. */
export const onWipe = (fn: () => void) => {
  wipeHooks.add(fn);
  return () => wipeHooks.delete(fn);
};

/** Destroys every image, search term and label held by the app. */
export function wipe(): void {
  for (const img of session.images) {
    zeroCanvas(img.source);
    zeroCanvas(img.flat);
    img.boxes = [];
  }
  wipeHooks.forEach((fn) => fn());
  Object.assign(session, fresh());
  changed();
}

export function parseTerms(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}
