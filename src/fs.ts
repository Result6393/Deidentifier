// Minimal typings and helpers for the File System Access API (desktop Chrome/Edge).
// Handles to the user's files only ever live in memory; nothing here persists them.

export interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
}

export interface DirHandleLike {
  kind: 'directory';
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  entries(): AsyncIterable<[string, FileHandleLike | DirHandleLike]>;
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface PickerWindow {
  showDirectoryPicker?: (opts: { mode: 'read' | 'readwrite' }) => Promise<DirHandleLike>;
}

export const hasFolderPicker = () => typeof (window as PickerWindow).showDirectoryPicker === 'function';

export const isAbort = (e: unknown) => (e as DOMException)?.name === 'AbortError';

/** Asks the user for a folder. Must be called straight from a click. Resolves null if they cancel. */
export async function pickFolder(mode: 'read' | 'readwrite'): Promise<DirHandleLike | null> {
  try {
    return await (window as PickerWindow).showDirectoryPicker!({ mode });
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

/** True once we may write in this folder, asking the user if needed (call from a click). */
export async function ensureWrite(dir: DirHandleLike): Promise<boolean> {
  if (!dir.queryPermission || !dir.requestPermission) return true;
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Names of every file already in the folder. */
export async function listNames(dir: DirHandleLike): Promise<Set<string>> {
  const names = new Set<string>();
  for await (const [name] of dir.entries()) names.add(name);
  return names;
}

/** `photo.jpg` → `photo (2).jpg`, `photo (3).jpg`… the first name not in `taken`. */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Writes via a temporary file that only replaces the target on close(), so a failure never leaves half a file. */
export async function writeAtomic(handle: FileHandleLike, blob: Blob): Promise<void> {
  const w = await handle.createWritable();
  try {
    await w.write(blob);
    await w.close();
  } catch (e) {
    await w.abort().catch(() => undefined);
    throw e;
  }
}

/** A folder's name for messages: “Name”, or a plain phrase if the browser gives no name. */
export const folderLabel = (name: string) => (name ? `“${name}”` : 'the chosen folder');
