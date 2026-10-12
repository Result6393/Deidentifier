import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { addFiles, session, subscribe, wipe } from './state/session';
import { addPdf, isPdf, PdfError } from './capture/pdf';
import { collectSharedFiles } from './capture/shareTarget';
import { offlineText, useOfflineStatus } from './ui/OfflineBadge';
import { OverflowMenu } from './ui/OverflowMenu';
import { CameraScreen } from './ui/Camera';
import { ExportMenu } from './ui/ExportMenu';
import { Workspace } from './ui/Workspace';
import { DialogHost } from './ui/ConfirmDialog';
import { importFolder } from './capture/folder';
import { folderLabel, hasFolderPicker } from './fs';

const IDLE_MS = 10 * 60 * 1000;

const isImage = (f: File) => f.type.startsWith('image/');

const PDF_NOTE = 'PDF pages open as images. Handwriting is not detected, so box anything identifying on every page yourself.';
let pdfNoteShown = false;

export function App() {
  const [camera, setCamera] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const offline = useOfflineStatus();

  useEffect(() => subscribe(() => rerender(0)), []);

  const importFiles = async (files: File[]) => {
    const usable = files.filter((f) => isImage(f) || isPdf(f));
    if (!usable.length) return;
    let failed = 0;
    let sawPdf = false;
    const problems: string[] = [];
    // Keep the order the files were chosen in: runs of photos go in together, each PDF as its pages.
    let run: File[] = [];
    const flush = async () => {
      if (run.length) failed += await addFiles(run);
      run = [];
    };
    for (const f of usable) {
      if (!isPdf(f)) {
        run.push(f);
        continue;
      }
      await flush();
      sawPdf = true;
      const name = f.name || 'document.pdf';
      try {
        await addPdf(f, name, (i, n) => setPdfStatus(`Opening ${name}: page ${i} of ${n}…`));
      } catch (e) {
        problems.push(e instanceof PdfError ? e.message : `Couldn't open “${name}”.`);
      } finally {
        setPdfStatus(null);
      }
    }
    await flush();
    if (failed) problems.push(`${failed} file${failed > 1 ? 's' : ''} could not be opened as an image.`);
    if (sawPdf && !pdfNoteShown) {
      pdfNoteShown = true;
      problems.push(PDF_NOTE);
    }
    if (problems.length) setNotice(problems.join(' '));
  };


  useEffect(() => {
    // Wipe automatically after inactivity, and whenever the page is closed.
    let timer = 0;
    const reset = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!session.images.length) return;
        wipe();
        setCamera(false);
        setNotice('Session cleared after 10 minutes of inactivity. Nothing was kept.');
      }, IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    window.addEventListener('pagehide', wipe);

    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragOver(false);
      void importFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);

    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
      window.removeEventListener('pagehide', wipe);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  useEffect(() => {
    void collectSharedFiles().then((files) => importFiles(files));
  }, []);

  const importFolderNow = async () => {
    try {
      const r = await importFolder((name, i, n) => setPdfStatus(`Opening ${name}: page ${i} of ${n}…`));
      setPdfStatus(null);
      if (!r) return;
      const parts = r.opened
        ? [`Opened ${r.opened} photo${r.opened > 1 ? 's' : ''} from ${folderLabel(r.folder)}. They can be overwritten from the Export menu.`]
        : r.pdfs
          ? []
          : [`No JPEG, PNG, WebP or PDF files found in ${folderLabel(r.folder)}.`];
      if (r.pdfPages) parts.push(`Opened ${r.pdfPages} page${r.pdfPages > 1 ? 's' : ''} from ${r.pdfs} PDF${r.pdfs > 1 ? 's' : ''}; PDF pages save as new files and never replace the PDF.`);
      parts.push(...r.problems);
      if (r.pdfs && !pdfNoteShown) {
        pdfNoteShown = true;
        parts.push(PDF_NOTE);
      }
      if (r.ignored) parts.push(`${r.ignored} other image file${r.ignored > 1 ? 's' : ''} (e.g. HEIC) ${r.ignored > 1 ? 'were' : 'was'} ignored because ${r.ignored > 1 ? 'they' : 'it'} can't be replaced in ${r.ignored > 1 ? 'their' : 'its'} own format.`);
      if (r.failed) parts.push(`${r.failed} file${r.failed > 1 ? 's' : ''} could not be opened as an image.`);
      setNotice(parts.join(' '));
    } catch (e) {
      const name = (e as DOMException)?.name;
      setPdfStatus(null);
      setNotice(
        name === 'SecurityError'
          ? 'Chrome would not open that folder. It blocks Downloads, Documents and Desktop themselves and system folders. Pick a subfolder instead.'
          : `Could not open the folder: ${(e as Error).message}`,
      );
    }
  };

  const endSession = () => {
    if (session.images.length && !confirm('End session? All photos and boxes in this session will be deleted from memory.')) return;
    wipe();
    setCamera(false);
    setNotice('Session ended. All photos have been deleted from memory.');
  };

  const hasImages = session.images.length > 0;

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="brand-name">Deidentifier</span>
          <span class="version" data-testid="version">v{__APP_VERSION__}</span>
        </div>
        <span class="spacer" />
        {!camera && (
          <>
            <button class="btn" onClick={() => fileRef.current?.click()} data-testid="import">
              Import
            </button>
            <button class="btn" onClick={() => setCamera(true)}>
              Camera
            </button>
          </>
        )}
        {hasImages && !camera && <ExportMenu />}
        <OverflowMenu title="More" testid="app-menu" dot={offline.ready}>
          {(close) => (
            <>
              <p class="menu-note" title="Photos are processed on this device and never uploaded.">
                {offlineText(offline)}
              </p>
              <p class="menu-note">Version {__APP_VERSION__}</p>
              {hasFolderPicker() && (
                <button
                  class="menu-item"
                  data-testid="import-folder"
                  onClick={() => {
                    close();
                    void importFolderNow();
                  }}
                >
                  Import folder… (can overwrite originals)
                </button>
              )}
              {hasImages && (
                <button
                  class="menu-item danger"
                  onClick={() => {
                    close();
                    endSession();
                  }}
                >
                  End session
                </button>
              )}
            </>
          )}
        </OverflowMenu>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,.pdf"
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const input = e.currentTarget;
            const files = Array.from(input.files ?? []);
            // Drop the browser's reference to the picked files, then open them.
            input.value = '';
            void importFiles(files);
          }}
        />
      </header>
      {pdfStatus && (
        <div class="notice" role="status" data-testid="pdf-status">
          {pdfStatus}
        </div>
      )}
      {session.importing && (
        <div class="notice" role="status">
          Opening photos… {session.importing.done}/{session.importing.total}
        </div>
      )}
      {notice && (
        <div class="notice" role="status">
          {notice}
          <button class="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      <main>{camera ? <CameraScreen onDone={() => setCamera(false)} /> : <Workspace onImport={() => fileRef.current?.click()} onCamera={() => setCamera(true)} onImportFolder={hasFolderPicker() ? () => void importFolderNow() : undefined} />}</main>
      <DialogHost />
      {dragOver && <div class="dropzone">Drop photos to import</div>}
    </div>
  );
}
