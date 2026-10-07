import { createWorker, type Worker } from 'tesseract.js';
import type { OcrLine } from '../types';

// Every OCR asset is served from this app's own origin (see scripts/vendor.mjs).
const vendor = (file = '') => new URL(`${import.meta.env.BASE_URL}vendor/tesseract/${file}`, location.href).href;

let workerPromise: Promise<Worker> | null = null;
let progressFn: ((p: number) => void) | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng', 1, {
    workerPath: vendor('worker.min.js'),
    corePath: vendor(),
    langPath: vendor().replace(/\/$/, ''),
    // Language data comes from the offline app cache; don't copy it to IndexedDB.
    cacheMethod: 'none',
    workerBlobURL: false,
    gzip: true,
    logger: (m) => {
      if (m.status === 'recognizing text') progressFn?.(m.progress);
    },
  }).catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

/** Starts loading the OCR engine in the background. */
export function warmUpOcr(): void {
  getWorker().catch(() => undefined);
}

const MAX_OCR_EDGE = 2400;

function prepare(src: HTMLCanvasElement, invert: boolean): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(1, MAX_OCR_EDGE / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  const ctx = c.getContext('2d')!;
  if (invert) ctx.filter = 'invert(1)';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { canvas: c, scale };
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Reads printed text from a canvas on this device and returns lines of
 * words in the canvas's pixel coordinates. `invert` adds a second pass for
 * light-on-dark text such as Optos overlays.
 */
export function recognizeLines(src: HTMLCanvasElement, opts: { invert?: boolean; onProgress?: (p: number) => void } = {}): Promise<OcrLine[]> {
  const run = async () => {
    const worker = await getWorker();
    const passes = opts.invert ? [false, true] : [false];
    const lines: OcrLine[] = [];
    for (let i = 0; i < passes.length; i++) {
      const { canvas, scale } = prepare(src, passes[i]);
      progressFn = (p) => opts.onProgress?.((i + p) / passes.length);
      try {
        const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
        for (const block of data.blocks ?? []) {
          for (const para of block.paragraphs) {
            for (const line of para.lines) {
              lines.push({
                words: line.words
                  .filter((w) => w.text.trim())
                  .map((w) => ({
                    text: w.text,
                    bbox: { x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale },
                  })),
              });
            }
          }
        }
      } finally {
        progressFn = null;
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    return lines;
  };
  const job = queue.then(run, run);
  queue = job.catch(() => undefined);
  return job;
}
