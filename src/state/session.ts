import { presetBoxes, startingPreset } from '../presets/templates';
import { makeBox, rotateRect90 } from '../editor/boxes';
import type { DirHandleLike, FileHandleLike } from '../fs';
import type { Box, DocType } from '../types';

/** Where a photo came from on disk, kept only in memory so it can be replaced after redaction. */
export interface SourceFile {
  fileHandle: FileHandleLike;
  dirHandle: DirHandleLike;
  name: string;
  size: number;
  lastModified: number;
  mime: string;
}

export interface WorkImage {
  id: string;
  /** The photo as imported (or as straightened), held in memory only. */
  blob: Blob;
  /** Tiny preview (data URL) for the filmstrip. */
  thumb: string;
  /** Width / height of the image as displayed (after rotation). */
  aspect: number;
  /** The rotation the thumbnail was drawn with. */
  thumbRot: number;
  /** Quarter turns clockwise applied on top of the blob. */
  rotation: number;
  type: DocType | null;
  /** Saved preset the boxes were seeded from; null means the built-in layout. */
  presetId: string | null;
  boxes: Box[];
  /** True once the user has moved, drawn, deleted or stamped a box. */
  edited: boolean;
  done: boolean;
  /** Set when imported from a folder: the file can be overwritten. */
  source?: SourceFile;
  /** Rotated or straightened since it was opened, so the file would differ even with no boxes. */
  modified?: boolean;
  /** The user deliberately removed the type, so don't carry the last-used type onto this photo. */
  noType?: boolean;
  /** File name shown in the file bar: the imported file's name, or "Camera photo N". */
  name: string;
  /** The photo's real pixel size (before rotation), so zoom levels can be real percentages. */
  pxW: number;
  pxH: number;
  /** A file we created for this photo with Save; later presses update it in place. */
  saveHandle?: FileHandleLike;
  /** Signature of the photo when last saved; equal to the current one means "nothing to save". */
  savedSig?: string;
}

interface SessionState {
  images: WorkImage[];
  currentId: string | null;
  lastType: DocType | null;
  importing: { done: number; total: number } | null;
  cameraShots: number;
}

const fresh = (): SessionState => ({ images: [], currentId: null, lastType: null, importing: null, cameraShots: 0 });

/** All patient data lives here, in memory, and nowhere else. */
export const session: SessionState = fresh();

const listeners = new Set<() => void>();
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const changed = () => listeners.forEach((fn) => fn());

let nextId = 1;
const newId = () => `i${nextId++}`;

export const VIEW_EDGE = 2400;
const THUMB_EDGE = 240;

/** Overwrites and releases a canvas's pixel buffer. */
export function zeroCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (!c) return;
  c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  c.width = 0;
  c.height = 0;
}

/**
 * Decodes a photo (applying its EXIF orientation, then `quarterTurns`) into a
 * canvas no larger than maxEdge.
 */
export async function decodeImageSized(blob: Blob, quarterTurns: number, maxEdge: number): Promise<{ canvas: HTMLCanvasElement; srcW: number; srcH: number }> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const q = ((quarterTurns % 4) + 4) % 4;
    const c = document.createElement('canvas');
    c.width = q % 2 ? h : w;
    c.height = q % 2 ? w : h;
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((q * Math.PI) / 2);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    return { canvas: c, srcW: bmp.width, srcH: bmp.height };
  } finally {
    bmp.close();
  }
}

export async function decodeImage(blob: Blob, quarterTurns: number, maxEdge: number): Promise<HTMLCanvasElement> {
  return (await decodeImageSized(blob, quarterTurns, maxEdge)).canvas;
}

/** The photo's size as shown (after any rotation), in real pixels. */
export const shownPx = (img: WorkImage) => (img.rotation % 2 ? { w: img.pxH, h: img.pxW } : { w: img.pxW, h: img.pxH });

/** Cheap fingerprint of everything that ends up in a saved file; used to tell if there is anything new to save. */
export const sigOf = (img: WorkImage) =>
  JSON.stringify([img.boxes.map((b) => [b.x, b.y, b.w, b.h, b.stamp ?? '']), img.rotation, img.blob.size]);

export const isSaved = (img: WorkImage) => img.savedSig !== undefined && img.savedSig === sigOf(img);

export function makeThumb(src: HTMLCanvasElement): string {
  const scale = Math.min(1, THUMB_EDGE / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.7);
  zeroCanvas(c);
  return url;
}

// Decoded working canvases, kept only for the current image and its neighbours.
const cache = new Map<string, Promise<HTMLCanvasElement>>();

export function getCanvas(img: WorkImage): Promise<HTMLCanvasElement> {
  let p = cache.get(img.id);
  if (!p) {
    p = decodeImage(img.blob, img.rotation, VIEW_EDGE);
    cache.set(img.id, p);
    p.catch(() => cache.delete(img.id));
  }
  return p;
}

export function dropCanvas(id: string): void {
  const p = cache.get(id);
  cache.delete(id);
  p?.then(zeroCanvas, () => undefined);
  dropFull(id);
}

// Full-resolution copy of the photo being zoomed in on (only ever one at a time).
export const FULL_EDGE = 8000;
const fullCache = new Map<string, Promise<HTMLCanvasElement>>();

/** True when the full-size photo is bigger than the working copy, so zooming in needs the full one. */
export const needsFull = (img: WorkImage) => Math.max(img.pxW, img.pxH) > VIEW_EDGE;

export function getFullCanvas(img: WorkImage): Promise<HTMLCanvasElement> {
  let p = fullCache.get(img.id);
  if (!p) {
    p = decodeImage(img.blob, img.rotation, FULL_EDGE);
    fullCache.set(img.id, p);
    p.catch(() => fullCache.delete(img.id));
  }
  return p;
}

