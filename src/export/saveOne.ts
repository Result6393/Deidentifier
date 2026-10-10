import { ensureWrite, folderLabel, hasSavePicker, pickSaveFile, writeAtomic } from '../fs';
import { changed, sigOf, type WorkImage } from '../state/session';
import { ask } from '../ui/ConfirmDialog';
import { renderOne } from './batch';
import { checkSource, writeOriginal } from './overwrite';
import { downloadBlob, type ImageType } from './output';

export type SaveMode = 'overwrite' | 'update' | 'save';

/** What the Save button will do for this photo. */
export const saveMode = (img: WorkImage): SaveMode => (img.source ? 'overwrite' : img.saveHandle ? 'update' : 'save');

export const saveLabel = (mode: SaveMode) => ({ overwrite: 'Overwrite', update: 'Update file', save: 'Save' })[mode];

const EXT: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** The format to save in: the photo's own where the browser can write it, otherwise JPEG. */
function formatOf(img: WorkImage): ImageType {
  const t = img.source?.mime ?? img.blob.type;
  return t === 'image/png' || t === 'image/webp' || t === 'image/jpeg' ? t : 'image/jpeg';
}

const stem = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name) || 'photo';

export type SaveResult = { ok: true; message: string } | { ok: false; cancelled: true } | { ok: false; cancelled?: false; message: string };

/**
 * Saves just this photo, now. Replaces the original if it came from a folder (after a quick
 * confirmation), updates the file we made earlier, or otherwise saves a new "(redacted)" file.
 */
export async function saveCurrent(img: WorkImage): Promise<SaveResult> {
  const mode = saveMode(img);
  const finish = (message: string): SaveResult => {
    img.done = true;
    img.savedSig = sigOf(img);
    changed();
    return { ok: true, message };
  };

  try {
    if (mode === 'overwrite') {
      const src = img.source!;
      const c = await ask({
        title: `Replace “${src.name}”?`,
        body: `The unredacted original in ${folderLabel(src.dirHandle.name)} is permanently replaced with this redacted photo, in its own format and full size. This app can't get the original back.`,
        choices: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'go', label: 'Replace', kind: 'danger' },
        ],
        focus: 'cancel',
      });
      if (c !== 'go') return { ok: false, cancelled: true };
      if (!(await ensureWrite(src.dirHandle))) return { ok: false, message: `Permission to change files in ${folderLabel(src.dirHandle.name)} was not granted. Nothing was changed.` };
      const state = await checkSource(img);
      if (state === 'gone') return { ok: false, message: `“${src.name}” is no longer there, so it can't be replaced.` };
      if (state === 'changed') {
        const again = await ask({
          title: `“${src.name}” has changed since you opened it`,
          body: 'Something edited or replaced this file after it was imported. Overwriting would destroy that newer version.',
          choices: [
            { id: 'cancel', label: 'Cancel' },
            { id: 'go', label: 'Overwrite anyway', kind: 'danger' },
          ],
          focus: 'cancel',
        });
        if (again !== 'go') return { ok: false, cancelled: true };
      }
      await writeOriginal(img);
      changed();
      return { ok: true, message: `Replaced “${src.name}”.` };
    }

    const format = formatOf(img);
    if (mode === 'update') {
      await writeAtomic(img.saveHandle!, await renderOne(img, { limit: false, full: true, format }));
      return finish(`Updated “${img.saveHandle!.name}”.`);
    }

    // A new file. The save dialog must open straight from the click, so ask for it before rendering.
    const suggested = `${stem(img.name)} (redacted).${EXT[format]}`;
    if (hasSavePicker()) {
      const handle = await pickSaveFile(suggested, format, EXT[format]);
      if (!handle) return { ok: false, cancelled: true };
      await writeAtomic(handle, await renderOne(img, { limit: false, full: true, format }));
      img.saveHandle = handle;
      return finish(`Saved “${handle.name}”.`);
    }
    // No save dialog on this browser (phones): download; the browser renames a duplicate rather than overwriting.
    downloadBlob(await renderOne(img, { limit: false, full: true, format }), suggested);
    return finish(`Downloaded “${suggested}”.`);
  } catch (e) {
    return { ok: false, message: `Could not save: ${(e as Error).message}` };
  }
}
