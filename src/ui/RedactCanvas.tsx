import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { clampRect, makeBox } from '../editor/boxes';
import { zeroCanvas, type WorkImage } from '../state/session';
import type { Pt, Rect } from '../types';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'draw'; id: string; start: Pt; /** Screen position of the press, to tell a tap from a drag. */ at: Pt }
  | { kind: 'move'; id: string; start: Pt; orig: Rect }
  | { kind: 'resize'; id: string; start: Pt; orig: Rect; corner: Corner };

interface Props {
  img: WorkImage;
  canvas: HTMLCanvasElement | null;
  selected: string | null;
  setSelected: (id: string | null) => void;
  drawMode: boolean;
  solid: boolean;
  /** 0 = fit the whole photo in the frame; otherwise a multiple of actual size (1 = one photo pixel per screen pixel). */
  zoom: number;
  /** The photo's real width in pixels as shown (after rotation). */
  pxW: number;
  /** Called after any box is moved, resized, drawn or removed. */
  onEdit: () => void;
  /** Called with +1 (next) or -1 (previous) after a horizontal swipe on the photo. */
  onSwipe: (delta: number) => void;
  /** Floating controls for the selected box, drawn over the frame so they never move the photo. */
  boxBar?: ComponentChildren;
  /** Where the floating bar sits: away from the selected box. */
  boxBarAt?: 'top' | 'bottom';
  /** Centered message over the photo (e.g. before a type is chosen). */
  hint?: string;
  hintAt?: 'top' | 'center';
}

export function RedactCanvas({ img, canvas, selected, setSelected, drawMode, solid, zoom, pxW, onEdit, onSwipe, boxBar, boxBarAt = 'bottom', hint, hintAt = 'center' }: Props) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const center = useRef({ x: 0.5, y: 0.5 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [, tick] = useState(0);
  const swipe = useRef<{ x: number; y: number; t: number; id: number } | null>(null);

  // Paint the decoded photo over the instant low-res placeholder.
  useEffect(() => {
    const d = displayRef.current;
    if (!d || !canvas || !canvas.width) return;
    d.width = canvas.width;
    d.height = canvas.height;
    d.getContext('2d')!.drawImage(canvas, 0, 0);
    return () => zeroCanvas(d);
  }, [canvas]);

  // Remember which part of the photo is in the middle of the view, so a zoom change can keep it there.
  const trackCenter = () => {
    const v = viewRef.current;
    const sf = surfaceRef.current;
    if (!v || !sf) return;
    center.current = { x: (v.scrollLeft + v.clientWidth / 2 - sf.offsetLeft) / sf.offsetWidth, y: (v.scrollTop + v.clientHeight / 2 - sf.offsetTop) / sf.offsetHeight };
  };
  const selectedBox = img.boxes.find((b) => b.id === selected);
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const v = viewRef.current;
    const sf = surfaceRef.current;
    if (!v || !sf || prevZoom.current === zoom) return;
    prevZoom.current = zoom;
    // Zoom toward the selected box if there is one, otherwise toward where you were looking.
    const t = selectedBox ? { x: selectedBox.x + selectedBox.w / 2, y: selectedBox.y + selectedBox.h / 2 } : center.current;
    v.scrollLeft = Math.max(0, sf.offsetLeft + t.x * sf.offsetWidth - v.clientWidth / 2);
    v.scrollTop = Math.max(0, sf.offsetTop + t.y * sf.offsetHeight - v.clientHeight / 2);
    trackCenter();
  }, [zoom]);

  const toNorm = (e: PointerEvent): Pt => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    const p = toNorm(e);
    const boxEl = target.closest<HTMLElement>('[data-box]');
    const corner = target.dataset.corner as Corner | undefined;
    // While drawing, a drag on empty photo draws a new box; a press on an existing box selects and moves it
    // (or resizes it from a handle), exactly as when drawing is off.
    if (drawMode && !boxEl) {
      const b = makeBox({ x: p.x, y: p.y, w: 0, h: 0 });
      img.boxes.push(b);
      setSelected(b.id);
      setDrag({ kind: 'draw', id: b.id, start: p, at: { x: e.clientX, y: e.clientY } });
    } else if (boxEl) {
      const b = img.boxes.find((x) => x.id === boxEl.dataset.box)!;
      setSelected(b.id);
      setDrag(corner ? { kind: 'resize', id: b.id, start: p, orig: { ...b }, corner } : { kind: 'move', id: b.id, start: p, orig: { ...b } });
    } else {
      setSelected(null);
      // A touch that starts on empty photo at 1× may become a swipe to the next photo.
      if (zoom === 0 && e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
      return;
    }
    e.preventDefault();
    surfaceRef.current!.setPointerCapture(e.pointerId);
  };

  const endSwipe = (e: PointerEvent) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return false;
    swipe.current = null;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Date.now() - s.t < 800 && Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
    return true;
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

  const onUp = (e: PointerEvent) => {
    if (e.type === 'pointerup' && endSwipe(e)) return;
    swipe.current = null;
    if (!drag) return;
    if (drag.kind === 'draw') {
      const b = img.boxes.find((x) => x.id === drag.id);
      const tapped = Math.hypot(e.clientX - drag.at.x, e.clientY - drag.at.y) < 6;
      if (b && (tapped || b.w < 0.004 || b.h < 0.004)) {
        // Not a real drag (a tap on empty photo): drop the sliver and deselect.
        img.boxes = img.boxes.filter((x) => x !== b);
        setSelected(null);
      }
    }
    setDrag(null);
    onEdit();
  };

  return (
    <div class="frame">
    <div class="viewport" ref={viewRef} onScroll={trackCenter}>
      <div
        ref={surfaceRef}
        class={`surface ${drawMode ? 'drawing' : ''} ${zoom === 0 && !drawMode ? 'swipeable' : ''}`}
        // At 1× the whole photo fits the frame; zoomed, it grows and the frame scrolls.
        style={{ aspectRatio: String(img.aspect), width: zoom === 0 ? `min(100%, calc(var(--frame-h) * ${img.aspect}))` : `${(pxW / (window.devicePixelRatio || 1)) * zoom}px` }}
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
      {hint && <div class={`photo-hint ${hintAt}`}>{hint}</div>}
      {boxBar && <div class={`box-bar ${boxBarAt}`}>{boxBar}</div>}
    </div>
  );
}
