import { useEffect, useRef, useState } from 'preact/hooks';
import { clampRect, makeBox } from '../editor/boxes';
import { zeroCanvas, type WorkImage } from '../state/session';
import type { Pt, Rect } from '../types';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'draw'; id: string; start: Pt }
  | { kind: 'move'; id: string; start: Pt; orig: Rect }
  | { kind: 'resize'; id: string; start: Pt; orig: Rect; corner: Corner };

interface Props {
  img: WorkImage;
  canvas: HTMLCanvasElement | null;
  selected: string | null;
  setSelected: (id: string | null) => void;
  drawMode: boolean;
  setDrawMode: (on: boolean) => void;
  solid: boolean;
  zoom: number;
  /** Called after any box is moved, resized, drawn or removed. */
  onEdit: () => void;
}

export function RedactCanvas({ img, canvas, selected, setSelected, drawMode, setDrawMode, solid, zoom, onEdit }: Props) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [, tick] = useState(0);

  // Paint the decoded photo over the instant low-res placeholder.
  useEffect(() => {
    const d = displayRef.current;
    if (!d || !canvas || !canvas.width) return;
    d.width = canvas.width;
    d.height = canvas.height;
    d.getContext('2d')!.drawImage(canvas, 0, 0);
    return () => zeroCanvas(d);
  }, [canvas]);

  const toNorm = (e: PointerEvent): Pt => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    const p = toNorm(e);
    const boxEl = target.closest<HTMLElement>('[data-box]');
    const corner = target.dataset.corner as Corner | undefined;
    if (drawMode) {
      const b = makeBox({ x: p.x, y: p.y, w: 0, h: 0 });
      img.boxes.push(b);
      setSelected(b.id);
      setDrag({ kind: 'draw', id: b.id, start: p });
    } else if (boxEl) {
      const b = img.boxes.find((x) => x.id === boxEl.dataset.box)!;
      setSelected(b.id);
      setDrag(corner ? { kind: 'resize', id: b.id, start: p, orig: { ...b }, corner } : { kind: 'move', id: b.id, start: p, orig: { ...b } });
    } else {
      setSelected(null);
      return;
    }
    e.preventDefault();
    surfaceRef.current!.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const b = img.boxes.find((x) => x.id === drag.id);
    if (!b) return;
    const p = toNorm(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (drag.kind === 'draw') {
      Object.assign(b, clampRect({ x: drag.start.x, y: drag.start.y, w: dx, h: dy }));
    } else if (drag.kind === 'move') {
      b.x = Math.min(1 - b.w, Math.max(0, drag.orig.x + dx));
      b.y = Math.min(1 - b.h, Math.max(0, drag.orig.y + dy));
    } else {
      const o = drag.orig;
      let x0 = o.x;
      let y0 = o.y;
      let x1 = o.x + o.w;
      let y1 = o.y + o.h;
      if (drag.corner.includes('w')) x0 += dx;
      else x1 += dx;
      if (drag.corner.includes('n')) y0 += dy;
      else y1 += dy;
      Object.assign(b, clampRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
    }
    tick((n) => n + 1);
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.kind === 'draw') {
      const b = img.boxes.find((x) => x.id === drag.id);
      if (b && (b.w < 0.004 || b.h < 0.004)) {
        img.boxes = img.boxes.filter((x) => x !== b);
        setSelected(null);
      }
      setDrawMode(false);
    }
    setDrag(null);
    onEdit();
  };

  return (
    <div class="viewport">
      <div
        ref={surfaceRef}
        class={`surface ${drawMode ? 'drawing' : ''}`}
        // At 1× the whole photo fits the frame; zoomed, it grows and the frame scrolls.
        style={{ aspectRatio: String(img.aspect), width: zoom === 1 ? `min(100%, calc(var(--frame-h) * ${img.aspect}))` : `${zoom * 100}%` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        data-testid="redact-surface"
      >
        <img class="display full" src={img.thumb} alt="" draggable={false} />
        {canvas && <canvas ref={displayRef} class="display full" />}
        {img.boxes.map((b) => (
          <div
            key={b.id}
            data-box={b.id}
            class={`rbox ${solid ? 'solid' : ''} ${selected === b.id ? 'selected' : ''}`}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
          >
            {b.stamp && <span class="stamp">{b.stamp}</span>}
            {selected === b.id && (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => <div key={c} class={`handle ${c}`} data-corner={c} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
