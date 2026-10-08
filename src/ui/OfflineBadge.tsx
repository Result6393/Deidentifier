import { useEffect, useState } from 'preact/hooks';

/** Whether the app is installed for offline use, and whether the device is online. */
export function useOfflineStatus() {
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
  return { ready, online };
}

export const offlineText = (s: { ready: boolean; online: boolean }) =>
  `On-device only${s.ready ? ' · offline ready' : ''}${s.online ? '' : ' · no network'}`;
