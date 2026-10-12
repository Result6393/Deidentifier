import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addFiles, wipeEpoch } from '../state/session';
import { ask } from '../ui/ConfirmDialog';

// pdf.js is bundled with the app (worker, decoders and fonts under vendor/pdfjs, see
// scripts/vendor-pdf.mjs) and loaded only when a PDF is opened. The "legacy" build carries
// polyfills, so it also works in browsers that lack the newest JavaScript features.
const vendor = () => new URL(`${import.meta.env.BASE_URL}vendor/pdfjs/`, location.href).href;
let lib: Promise<typeof PdfJs> | null = null;
function loadPdfJs(): Promise<typeof PdfJs> {
  lib ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${vendor()}pdf.worker.min.mjs`;
    return m;
  });
  lib.catch(() => (lib = null));
  return lib;
}

export const isPdf = (f: Blob & { name?: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name ?? '');

/** 200 dpi: handwriting stays sharp, an A4 page is about 1654 × 2339 px. */
const DPI = 200;
const MAX_EDGE = 4000;
const MANY_PAGES = 60;

export interface PdfPages {
  blobs: Blob[];
  /** Shown in the file bar, e.g. "notes.pdf — p3 of 8". */
  names: string[];
  /** Used for "Save" file names, e.g. "notes p3". */
  stems: string[];
}

export class PdfError extends Error {}

/**
 * Turns every page of a PDF into a JPEG, on this device. Only the rendered pixels are kept, so the
 * PDF's hidden text layer, metadata, annotations and attachments never reach an exported file.
 * Resolves null if the user declines to open a very long PDF.
 */
export async function pdfToImages(file: Blob, name: string, onPage: (page: number, of: number) => void): Promise<PdfPages | null> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl: `${vendor()}wasm/`,
    standardFontDataUrl: `${vendor()}standard_fonts/`,
    iccUrl: `${vendor()}iccs/`,
    // Draw text as shapes rather than loading fonts into the page; never render forms (XFA).
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
  });
  let doc: PdfJs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    const n = (e as Error)?.name;
    if (n === 'PasswordException') throw new PdfError(`Couldn't open “${name}”: it is password-protected. Save an unprotected copy and import that.`);
    throw new PdfError(`Couldn't open “${name}”: it doesn't look like a valid PDF.`);
  }
  try {
    const n = doc.numPages;
    if (n > MANY_PAGES) {
      const c = await ask({
        title: `“${name}” has ${n} pages`,
        body: 'Every page is opened as a photo and held in memory while you work. That many pages may be slow.',
        choices: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'go', label: `Open all ${n} pages` },
        ],
        focus: 'cancel',
      });
      if (c !== 'go') return null;
    }
    const stem = name.replace(/\.pdf$/i, '') || 'document';
    const out: PdfPages = { blobs: [], names: [], stems: [] };
    for (let i = 1; i <= n; i++) {
      onPage(i, n);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(DPI / 72, MAX_EDGE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE, background: '#ffffff' }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      if (!blob) throw new PdfError(`Couldn't render page ${i} of “${name}”.`);
      out.blobs.push(blob);
      out.names.push(`${name} — p${i} of ${n}`);
      out.stems.push(`${stem} p${i}`);
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/**
 * Opens a PDF and adds each page to the session as a photo. Pages are never linked to the original
 * file (they always save as new files). Returns the number of pages added (0 if cancelled).
 */
export async function addPdf(file: Blob, name: string, onPage: (page: number, of: number) => void): Promise<number> {
  const epoch = wipeEpoch();
  const pages = await pdfToImages(file, name, onPage);
  // The session may have been ended while the pages were rendering.
  if (!pages || epoch !== wipeEpoch()) return 0;
  const failed = await addFiles(pages.blobs, undefined, pages.names, pages.stems);
  return pages.blobs.length - failed;
}
