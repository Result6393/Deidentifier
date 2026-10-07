/**
 * Collects photos shared into the app from Android's share sheet. The
 * service worker holds them in memory only until this page asks for them.
 */
export async function collectSharedFiles(): Promise<File[]> {
  const url = new URL(location.href);
  if (!url.searchParams.has('share') || !('serviceWorker' in navigator)) return [];
  url.searchParams.delete('share');
  history.replaceState(null, '', url.pathname + url.search);
  const reg = await navigator.serviceWorker.ready;
  const worker = navigator.serviceWorker.controller ?? reg.active;
  if (!worker) return [];
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 15000);
    navigator.serviceWorker.addEventListener('message', function onMessage(e: MessageEvent) {
      if (e.data?.type !== 'share-files') return;
      navigator.serviceWorker.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve((e.data.files as File[]) ?? []);
    });
    worker.postMessage({ type: 'share-ready' });
  });
}
