import { useEffect, useRef, useState } from 'preact/hooks';
import { warpQuad } from '../geometry/warp';
import { getCanvas, replaceBlob, zeroCanvas, type WorkImage } from '../state/session';
import { toBlob } from '../export/output';
import type { Pt } from '../types';

const LOUPE = 130;
const LOUPE_ZOOM = 3;

const wholeImage = (inset: number): Pt[] => [
  { x: inset, y: inset },
  { x: 1 - inset, y: inset },
  { x: 1 - inset, y: 1 - inset },
  { x: inset, y: 1 - inset },
];

/** Manual perspective fix: drag four corners onto the page or screen edges. */
export function StraightenModal({ img, onClose }: { img: WorkImage; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [quad, setQuad] = useState<Pt[]>(() => wholeImage(0.04));
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getCanvas(img).then((c) => live && setSrc(c));
    return () => {
      live = false;
    };
  }, [img]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !src) return;
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    return () => zeroCanvas(c);
  }, [src]);

  const toNorm = (e: PointerEvent): Pt => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const drawLoupe = (p: Pt) => {
    const l = loupeRef.current;
    if (!l || !src) return;
    l.width = LOUPE;
    l.height = LOUPE;
    const ctx = l.getContext('2d')!;
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

  const apply = () => {
    if (!src) return;
    setBusy(true);
    // Let the button repaint before the (synchronous) warp.
    setTimeout(async () => {
      try {
        const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, src.width, src.height);
        const px = quad.map((p) => ({ x: p.x * (src.width - 1), y: p.y * (src.height - 1) }));
        const warped = warpQuad(data, px, 2400);
        const out = document.createElement('canvas');
        out.width = warped.width;
        out.height = warped.height;
        out.getContext('2d')!.putImageData(warped, 0, 0);
        await replaceBlob(img, await toBlob(out, 'image/jpeg'), out);
        zeroCanvas(out);
        onClose();
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const points = quad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  const loupeLeft = dragging !== null && quad[dragging].x < 0.5;

  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label="Straighten">
      <div class="modal-card stack">
        <h2>Straighten</h2>
        <p class="muted small">Drag the four corners onto the edges of the screen or page. Everything outside is cropped away, and this image’s boxes go back to the preset.</p>
        <div class="straighten-wrap">
          <div ref={surfaceRef} class="surface" onPointerMove={onMove} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
            <img class="display" src={img.thumb} alt="" draggable={false} />
            <canvas ref={canvasRef} class="display full" />
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
          <button class="btn" onClick={onClose}>
            Cancel
          </button>
          <button class="btn" onClick={() => setQuad(wholeImage(0.04))}>
            Reset corners
          </button>
          <span class="spacer" />
          <button class="btn primary big" disabled={busy || !src} onClick={apply} data-testid="flatten">
            {busy ? 'Straightening…' : 'Straighten'}
          </button>
        </div>
      </div>
    </div>
  );
}
