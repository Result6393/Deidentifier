import type { BBox, Hit, OcrLine, SearchTerms } from '../types';
import { findSpans } from './patterns';

/** Joins words into the line text and records each word's character range. */
export function lineText(line: OcrLine): { text: string; ranges: [number, number][] } {
  let text = '';
  const ranges: [number, number][] = [];
  for (const w of line.words) {
    if (text) text += ' ';
    ranges.push([text.length, text.length + w.text.length]);
    text += w.text;
  }
  return { text, ranges };
}

function union(boxes: BBox[]): BBox {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Pads a box by a fraction of its height so ascenders/descenders are covered. */
export function pad(b: BBox, frac = 0.25): BBox {
  const p = Math.max(2, (b.y1 - b.y0) * frac);
  return { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p };
}

/** Finds identifier hits in OCR lines, as padded pixel boxes. */
export function analyze(lines: OcrLine[], terms: SearchTerms): Hit[] {
  const hits: Hit[] = [];
  for (const line of lines) {
    if (!line.words.length) continue;
    const { text, ranges } = lineText(line);
    for (const span of findSpans(text, terms)) {
      const words = line.words.filter((_, i) => ranges[i][0] < span.end && ranges[i][1] > span.start);
      if (!words.length) continue;
      hits.push({ bbox: pad(union(words.map((w) => w.bbox))), reason: span.reason, status: span.status });
    }
  }
  // Collapse duplicates: keep the accepted version of an identical box.
  const out: Hit[] = [];
  for (const h of hits.sort((a, b) => (a.status === 'accepted' ? -1 : 1) - (b.status === 'accepted' ? -1 : 1))) {
    if (!out.some((o) => contains(o.bbox, h.bbox, 0.9))) out.push(h);
  }
  return out;
}

/** True when at least `frac` of `inner`'s area lies inside `outer`. */
export function contains(outer: BBox, inner: BBox, frac = 0.5): boolean {
  const ix = Math.max(0, Math.min(outer.x1, inner.x1) - Math.max(outer.x0, inner.x0));
  const iy = Math.max(0, Math.min(outer.y1, inner.y1) - Math.max(outer.y0, inner.y0));
  const area = Math.max(1e-9, (inner.x1 - inner.x0) * (inner.y1 - inner.y0));
  return (ix * iy) / area >= frac;
}
