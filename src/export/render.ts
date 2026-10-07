import type { Box } from '../types';
import { rectToPx } from '../editor/boxes';

export const REDACTION_FILL = '#000000';

function drawStamp(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number): void {
  let size = Math.max(8, Math.min(h * 0.7, (w * 1.6) / Math.max(1, text.length)));
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  const measured = ctx.measureText(text).width;
  if (measured > w * 0.92) {
    size *= (w * 0.92) / measured;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
}

/**
 * Produces the export image: a brand-new canvas holding the straightened
 * pixels with every accepted box painted solid. Nothing else (no layers, no
 * metadata, no original file name) is carried over.
 */
export function renderRedacted(flat: HTMLCanvasElement, boxes: Box[], maxEdge: number | null): HTMLCanvasElement {
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(flat.width, flat.height)) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(flat.width * scale));
  c.height = Math.max(1, Math.round(flat.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(flat, 0, 0, c.width, c.height);
  for (const b of boxes) {
    if (b.status !== 'accepted') continue;
    const p = rectToPx(b, c.width, c.height);
    // Round outwards so anti-aliasing can't leave a faint edge of text.
    const x = Math.floor(p.x0);
    const y = Math.floor(p.y0);
    const w = Math.ceil(p.x1) - x;
    const h = Math.ceil(p.y1) - y;
    ctx.fillStyle = REDACTION_FILL;
    ctx.fillRect(x, y, w, h);
    if (b.stamp) drawStamp(ctx, b.stamp, x, y, w, h);
  }
  return c;
}
