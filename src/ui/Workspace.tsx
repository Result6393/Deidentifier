import { useEffect, useState } from 'preact/hooks';
import { DOC_TYPES } from '../presets/defaults';
import { clearTemplate, hasTemplate, saveTemplate } from '../presets/templates';
import {
  changed,
  currentImage,
  getCanvas,
  go,
  keepOnly,
  makeThumb,
  neighbourIds,
  rotate,
  session,
  setType,
  type WorkImage,
} from '../state/session';
import type { Box, DocType } from '../types';
import { Filmstrip } from './Filmstrip';
import { RedactCanvas } from './RedactCanvas';
import { StraightenModal } from './StraightenModal';

const ZOOMS = [1, 1.5, 2, 3, 4];
const STAMPS = ['RE', 'LE', 'OD', 'OS', 'OU'];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

export function Workspace({ onImport, onCamera }: { onImport: () => void; onCamera: () => void }) {
  const img = currentImage();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [solid, setSolid] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [straighten, setStraighten] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Load the photo (and warm up its neighbours) whenever the current image changes.
  useEffect(() => {
    setCanvas(null);
    setSelected(null);
    setDrawMode(false);
    setMessage(null);
    if (!img) return;
    // Carry the last-used type forward so a run of similar photos needs no taps.
    if (!img.type && session.lastType) setType(img, session.lastType);
    let live = true;
    getCanvas(img).then((c) => {
      if (!live) return;
      setCanvas(c);
      if (img.thumbRot !== img.rotation) {
        img.thumb = makeThumb(c);
        img.thumbRot = img.rotation;
        img.aspect = c.width / c.height;
        changed();
      }
      keepOnly(neighbourIds());
      const i = session.images.indexOf(img);
      for (const n of [session.images[i + 1], session.images[i - 1]]) n && getCanvas(n).catch(() => undefined);
    }, () => live && setMessage('This photo could not be opened.'));
    return () => {
      live = false;
    };
  }, [img?.id, img?.rotation, img?.blob]);

  const box: Box | null = img?.boxes.find((b) => b.id === selected) ?? null;
  const edit = () => {
    if (img) img.edited = true;
    changed();
  };
  const removeBox = (id: string) => {
    if (!img) return;
    img.boxes = img.boxes.filter((b) => b.id !== id);
    setSelected(null);
    edit();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || straighten || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeBox(selected);
      else if (e.key === 'Escape') {
        setSelected(null);
        setDrawMode(false);
      } else if (e.key === 'Enter' && img) {
        img.done = !img.done;
        changed();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!img) {
    return (
      <div class="card stack empty">
        <h1>Add photos</h1>
        <p class="muted">Import a batch, or take photos with the in-app camera (they never reach your gallery). Everything stays on this device.</p>
        <div class="row wrap">
          <button class="btn primary big" onClick={onImport}>
            Import photos
          </button>
          <button class="btn big" onClick={onCamera}>
            Take photo
          </button>
        </div>
        <p class="muted small">You can also drop photos onto this page, or share them to Deidentifier from your gallery on Android.</p>
      </div>
    );
  }

  const index = session.images.indexOf(img);
  const count = session.images.length;

  const choose = (type: DocType) => {
    if (img.type && img.edited && !confirm('Replace your box changes on this image with the preset for this type?')) return;
    setType(img, type);
    setSelected(null);
  };
  const reset = () => {
    if (!img.type) return;
    if (img.edited && !confirm('Replace your box changes on this image with the preset?')) return;
    setType(img, img.type);
    setSelected(null);
  };
  const saveAsTemplate = () => {
    if (!img.type || img.type === 'generic') return;
    if (!confirm(`Save these ${img.boxes.length} box positions as your template for ${DOC_TYPES.find((t) => t.type === img.type)!.title}? Only positions are saved: no image, no text.`)) return;
    saveTemplate(img.type, img.boxes);
    setMessage('Template saved. New images of this type will start with it.');
  };
  const forgetTemplate = () => {
    if (!img.type || !confirm('Forget your saved template and go back to the built-in preset for this type?')) return;
    clearTemplate(img.type);
    setMessage('Saved template removed.');
  };
  const setStamp = (b: Box, stamp?: string) => {
    b.stamp = stamp;
    edit();
  };

  return (
    <div class="stack">
      <div class="card stack">
        <div class="row wrap types" role="group" aria-label="Image type">
          {DOC_TYPES.map((t) => (
            <button key={t.type} class={`chip big ${img.type === t.type ? 'on' : ''}`} onClick={() => choose(t.type)} data-type={t.type} title={t.description}>
              {t.short}
            </button>
          ))}
          {!img.type && <span class="muted small">Choose a type to place the boxes</span>}
        </div>

        <div class="toolbar row wrap">
          <button class="btn" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous image" data-testid="prev">
            ← Prev
          </button>
          <span class="small count" data-testid="count">
            {index + 1} / {count}
          </span>
          <button class="btn" onClick={() => go(1)} disabled={index === count - 1} aria-label="Next image" data-testid="next">
            Next →
          </button>
          <button class={`btn ${img.done ? 'primary' : ''}`} onClick={() => ((img.done = !img.done), changed())} aria-pressed={img.done} data-testid="done" title="Enter">
            {img.done ? '✓ Done' : 'Mark done'}
          </button>
          <span class="spacer" />
          <button class={`btn ${drawMode ? 'primary' : ''}`} onClick={() => setDrawMode(!drawMode)} data-testid="draw">
            {drawMode ? 'Drag on image…' : '+ Box'}
          </button>
          <button class="btn" onClick={() => rotate(img)} aria-label="Rotate">
            ↻
          </button>
          <button class="btn" onClick={() => setStraighten(true)}>
            Straighten
          </button>
          <button class="btn" onClick={() => setZoom(Math.max(0, zoom - 1))} disabled={zoom === 0} aria-label="Zoom out">
            −
          </button>
          <span class="small">{ZOOMS[zoom]}×</span>
          <button class="btn" onClick={() => setZoom(Math.min(ZOOMS.length - 1, zoom + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">
            +
          </button>
        </div>

        {box && (
          <div class="box-panel row wrap small">
            <span>Print on box:</span>
            {STAMPS.map((s) => (
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
            <span class="spacer" />
            <button class="btn danger small" onClick={() => removeBox(box.id)}>
              Delete box
            </button>
          </div>
        )}

        <RedactCanvas img={img} canvas={canvas} selected={selected} setSelected={setSelected} drawMode={drawMode} setDrawMode={setDrawMode} solid={solid} zoom={ZOOMS[zoom]} onEdit={edit} />

        <div class="row wrap small">
          <label class="check">
            <input type="checkbox" checked={solid} onChange={(e) => setSolid(e.currentTarget.checked)} /> Solid preview
          </label>
          <span class="spacer" />
          <button class="link" onClick={reset} disabled={!img.type}>
            Reset to preset
          </button>
          <button class="link" onClick={saveAsTemplate} disabled={!img.type || img.type === 'generic'}>
            Save as my template
          </button>
          {img.type && hasTemplate(img.type) && (
            <button class="link" onClick={forgetTemplate}>
              Forget template
            </button>
          )}
        </div>
        {message && <p class="small" role="status">{message}</p>}
        <p class="muted small">Dark boxes are covered with solid black on export. Check every image yourself, including handwriting, before exporting.</p>
      </div>

      <Filmstrip />
      {straighten && <StraightenModal img={img as WorkImage} onClose={() => setStraighten(false)} />}
    </div>
  );
}
