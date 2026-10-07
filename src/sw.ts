/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// Only the app's own static files are cached. Photos are never cached.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/.*/] });

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Photos shared from Android are held in memory until the page collects them.
let shared: Promise<File[]> | null = null;
let delivered: (() => void) | null = null;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  shared = event.request
    .formData()
    .then((form) => form.getAll('images').filter((f): f is File => f instanceof File))
    .catch(() => []);
  event.respondWith(Response.redirect(new URL('./?share=1', self.registration.scope).href, 303));
  event.waitUntil(
    new Promise<void>((resolve) => {
      delivered = resolve;
      setTimeout(resolve, 60000);
    }).then(() => {
      shared = null;
      delivered = null;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'share-ready') return;
  const source = event.source as Client | null;
  event.waitUntil(
    (async () => {
      const files = (await shared) ?? [];
      shared = null;
      source?.postMessage({ type: 'share-files', files });
      delivered?.();
    })(),
  );
});
