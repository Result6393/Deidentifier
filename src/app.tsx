import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { addFiles, session, subscribe, wipe } from './state/session';
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

export function App() {
  const [camera, setCamera] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const offline = useOfflineStatus();

  useEffect(() => subscribe(() => rerender(0)), []);

  const importFiles = async (files: File[]) => {
    const images = files.filter(isImage);
    if (!images.length) return;
    const failed = await addFiles(images);
    if (failed) setNotice(`${failed} file${failed > 1 ? 's' : ''} could not be opened as an image.`);
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
      const r = await importFolder();
      if (!r) return;
      const parts = r.opened
        ? [`Opened ${r.opened} photo${r.opened > 1 ? 's' : ''} from ${folderLabel(r.folder)}. They can be overwritten from the Export menu.`]
        : [`No JPEG, PNG or WebP photos found in ${folderLabel(r.folder)}.`];
      if (r.ignored) parts.push(`${r.ignored} other image file${r.ignored > 1 ? 's' : ''} (e.g. HEIC) ${r.ignored > 1 ? 'were' : 'was'} ignored because ${r.ignored > 1 ? 'they' : 'it'} can't be replaced in ${r.ignored > 1 ? 'their' : 'its'} own format.`);
      if (r.failed) parts.push(`${r.failed} file${r.failed > 1 ? 's' : ''} could not be opened as an image.`);
      setNotice(parts.join(' '));
    } catch (e) {
      const name = (e as DOMException)?.name;
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
          accept="image/*"
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
