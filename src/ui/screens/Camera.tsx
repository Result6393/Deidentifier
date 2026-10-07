import { useEffect, useRef, useState } from 'preact/hooks';
import { capturePhoto, startCamera, stopCamera } from '../../capture/camera';
import { newWorkImage } from '../../capture/load';
import { changed, onWipe, session } from '../../state/session';

export function CameraScreen({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    startCamera(videoRef.current!)
      .then((s) => {
        if (cancelled) stopCamera(s);
        else streamRef.current = s;
      })
      .catch(() => setError('Camera unavailable. Allow camera access, or use Import photos instead.'));
    const unhook = onWipe(() => stopCamera(streamRef.current, videoRef.current));
    return () => {
      cancelled = true;
      unhook();
      stopCamera(streamRef.current, videoRef.current);
    };
  }, []);

  const shoot = async () => {
    if (!streamRef.current || !videoRef.current) return;
    setBusy(true);
    try {
      session.images.push(newWorkImage(await capturePhoto(streamRef.current, videoRef.current)));
      changed();
      setCount((c) => c + 1);
    } catch {
      setError('Could not take the photo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="camera">
      <video ref={videoRef} playsInline muted />
      {error && <p class="error">{error}</p>}
      <div class="row camera-bar">
        <button class="btn big" onClick={onDone}>
          Done{count ? ` (${count})` : ''}
        </button>
        <button class="btn primary big shutter" onClick={shoot} disabled={busy || !!error} aria-label="Take photo">
          {busy ? '…' : 'Capture'}
        </button>
      </div>
    </div>
  );
}
