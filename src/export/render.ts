import type { Box } from '../types';

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
 * Produces the export image: a brand-new canvas holding the photo's pixels
 * with every box painted solid. Nothing else (no layers, no metadata, no
 * original file name) is carried over.
 */
export function renderRedacted(src: HTMLCanvasElement, boxes: Box[], maxEdge: number | null): HTMLCanvasElement {
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(src.width, src.height)) : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  for (const b of boxes) {
    // Round outwards so anti-aliasing can't leave a faint edge of text.
    const x = Math.floor(b.x * c.width);
    const y = Math.floor(b.y * c.height);
    const w = Math.ceil((b.x + b.w) * c.width) - x;
    const h = Math.ceil((b.y + b.h) * c.height) - y;
    ctx.fillStyle = REDACTION_FILL;
    ctx.fillRect(x, y, w, h);
    if (b.stamp) drawStamp(ctx, b.stamp, x, y, w, h);
  }
  return c;
}
