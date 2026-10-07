import { useEffect, useRef, useState } from 'preact/hooks';
import { changed, session, zeroCanvas, type WorkImage } from '../../state/session';
import { loadPreset, saveTemplate, clearTemplate, hasTemplate } from '../../presets/templates';
import { analyze, contains } from '../../detect/analyze';
import { recognizeLines } from '../../detect/ocr';
import { findBarcodes } from '../../detect/barcode';
import { clampRect, makeBox, pxToRect, rectToPx } from '../../editor/boxes';
import type { Box, Pt, Rect } from '../../types';

const DISPLAY_MAX = 1800;
const ZOOMS = [1, 1.5, 2, 3, 4];
const STAMPS = ['RE', 'LE', 'OD', 'OS', 'OU'];

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'draw'; id: string; start: Pt }
  | { kind: 'move'; id: string; start: Pt; orig: Rect }
  | { kind: 'resize'; id: string; start: Pt; orig: Rect; corner: Corner };

function presetBoxes(img: WorkImage): Box[] {
  return img.type ? loadPreset(img.type).map((r) => makeBox(r, 'preset', 'accepted', 'Preset region')) : [];
}

/** Runs OCR + barcode detection and adds anything not already covered. */
async function scan(img: WorkImage, onProgress: (p: number) => void): Promise<void> {
  const flat = img.flat;
  if (!flat) return;
  img.ocr = 'running';
  changed();
  try {
    const invert = img.type === 'optos1' || img.type === 'optos2';
    const lines = await recognizeLines(flat, { invert, onProgress });
    const hits = analyze(lines, session.terms);
    const barcodes = await findBarcodes(flat);
    // The image may have been wiped or re-straightened meanwhile.
    if (img.flat !== flat || !session.images.includes(img)) return;
    const found = [
      ...hits.map((h) => ({ rect: pxToRect(h.bbox, flat.width, flat.height), status: h.status, reason: h.reason, source: 'ocr' as const })),
      ...barcodes.map((b) => ({ rect: pxToRect(b, flat.width, flat.height), status: 'accepted' as const, reason: 'Barcode or QR code', source: 'barcode' as const })),
    ];
    const covered = img.boxes.filter((b) => b.status === 'accepted').map((b) => rectToPx(b, 1, 1));
    for (const f of found) {
      const px = rectToPx(f.rect, 1, 1);
      if (covered.some((c) => contains(c, px, 0.9))) continue;
      if (img.boxes.some((b) => contains(rectToPx(b, 1, 1), px, 0.9) && contains(px, rectToPx(b, 1, 1), 0.9))) continue;
      img.boxes.push(makeBox(f.rect, f.source, f.status, f.reason));
    }
    img.ocr = 'done';
  } catch {
    if (img.flat === flat) img.ocr = 'failed';
  }
  changed();
}

