import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { problems, renderBatch } from '../export/batch';
import { canSaveToFolder, canShareFiles, downloadAll, downloadBlob, exportName, shareFiles, writeToFolder, type Format, type NamedBlob } from '../export/output';
import { needsWrite, overwriteOriginals } from '../export/overwrite';
import { folderLabel, freeName, listNames, pickFolder } from '../fs';
import { makeZip } from '../export/zip';
import { session } from '../state/session';
import { ask } from './ConfirmDialog';

type Kind = 'zip' | 'folder' | 'files' | 'share';

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on Esc or a click elsewhere, but not while a confirmation dialog is answering something for us.
  useLayoutEffect(() => {
    if (!open) return;
    const dialogOpen = () => !!document.querySelector('[role="alertdialog"]');
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !(t as Element).closest?.('[role="alertdialog"]')) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !dialogOpen()) {
        setOpen(false);
        e.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  const [limit, setLimit] = useState(true);
  const [format, setFormat] = useState<Format>('image/jpeg');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState<NamedBlob[] | null>(null);

  const total = session.images.length;

  const run = async (kind: Kind) => {
    setMessage(null);
    setReady(null);
    const issues = problems(session.images);
    if (issues.length && !confirm(`${issues.join('\n')}\n\nExport all ${total} images anyway?`)) return;
    try {
      // Folder access needs a fresh click, so ask for it before the slow rendering.
      const dir = kind === 'folder' ? await pickFolder('readwrite') : null;
      if (kind === 'folder' && !dir) return;
      // Never replace files in the chosen folder without saying so.
      let taken = new Set<string>();
      let keepBoth = false;
      if (dir) {
        taken = await listNames(dir);
        const names = session.images.map((_, i) => exportName(i, format));
        const clash = names.filter((nm) => taken.has(nm));
        if (clash.length) {
          const c = await ask({
            title: `${clash.length} of ${names.length} files already exist in ${folderLabel(dir.name)}`,
            body: 'Replace existing overwrites those files permanently. Keep both saves the new images under new names and leaves the existing files untouched.',
            details: clash,
            choices: [
              { id: 'cancel', label: 'Cancel' },
              { id: 'keep', label: 'Keep both', kind: 'primary' },
              { id: 'replace', label: 'Replace existing', kind: 'danger' },
            ],
            focus: 'cancel',
          });
          if (c === 'cancel') return;
          keepBoth = c === 'keep';
        }
      }
      setBusy(`Rendering 0/${total}…`);
      let files = await renderBatch(session.images, { limit, format }, (n) => setBusy(`Rendering ${n}/${total}…`));
      if (dir && keepBoth) {
        const used = new Set(taken);
        files = files.map((f) => {
          const name = freeName(f.name, used);
          used.add(name);
          return { ...f, name };
        });
      }
      if (kind === 'zip') downloadBlob(await makeZip(files), 'case-images.zip');
      else if (kind === 'folder') await writeToFolder(dir!, files);
      else if (kind === 'files') await downloadAll(files);
      else {
        // Sharing needs a fresh click too, so finish with a second button.
        setReady(files);
        return;
      }
      setMessage(`Exported ${files.length} image${files.length > 1 ? 's' : ''}.`);
    } catch (e) {
      setMessage(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const withSource = session.images.filter((i) => i.source).length;
  const changedCount = session.images.filter(needsWrite).length;

  const runOverwrite = async () => {
    setMessage(null);
    setReady(null);
    try {
      const r = await overwriteOriginals(session.images, (m) => setBusy(m));
      if (!r) return;
      const parts = [`Replaced ${r.replaced} original${r.replaced === 1 ? '' : 's'}.`];
      if (r.skipped.length) parts.push(`Skipped ${r.skipped.length}: ${r.skipped.join('; ')}.`);
      if (r.failed.length) parts.push(`Failed ${r.failed.length}: ${r.failed.join('; ')}.`);
      setMessage((r.failed.length ? 'Export failed: ' : '') + parts.join(' '));
    } catch (e) {
      setMessage(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    try {
      if (await shareFiles(ready!)) setMessage(`Shared ${ready!.length} image${ready!.length > 1 ? 's' : ''}.`);
      setReady(null);
    } catch (e) {
      setMessage(`Share failed: ${(e as Error).message}`);
    }
  };

  return (
    <div class="menu" ref={rootRef}>
      <button class="btn primary" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="export-menu">
        Export<span class="hide-sm"> ({total})</span> ▾
      </button>
      {open && (
        <div class="menu-panel stack">
          <label class="check small">
            <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.currentTarget.checked)} /> Limit to 2000 px (smaller files)
          </label>
          <label class="small">
            Format{' '}
            <select value={format} onChange={(e) => setFormat(e.currentTarget.value as Format)}>
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
            </select>
          </label>
          <button class="btn primary" disabled={!!busy} onClick={() => run('zip')} data-testid="export-zip">
            Download all as ZIP
          </button>
          {canSaveToFolder() && (
            <button class="btn" disabled={!!busy} onClick={() => run('folder')}>
              Save to a folder…
            </button>
          )}
          {canShareFiles() && (
            <button class="btn" disabled={!!busy} onClick={() => run('share')}>
              Share all…
            </button>
          )}
          <button class="btn" disabled={!!busy} onClick={() => run('files')} data-testid="export-files">
            Download as separate files
          </button>
          {withSource > 0 && (
            <div class="stack replace-box">
              <button class="btn danger" disabled={!!busy || changedCount === 0} onClick={runOverwrite} data-testid="export-overwrite">
                Overwrite originals ({changedCount} changed)…
              </button>
              <p class="menu-note small">
                {changedCount === 0
                  ? 'Nothing to replace yet. Only photos opened from a folder that have new black boxes or edits are replaced.'
                  : `Replaces only the ${changedCount === 1 ? 'photo' : `${changedCount} photos`} you've added black boxes to or edited, keeping each one's own format and size. The other ${withSource - changedCount} folder photo${withSource - changedCount === 1 ? '' : 's'} stay${withSource - changedCount === 1 ? 's' : ''} as they are.`}
                {withSource < total ? ' Photos not opened from a folder are never touched.' : ''}
              </p>
            </div>
          )}
          {withSource === 0 && (
            <p class="menu-note small" data-testid="overwrite-hint">
              To replace originals instead of saving new files, use Chrome or Edge on a computer and open them with ⋯ → Import folder. Not possible on phones.
            </p>
          )}
          {ready && (
            <button class="btn primary" onClick={share}>
              Ready: share {ready.length} image{ready.length > 1 ? 's' : ''}
            </button>
          )}
          {busy && (
            <p class="small" role="status">
              {busy}
            </p>
          )}
          {message && (
            <p class={`small ${message.startsWith('Export failed') || message.startsWith('Share failed') ? 'error' : 'ok'}`} role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
