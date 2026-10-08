import { useState } from 'preact/hooks';
import { problems, renderBatch } from '../export/batch';
import { canSaveToFolder, canShareFiles, downloadAll, downloadBlob, pickFolder, shareFiles, writeToFolder, type Format, type NamedBlob } from '../export/output';
import { makeZip } from '../export/zip';
import { session } from '../state/session';

type Kind = 'zip' | 'folder' | 'files' | 'share';

export function ExportMenu() {
  const [open, setOpen] = useState(false);
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
      const dir = kind === 'folder' ? await pickFolder() : null;
      if (kind === 'folder' && !dir) return;
      setBusy(`Rendering 0/${total}…`);
      const files = await renderBatch(session.images, { limit, format }, (n) => setBusy(`Rendering ${n}/${total}…`));
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

  const share = async () => {
    try {
      if (await shareFiles(ready!)) setMessage(`Shared ${ready!.length} image${ready!.length > 1 ? 's' : ''}.`);
      setReady(null);
    } catch (e) {
      setMessage(`Share failed: ${(e as Error).message}`);
    }
  };

  return (
    <div class="menu">
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
