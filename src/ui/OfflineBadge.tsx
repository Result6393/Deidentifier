import { useEffect, useState } from 'preact/hooks';

/** Shows whether the app is installed for offline use and whether the device is online. */
export function OfflineBadge() {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    navigator.serviceWorker?.ready.then(() => setReady(true));
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <div class="badge" title="Photos are processed on this device and never uploaded.">
      On-device{ready ? ' · offline ready' : ''}
      {!online && ' · no network'}
    </div>
  );
}
