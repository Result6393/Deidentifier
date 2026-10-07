import { useEffect, useReducer, useState } from 'preact/hooks';
import { changed, session, subscribe, wipe } from './state/session';
import { collectSharedFiles } from './capture/shareTarget';
import { blobToCanvas, newWorkImage } from './capture/load';
import { warmUpOcr } from './detect/ocr';
import { StartScreen } from './ui/screens/Start';
import { ImagesScreen } from './ui/screens/Images';
import { CameraScreen } from './ui/screens/Camera';
import { ProcessScreen } from './ui/screens/Process';
import { OfflineBadge } from './ui/OfflineBadge';

export type Screen = { name: 'start' } | { name: 'images' } | { name: 'camera' } | { name: 'process'; id: string };

const IDLE_MS = 10 * 60 * 1000;

const hasData = () => session.images.length > 0 || session.terms.patient.length > 0 || session.terms.clinician.length > 0 || !!session.label;

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'start' });
  const [notice, setNotice] = useState<string | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const unsubscribe = subscribe(() => rerender(0));
    return () => void unsubscribe();
  }, []);

  useEffect(() => {
    warmUpOcr();
    // Automatic wipe after inactivity, and whenever the page is closed.
    let timer = 0;
    const reset = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!hasData()) return;
        wipe();
        setScreen({ name: 'start' });
        setNotice('Session cleared after 10 minutes of inactivity. Nothing was kept.');
      }, IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    window.addEventListener('pagehide', wipe);
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
      window.removeEventListener('pagehide', wipe);
    };
  }, []);

  useEffect(() => {
    collectSharedFiles().then(async (files) => {
      if (!files.length) return;
      for (const f of files) {
        try {
          session.images.push(newWorkImage(await blobToCanvas(f)));
        } catch {
          setNotice('One of the shared files could not be opened as an image.');
        }
      }
      changed();
      setScreen({ name: 'images' });
    });
  }, []);

  const endSession = () => {
    if (hasData() && !confirm('End session? All photos and search terms in this session will be deleted from memory.')) return;
    wipe();
    setScreen({ name: 'start' });
    setNotice('Session ended. All photos and search terms have been deleted from memory.');
  };

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">Deidentifier</div>
        <OfflineBadge />
        {hasData() && (
          <button class="btn danger small" onClick={endSession}>
            End session
          </button>
        )}
      </header>
      {notice && (
        <div class="notice" role="status">
          {notice}
          <button class="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      <main>
        {screen.name === 'start' && <StartScreen onContinue={() => setScreen({ name: 'images' })} />}
        {screen.name === 'images' && (
          <ImagesScreen
            onCamera={() => setScreen({ name: 'camera' })}
            onProcess={(id) => setScreen({ name: 'process', id })}
            onEditTerms={() => setScreen({ name: 'start' })}
          />
        )}
        {screen.name === 'camera' && <CameraScreen onDone={() => setScreen({ name: 'images' })} />}
        {screen.name === 'process' && (
          <ProcessScreen key={screen.id} id={screen.id} onExit={() => setScreen({ name: 'images' })} onOpen={(id) => setScreen({ name: 'process', id })} />
        )}
      </main>
    </div>
  );
}
