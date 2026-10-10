import { hasFolderPicker, isAbort, writeAtomic, type DirHandleLike } from '../fs';

/** The formats the app can write. Exports offer JPEG/PNG; overwriting keeps the original's own format. */
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export type Format = 'image/jpeg' | 'image/png';

export interface NamedBlob {
  name: string;
  blob: Blob;
}

export function toBlob(canvas: HTMLCanvasElement, type: ImageType, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => {
        // Browsers silently fall back to PNG for formats they can't encode; never let that pass as `type`.
        if (!b || b.type !== type) reject(new Error(`This browser can't save ${type.replace('image/', '').toUpperCase()}`));
        else resolve(b);
      },
      type,
      quality,
    ),
  );
}

const EXT: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Generic file names only: never derived from the original photo's name. */
export const exportName = (index: number, type: ImageType) => `case-image-${String(index + 1).padStart(3, '0')}.${EXT[type]}`;

// ZIP and separate downloads go to the browser's download folder, which never overwrites:
// on a name clash the browser renames the new file ("case-images (1).zip"). Only writing into
// a chosen folder can replace files, and that path checks for clashes first (see ExportMenu).
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

export const canSaveToFolder = hasFolderPicker;

/** Writes each file into the folder under its own name (replacing a file of that name). */
export async function writeToFolder(dir: DirHandleLike, files: NamedBlob[]): Promise<void> {
  for (const f of files) await writeAtomic(await dir.getFileHandle(f.name, { create: true }), f.blob);
}

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
