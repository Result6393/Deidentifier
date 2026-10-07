import type { BBox } from '../types';

interface DetectorLike {
  detect(src: CanvasImageSource): Promise<{ boundingBox: DOMRectReadOnly }[]>;
}

/** Finds barcodes/QR codes where the browser supports it (e.g. Android Chrome). */
export async function findBarcodes(canvas: HTMLCanvasElement): Promise<BBox[]> {
  const BD = (window as unknown as { BarcodeDetector?: new () => DetectorLike }).BarcodeDetector;
  if (!BD) return [];
  try {
    const found = await new BD().detect(canvas);
    return found.map(({ boundingBox: b }) => ({ x0: b.left, y0: b.top, x1: b.right, y1: b.bottom }));
  } catch {
    return [];
  }
}

export const barcodeSupported = () => 'BarcodeDetector' in window;
