export type Format = 'image/jpeg' | 'image/png';

export interface NamedBlob {
  name: string;
  blob: Blob;
}

export function toBlob(canvas: HTMLCanvasElement, type: Format): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, 0.92),
  );
}

/** Generic file names only: never derived from the original photo's name. */
export const exportName = (index: number, type: Format) => `case-image-${String(index + 1).padStart(3, '0')}.${type === 'image/png' ? 'png' : 'jpg'}`;

const isAbort = (e: unknown) => (e as DOMException)?.name === 'AbortError';

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

interface FileHandleLike {
  createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
}
interface DirHandleLike {
  getFileHandle(name: string, opts: { create: boolean }): Promise<FileHandleLike>;
}
interface PickerWindow {
  showDirectoryPicker?: (opts: unknown) => Promise<DirHandleLike>;
}

export const canSaveToFolder = () => typeof (window as PickerWindow).showDirectoryPicker === 'function';

/** Asks the user for a folder (desktop Chrome/Edge). Must be called straight from a click. */
export async function pickFolder(): Promise<DirHandleLike | null> {
  try {
    return await (window as PickerWindow).showDirectoryPicker!({ mode: 'readwrite' });
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

export async function writeToFolder(dir: DirHandleLike, files: NamedBlob[]): Promise<void> {
  for (const f of files) {
    const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
    await w.write(f.blob);
    await w.close();
  }
}

export type { DirHandleLike };

/** Downloads files one after another (the browser may ask to allow multiple downloads). */
export async function downloadAll(files: NamedBlob[]): Promise<void> {
  for (const f of files) {
    downloadBlob(f.blob, f.name);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const asFiles = (files: NamedBlob[]) => files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));

export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'x.jpg', { type: 'image/jpeg' });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareFiles(files: NamedBlob[]): Promise<boolean> {
  try {
    await navigator.share({ files: asFiles(files), title: 'De-identified images' });
    return true;
  } catch (e) {
    if (isAbort(e)) return false;
    throw e;
  }
}

export const canCopyImage = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

/** Copies a PNG to the clipboard. Takes a promise so the click's permission lasts while it renders. */
export async function copyImage(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
