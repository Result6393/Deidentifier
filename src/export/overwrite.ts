import { ensureWrite, folderLabel, writeAtomic } from '../fs';
import { changed, dropCanvas, shownPx, sigOf, type WorkImage } from '../state/session';
import { ask } from '../ui/ConfirmDialog';
import { problems, renderOne } from './batch';
import type { ImageType } from './output';

export interface OverwriteReport {
  replaced: number;
  skipped: string[];
  failed: string[];
}

/** Whether the file on disk is still the one we opened. */
export async function checkSource(t: WorkImage): Promise<'ok' | 'changed' | 'gone'> {
  try {
    const f = await t.source!.fileHandle.getFile();
    return f.size !== t.source!.size || f.lastModified !== t.source!.lastModified ? 'changed' : 'ok';
  } catch {
    return 'gone';
  }
}

/** Renders the photo (own format, full size) and replaces its original file; the photo on screen then matches the disk. */
export async function writeOriginal(t: WorkImage): Promise<void> {
  const src = t.source!;
  const blob = await renderOne(t, { limit: false, full: true, format: src.mime as ImageType });
  await writeAtomic(src.fileHandle, blob);
  const f = await src.fileHandle.getFile();
  src.size = f.size;
  src.lastModified = f.lastModified;
  const shown = shownPx(t);
  t.blob = blob;
  t.rotation = 0;
  t.pxW = shown.w;
  t.pxH = shown.h;
  dropCanvas(t.id);
  t.done = true;
  t.savedSig = sigOf(t);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Replaces the original files (photos imported from a folder) with their redacted versions.
 * Every step that could destroy something unexpectedly asks first: a firm confirmation, a check
 * that nothing changed on disk since import, and writes that never leave a half-written file.
 * Resolves null if the user cancels before anything is written.
 */
export async function overwriteOriginals(images: WorkImage[], onProgress: (msg: string) => void): Promise<OverwriteReport | null> {
  const targets = images.filter((i) => i.source);
  if (!targets.length) return { replaced: 0, skipped: [], failed: [] };
  const label = (i: WorkImage) => i.source!.name;
  const n = targets.length;
  const folders = [...new Set(targets.map((t) => t.source!.dirHandle.name))];

  // 1. A firm, specific confirmation before anything is touched.
  const warnings = problems(targets);
  const untouched = images.length - n;
  const body = [
    `This permanently replaces ${n} original photo${n > 1 ? 's' : ''} in ${folders.map(folderLabel).join(', ')} with the redacted version${n > 1 ? 's' : ''}. The unredacted originals will be gone and this app cannot get them back.`,
    untouched ? `${untouched} other photo${untouched > 1 ? 's were' : ' was'} not imported from a folder and will not be changed.` : '',
    warnings.length ? `Check first:\n${warnings.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const choice = await ask({
    title: `Replace ${n} original photo${n > 1 ? 's' : ''}?`,
    body,
    details: targets.map(label),
    tickLabel: 'I understand the unredacted originals will be permanently replaced',
    choices: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'go', label: `Replace ${n} original${n > 1 ? 's' : ''}`, kind: 'danger', needsTick: true },
    ],
    focus: 'cancel',
  });
  if (choice !== 'go') return null;

  // 2. Permission for each folder (needs the click that just confirmed).
  for (const dir of new Set(targets.map((t) => t.source!.dirHandle))) {
    if (!(await ensureWrite(dir))) throw new Error(`Permission to change files in ${folderLabel(dir.name)} was not granted. Nothing was changed.`);
  }

  // 3. Has anything changed on disk since the photo was opened?
  const skipped: string[] = [];
  const stale: WorkImage[] = [];
  const gone: WorkImage[] = [];
  for (const t of targets) {
    const state = await checkSource(t);
    if (state === 'changed') stale.push(t);
    else if (state === 'gone') gone.push(t);
  }
  gone.forEach((t) => skipped.push(`${label(t)}: the file is no longer there`));
  let toWrite = targets.filter((t) => !gone.includes(t));
  if (stale.length) {
    const c = await ask({
      title: `${stale.length} file${stale.length > 1 ? 's have' : ' has'} changed since you opened ${stale.length > 1 ? 'them' : 'it'}`,
      body: 'Something edited or replaced these files after they were imported. Overwriting would destroy that newer version.',
      details: stale.map(label),
      choices: [
        { id: 'skip', label: 'Skip these files' },
        { id: 'go', label: 'Overwrite anyway', kind: 'danger' },
        { id: 'cancel', label: 'Cancel everything' },
      ],
      focus: 'skip',
    });
    if (c === 'cancel') return null;
    if (c === 'skip') {
      stale.forEach((t) => skipped.push(`${label(t)}: changed on disk since import`));
      toWrite = toWrite.filter((t) => !stale.includes(t));
    }
  }

  // 4. Render and write one photo at a time, in its own format and full size.
  let replaced = 0;
  const failed: string[] = [];
  for (let i = 0; i < toWrite.length; i++) {
    const t = toWrite[i];
    onProgress(`Replacing ${i + 1}/${toWrite.length}…`);
    try {
      await writeOriginal(t);
      replaced++;
    } catch (e) {
      failed.push(`${label(t)}: ${errText(e)}`);
    }
  }
  changed();
  return { replaced, skipped, failed };
}
