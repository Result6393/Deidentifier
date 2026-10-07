import type { BBox, Box, SearchTerms } from '../types';
import { analyze, contains } from '../detect/analyze';
import { recognizeLines } from '../detect/ocr';
import { findBarcodes } from '../detect/barcode';
import { rectToPx } from '../editor/boxes';

export interface Finding {
  bbox: BBox;
  reason: string;
}

/**
 * Re-reads the final export image and reports anything that still looks
 * like an identifier outside the redaction boxes.
 */
export async function verifyOutput(
  out: HTMLCanvasElement,
  boxes: Box[],
  terms: SearchTerms,
  opts: { invert?: boolean; onProgress?: (p: number) => void } = {},
): Promise<Finding[]> {
  const covered = boxes.filter((b) => b.status === 'accepted').map((b) => rectToPx(b, out.width, out.height));
  const outside = (bbox: BBox) => !covered.some((c) => contains(c, bbox, 0.5));
  const lines = await recognizeLines(out, opts);
  const findings: Finding[] = analyze(lines, terms)
    .filter((h) => h.status === 'accepted' && outside(h.bbox))
    .map(({ bbox, reason }) => ({ bbox, reason }));
  for (const bbox of await findBarcodes(out)) {
    if (outside(bbox)) findings.push({ bbox, reason: 'Barcode or QR code' });
  }
  return findings;
}
