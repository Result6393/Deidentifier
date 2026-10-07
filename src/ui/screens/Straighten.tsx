import { useEffect, useRef, useState } from 'preact/hooks';
import { changed, zeroCanvas, type WorkImage } from '../../state/session';
import { defaultQuad, detectQuad } from '../../geometry/corners';
import { warpQuad } from '../../geometry/warp';
import { rotateCanvas } from '../../capture/load';
import type { Pt } from '../../types';

const DISPLAY_MAX = 1400;
const LOUPE = 130;
const LOUPE_ZOOM = 3;

function autoQuad(src: HTMLCanvasElement): Pt[] {
  const scale = 400 / Math.max(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(src.width * scale));
  c.height = Math.max(2, Math.round(src.height * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const quad = detectQuad(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  zeroCanvas(c);
  return quad;
}

const isWholeImage = (q: Pt[]) => defaultQuad(0).every((p, i) => Math.abs(p.x - q[i].x) < 0.002 && Math.abs(p.y - q[i].y) < 0.002);

function flatten(src: HTMLCanvasElement, quad: Pt[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  if (isWholeImage(quad)) {
    out.width = src.width;
    out.height = src.height;
    out.getContext('2d')!.drawImage(src, 0, 0);
    return out;
  }
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, src.width, src.height);
  const px = quad.map((p) => ({ x: p.x * (src.width - 1), y: p.y * (src.height - 1) }));
  const warped = warpQuad(data, px, 3000);
  out.width = warped.width;
  out.height = warped.height;
  out.getContext('2d')!.putImageData(warped, 0, 0);
  return out;
}

export function StraightenStep({ img, onNext }: { img: WorkImage; onNext: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [quad, setQuad] = useState<Pt[]>(() => img.quad ?? autoQuad(img.source));
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const c = canvasRef.current!;
    const src = img.source;
    const scale = Math.min(1, DISPLAY_MAX / Math.max(src.width, src.height));
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    return () => zeroCanvas(c);
  }, [img.source, img.source.width]);

  const toNorm = (e: PointerEvent): Pt => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const drawLoupe = (p: Pt) => {
    const l = loupeRef.current;
    if (!l) return;
    l.width = LOUPE;
    l.height = LOUPE;
    const ctx = l.getContext('2d')!;
    const src = img.source;
    const size = LOUPE / LOUPE_ZOOM;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(src, p.x * src.width - size / 2, p.y * src.height - size / 2, size, size, 0, 0, LOUPE, LOUPE);
    ctx.strokeStyle = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, 0);
    ctx.lineTo(LOUPE / 2, LOUPE);
    ctx.moveTo(0, LOUPE / 2);
    ctx.lineTo(LOUPE, LOUPE / 2);
    ctx.stroke();
  };

  const onDown = (i: number) => (e: PointerEvent) => {
    e.preventDefault();
    surfaceRef.current!.setPointerCapture(e.pointerId);
    setDragging(i);
    drawLoupe(quad[i]);
  };
  const onMove = (e: PointerEvent) => {
    if (dragging === null) return;
    const p = toNorm(e);
    setQuad((q) => q.map((old, i) => (i === dragging ? p : old)));
    drawLoupe(p);
  };
  const onUp = () => setDragging(null);

  const rotate = () => {
    img.source = rotateCanvas(img.source);
    const q = autoQuad(img.source);
    setQuad(q);
    setVersion((v) => v + 1);
    changed();
  };

  const apply = (q: Pt[]) => {
    const unchanged = img.flat && img.quad && img.quad.every((p, i) => p.x === q[i].x && p.y === q[i].y);
    if (unchanged) return onNext();
    setBusy(true);
    // Let the spinner paint before the (synchronous) warp.
    setTimeout(() => {
      try {
        zeroCanvas(img.flat);
        img.flat = flatten(img.source, q);
        img.quad = q;
        img.boxes = [];
        img.ocr = 'idle';
        changed();
        onNext();
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const points = quad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  const loupeLeft = dragging !== null && quad[dragging].x < 0.5;

  return (
    <div class="card stack">
      <h2>Straighten</h2>
      <p class="muted small">Drag the four corners onto the edges of the screen or page. Everything outside is cropped away.</p>
      <div class="straighten-wrap">
        <div ref={surfaceRef} class="surface" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <canvas ref={canvasRef} class="display" />
          <svg class="overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points={points} class="quad" vector-effect="non-scaling-stroke" />
          </svg>
          {quad.map((p, i) => (
            <div key={i} class={`corner ${dragging === i ? 'active' : ''}`} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} onPointerDown={onDown(i)} />
          ))}
        </div>
        <canvas ref={loupeRef} class={`loupe ${loupeLeft ? 'right' : 'left'}`} hidden={dragging === null} />
      </div>
      <div class="row wrap">
        <button class="btn" onClick={() => setQuad(autoQuad(img.source))}>
          Auto-detect
        </button>
        <button class="btn" onClick={() => setQuad(defaultQuad(0))}>
          Whole image
        </button>
        <button class="btn" onClick={rotate}>
          Rotate ↻
        </button>
        <span class="spacer" />
        <button class="btn primary big" disabled={busy} onClick={() => apply(quad)} data-testid="flatten">
          {busy ? 'Straightening…' : 'Straighten & continue'}
        </button>
      </div>
    </div>
  );
}
