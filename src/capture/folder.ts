import { pickFolder } from '../fs';
import { addFiles, type SourceFile } from '../state/session';
import { ask } from '../ui/ConfirmDialog';

// Only formats the browser can both read and write back, so a replaced file keeps its own format.
const TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const OTHER_IMAGES = /\.(heic|heif|avif|gif|bmp|tiff?)$/i;
const LARGE = 1.5 * 1024 ** 3;

export interface FolderImport {
  folder: string;
  opened: number;
  failed: number;
  /** Image files in a format that can't be read back and replaced (e.g. HEIC). */
  ignored: number;
}

const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

/**
 * Opens every JPEG/PNG/WebP in a folder the user picks (desktop Chrome/Edge), keeping a handle to
 * each so it can be replaced after redaction. The browser asks for write permission once, for the
 * whole folder. Photos are copied into memory, so replacing a file never breaks the open copy.
 */
export async function importFolder(): Promise<FolderImport | null> {
  const dir = await pickFolder('readwrite');
  if (!dir) return null;
  const found: { name: string; handle: Awaited<ReturnType<typeof dir.getFileHandle>> }[] = [];
  let ignored = 0;
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;
    if (TYPES[ext(name)]) found.push({ name, handle });
    else if (OTHER_IMAGES.test(name)) ignored++;
  }
  found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const files = await Promise.all(found.map((f) => f.handle.getFile()));
  const bytes = files.reduce((n, f) => n + f.size, 0);
  if (bytes > LARGE) {
    const c = await ask({
      title: 'This folder is large',
      body: `${found.length} photos, ${(bytes / 1024 ** 3).toFixed(1)} GB. They are all held in memory while you work, which may be slow or crash the tab. Open fewer photos at a time if you can.`,
      choices: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'go', label: 'Open anyway' },
      ],
      focus: 'cancel',
    });
    if (c !== 'go') return null;
  }

  const blobs: Blob[] = [];
  const sources: SourceFile[] = [];
  for (let i = 0; i < found.length; i++) {
    const mime = TYPES[ext(found[i].name)];
    blobs.push(new Blob([await files[i].arrayBuffer()], { type: mime }));
    sources.push({ fileHandle: found[i].handle, dirHandle: dir, name: found[i].name, size: files[i].size, lastModified: files[i].lastModified, mime });
  }
  const failed = await addFiles(blobs, sources);
  return { folder: dir.name, opened: found.length - failed, failed, ignored };
}