export function RedactStep({ img, onNext }: { img: WorkImage; onNext: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [solid, setSolid] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [progress, setProgress] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, rerender] = useState(0);
  const update = () => {
    rerender((n) => n + 1);
    changed();
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const flat = img.flat!;
    const scale = Math.min(1, DISPLAY_MAX / Math.max(flat.width, flat.height));
    c.width = Math.round(flat.width * scale);
    c.height = Math.round(flat.height * scale);
    c.getContext('2d')!.drawImage(flat, 0, 0, c.width, c.height);
    return () => zeroCanvas(c);
  }, [img.flat]);

  useEffect(() => {
    if (img.ocr === 'idle') {
      if (!img.boxes.length) img.boxes = presetBoxes(img);
      scan(img, setProgress);
    }
  }, [img]);

  const box = img.boxes.find((b) => b.id === selected) ?? null;
  const suggestions = img.boxes.filter((b) => b.status === 'suggested');

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
      const b = makeBox({ x: p.x, y: p.y, w: 0, h: 0 }, 'manual', 'accepted', 'Drawn by you');
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
    rerender((n) => n + 1);
  };

  const onUp = () => {
    if (drag?.kind === 'draw') {
      const b = img.boxes.find((x) => x.id === drag.id);
      if (b && (b.w < 0.004 || b.h < 0.004)) {
        img.boxes = img.boxes.filter((x) => x !== b);
        setSelected(null);
      }
      setDrawMode(false);
    }
    setDrag(null);
    update();
  };

  const remove = (id: string) => {
    img.boxes = img.boxes.filter((b) => b.id !== id);
    setSelected(null);
    update();
  };
  const accept = (b: Box) => {
    b.status = 'accepted';
    update();
  };
  const setStamp = (b: Box, stamp?: string) => {
    b.stamp = stamp;
    b.status = 'accepted';
    update();
  };
  const acceptAll = () => {
    suggestions.forEach((b) => (b.status = 'accepted'));
    update();
  };
  const rescan = () => {
    img.boxes = img.boxes.filter((b) => b.status === 'accepted');
    scan(img, setProgress);
  };
  const resetToPreset = () => {
    if (!confirm('Replace all boxes with the preset for this image type, then scan again?')) return;
    img.boxes = presetBoxes(img);
    setSelected(null);
    scan(img, setProgress);
  };
  const saveAsTemplate = () => {
    if (!img.type) return;
    const rects = img.boxes.filter((b) => b.status === 'accepted' && (b.source === 'preset' || b.source === 'manual'));
    if (!confirm(`Save the positions of ${rects.length} preset/drawn box(es) as your template for this image type? Only box positions are saved: no image, text or stamps.`)) return;
    saveTemplate(img.type, rects);
    setMessage('Template saved. It will be used for new images of this type.');
  };
  const forgetTemplate = () => {
    if (!img.type || !confirm('Forget your saved template and go back to the built-in preset for this type?')) return;
    clearTemplate(img.type);
    setMessage('Saved template removed.');
  };

  const zoomFactor = ZOOMS[zoom];
  const scanning = img.ocr === 'running';
  const canContinue = !scanning && suggestions.length === 0;
  const stampOptions = [...(session.label ? [session.label] : []), ...STAMPS];

  return (
    <div class="card stack">
      <h2>Redact</h2>
      <div class={`status ${img.ocr}`} role="status">
        {img.ocr === 'running' && `Scanning text on this device… ${Math.round(progress * 100)}%`}
        {img.ocr === 'done' &&
          (suggestions.length
            ? `${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''} to review (orange). Tap each to keep or remove.`
            : 'Scan complete. Check the whole image for anything else, especially handwriting.')}
        {img.ocr === 'failed' && 'Text scan failed. Cover identifiers by hand and check carefully.'}
      </div>

      <div class="toolbar row wrap">
        <button class={`btn ${drawMode ? 'primary' : ''}`} onClick={() => setDrawMode(!drawMode)} data-testid="draw">
          {drawMode ? 'Drag on image…' : '+ Box'}
        </button>
        <button class="btn" onClick={() => setZoom(Math.max(0, zoom - 1))} disabled={zoom === 0} aria-label="Zoom out">
          −
        </button>
        <span class="small">{zoomFactor}×</span>
        <button class="btn" onClick={() => setZoom(Math.min(ZOOMS.length - 1, zoom + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">
          +
        </button>
        <label class="check small">
          <input type="checkbox" checked={solid} onChange={(e) => setSolid(e.currentTarget.checked)} /> Solid preview
        </label>
        {suggestions.length > 0 && (
          <button class="btn" onClick={acceptAll}>
            Keep all suggestions
          </button>
        )}
      </div>

      {box && (
        <div class="box-panel stack">
          <div class="row between wrap">
            <span class="small">
              <strong>{box.status === 'suggested' ? 'Suggestion' : 'Redaction'}:</strong> {box.reason ?? ''}
            </span>
            <div class="row">
              {box.status === 'suggested' && (
                <button class="btn primary small" onClick={() => accept(box)}>
                  Keep (redact)
                </button>
              )}
              <button class="btn danger small" onClick={() => remove(box.id)}>
                {box.status === 'suggested' ? 'Not an identifier' : 'Delete box'}
              </button>
            </div>
          </div>
          <div class="row wrap small">
            Print on box:
            {stampOptions.map((s) => (
              <button key={s} class={`chip ${box.stamp === s ? 'on' : ''}`} onClick={() => setStamp(box, s)}>
                {s}
              </button>
            ))}
            <button
              class="chip"
              onClick={() => {
                const s = prompt('Text to print on this box (no identifiers):', box.stamp ?? '');
                if (s !== null) setStamp(box, s.trim().slice(0, 24) || undefined);
              }}
            >
              Custom…
            </button>
            {box.stamp && (
              <button class="chip" onClick={() => setStamp(box, undefined)}>
                None
              </button>
            )}
          </div>
        </div>
      )}

      <div class="viewport">
        <div
          ref={surfaceRef}
          class={`surface ${drawMode ? 'drawing' : ''}`}
          style={{ width: `${zoomFactor * 100}%` }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          data-testid="redact-surface"
        >
          <canvas ref={canvasRef} class="display" />
          {img.boxes.map((b) => (
            <div
              key={b.id}
              data-box={b.id}
              class={`rbox ${b.status} ${solid ? 'solid' : ''} ${selected === b.id ? 'selected' : ''}`}
              style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
              title={b.reason}
            >
              {b.stamp && <span class="stamp">{b.stamp}</span>}
              {selected === b.id && (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => <div key={c} class={`handle ${c}`} data-corner={c} />)}
            </div>
          ))}
        </div>
      </div>

      <p class="muted small">
        Orange = suggestion (not yet redacted). Dark = will be covered with solid black. Text recognition cannot read handwriting reliably, so check by eye.
      </p>
      {message && <p class="ok small">{message}</p>}

      <div class="row wrap">
        <button class="btn" onClick={rescan} disabled={scanning}>
          Scan again
        </button>
        <button class="btn" onClick={resetToPreset} disabled={scanning}>
          Reset to preset
        </button>
        <button class="btn" onClick={saveAsTemplate} disabled={!img.type || img.type === 'generic'}>
          Save as my template
        </button>
        {img.type && hasTemplate(img.type) && (
          <button class="link small" onClick={forgetTemplate}>
            Forget template
          </button>
        )}
        <span class="spacer" />
        <button class="btn primary big" disabled={!canContinue} onClick={onNext} data-testid="to-review">
          {scanning ? 'Scanning…' : suggestions.length ? `Review ${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''} first` : 'Review →'}
        </button>
      </div>
    </div>
  );
}