export function dropFull(id: string): void {
  const p = fullCache.get(id);
  fullCache.delete(id);
  p?.then(zeroCanvas, () => undefined);
}

/** Frees every full-resolution copy except the given image's (or all, with null). */
export function keepFullOnly(id: string | null): void {
  for (const k of [...fullCache.keys()]) if (k !== id) dropFull(k);
}

/** Frees every cached canvas except those of the given images. */
export function keepOnly(ids: string[]): void {
  for (const id of [...cache.keys()]) if (!ids.includes(id)) dropCanvas(id);
}

/** The current image and the ones either side of it: the only ones kept decoded. */
export function neighbourIds(): string[] {
  const i = session.images.findIndex((x) => x.id === session.currentId);
  return session.images.slice(Math.max(0, i - 1), i + 2).map((x) => x.id);
}

export function currentImage(): WorkImage | null {
  return session.images.find((i) => i.id === session.currentId) ?? null;
}

export function go(delta: number): void {
  const i = session.images.findIndex((x) => x.id === session.currentId);
  const next = session.images[Math.min(session.images.length - 1, Math.max(0, i + delta))];
  if (next && next.id !== session.currentId) {
    session.currentId = next.id;
    changed();
  }
}

export function select(id: string): void {
  session.currentId = id;
  changed();
}

const seed = (type: DocType, presetId: string | null): Box[] => presetBoxes(type, presetId).map((r) => makeBox(r));

/** Deselects the image type and removes its preset boxes. */
export function clearType(img: WorkImage): void {
  img.type = null;
  img.presetId = null;
  img.boxes = [];
  img.edited = false;
  img.noType = true;
  // Deselecting also stops the type being carried onto the next photos, until a type is chosen again.
  session.lastType = null;
  changed();
}

/** Chooses the image type and drops in that type's default preset boxes. */
export function setType(img: WorkImage, type: DocType): void {
  img.type = type;
  img.noType = false;
  img.presetId = startingPreset(type);
  img.boxes = seed(type, img.presetId);
  img.edited = false;
  session.lastType = type;
  changed();
}

/** Replaces this image's boxes with a saved preset (null = the built-in layout). */
export function applyPreset(img: WorkImage, presetId: string | null): void {
  if (!img.type) return;
  img.presetId = presetId;
  img.boxes = seed(img.type, presetId);
  img.edited = false;
  changed();
}

/** Rotates the image a quarter turn clockwise, keeping any boxes in place on it. */
export function rotate(img: WorkImage): void {
  img.rotation = (img.rotation + 1) % 4;
  img.modified = true;
  img.aspect = 1 / img.aspect;
  img.boxes = img.boxes.map((b) => ({ ...b, ...rotateRect90(b) }));
  dropCanvas(img.id);
  changed();
}

/** Replaces the photo (e.g. after straightening) and re-seeds the preset boxes. */
export async function replaceBlob(img: WorkImage, blob: Blob, canvas: HTMLCanvasElement): Promise<void> {
  img.blob = blob;
  img.modified = true;
  img.rotation = 0;
  img.pxW = canvas.width;
  img.pxH = canvas.height;
  img.thumb = makeThumb(canvas);
  img.thumbRot = 0;
  img.aspect = canvas.width / canvas.height;
  if (img.type) img.boxes = seed(img.type, img.presetId);
  img.edited = false;
  dropCanvas(img.id);
  changed();
}

export function removeImage(id: string): void {
  const i = session.images.findIndex((x) => x.id === id);
  if (i < 0) return;
  dropCanvas(id);
  session.images.splice(i, 1);
  if (session.currentId === id) session.currentId = (session.images[i] ?? session.images[i - 1])?.id ?? null;
  changed();
}

/** Opens photos one at a time so the first is editable straight away. */
export async function addFiles(files: Blob[], sources?: (SourceFile | undefined)[], names?: string[]): Promise<number> {
  let failed = 0;
  const epoch = wipeCount;
  session.importing = { done: 0, total: files.length };
  changed();
  for (let n = 0; n < files.length; n++) {
    const blob = files[n];
    try {
      const { canvas, srcW, srcH } = await decodeImageSized(blob, 0, VIEW_EDGE);
      if (epoch !== wipeCount) {
        // The session was wiped while this photo was opening.
        zeroCanvas(canvas);
        return failed;
      }
      const img: WorkImage = { id: newId(), blob, thumb: makeThumb(canvas), aspect: canvas.width / canvas.height, thumbRot: 0, rotation: 0, type: null, presetId: null, boxes: [], edited: false, done: false, source: sources?.[n], name: names?.[n] ?? sources?.[n]?.name ?? (blob as File).name ?? `Photo ${session.images.length + 1}`, pxW: srcW, pxH: srcH };
      cache.set(img.id, Promise.resolve(canvas));
      session.images.push(img);
      session.currentId ??= img.id;
      keepOnly(neighbourIds());
    } catch {
      failed++;
    }
    if (session.importing) session.importing.done++;
    changed();
  }
  session.importing = null;
  changed();
  return failed;
}

let wipeCount = 0;
const wipeHooks = new Set<() => void>();
/** Registers extra cleanup (e.g. stopping the camera) to run on wipe. */
export const onWipe = (fn: () => void) => {
  wipeHooks.add(fn);
  return () => void wipeHooks.delete(fn);
};

/** Destroys every photo and box held by the app. */
export function wipe(): void {
  wipeCount++;
  keepOnly([]);
  keepFullOnly(null);
  wipeHooks.forEach((fn) => fn());
  Object.assign(session, fresh());
  changed();
}
