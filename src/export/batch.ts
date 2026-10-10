import type { WorkImage } from '../state/session';
import { decodeImage, zeroCanvas } from '../state/session';
import { renderRedacted } from './render';
import { exportName, toBlob, type ImageType, type NamedBlob } from './output';

export interface ExportOptions {
  /** Limit the longest edge to 2000 px (smaller files). */
  limit: boolean;
  format: ImageType;
  /** Keep the photo's full size and a high quality (used when replacing originals). */
  full?: boolean;
}

/** Why an image shouldn't be exported as-is. Empty means it looks ready. */
export function problems(images: WorkImage[]): string[] {
  const out: string[] = [];
  const none = images.map((img, i) => (img.boxes.length === 0 ? i + 1 : 0)).filter(Boolean);
  const notDone = images.map((img, i) => (!img.done ? i + 1 : 0)).filter(Boolean);
  if (none.length) out.push(`No black boxes on image${none.length > 1 ? 's' : ''} ${none.join(', ')}.`);
  if (notDone.length) out.push(`Not marked Done: image${notDone.length > 1 ? 's' : ''} ${notDone.join(', ')}.`);
  return out;
}

/** Renders one image with its boxes painted solid, decoded and released here. */
export async function renderOne(img: WorkImage, opts: ExportOptions): Promise<Blob> {
  const src = await decodeImage(img.blob, img.rotation, opts.full ? 10000 : opts.limit ? 2400 : 4000);
  const rendered = renderRedacted(src, img.boxes, !opts.full && opts.limit ? 2000 : null);
  zeroCanvas(src);
  try {
    return await toBlob(rendered, opts.format, opts.full ? 0.95 : 0.92);
  } finally {
    zeroCanvas(rendered);
  }
}

/**
 * Renders every image with its boxes painted solid. One photo is decoded,
 * rendered, encoded and released at a time, so memory stays flat.
 */
export async function renderBatch(images: WorkImage[], opts: ExportOptions, onProgress: (done: number) => void): Promise<NamedBlob[]> {
  const out: NamedBlob[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    out.push({ name: exportName(i, opts.format), blob: await renderOne(img, opts) });
    onProgress(i + 1);
  }
  return out;
}
