import { newId, type WorkImage } from '../state/session';

const MAX_EDGE = 4000;

export function bitmapToCanvas(bmp: ImageBitmap | HTMLVideoElement, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** Decodes a photo straight into a canvas, applying its EXIF rotation. */
export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    return bitmapToCanvas(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

export function newWorkImage(source: HTMLCanvasElement): WorkImage {
  return { id: newId(), source, type: null, quad: null, flat: null, boxes: [], ocr: 'idle', exported: false };
}

/** Rotates a canvas 90° clockwise, wiping the old one. */
export function rotateCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  src.width = 0;
  src.height = 0;
  return c;
}
