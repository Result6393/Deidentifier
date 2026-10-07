import { useEffect, useState } from 'preact/hooks';
import { DOC_TYPES } from '../presets/defaults';
import { deletePreset, listPresets, savePreset, setDefault, startingPreset } from '../presets/templates';
import {
  applyPreset,
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
import { renderOne } from '../export/batch';
import { canCopyImage, copyImage } from '../export/output';
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
    if (img.edited && !confirm('Replace your box changes on this image with the selected layout?')) return;
    applyPreset(img, img.presetId);
    setSelected(null);
  };
  const pickLayout = (id: string) => {
    if (img.edited && !confirm('Replace your box changes on this image with this layout?')) return;
    applyPreset(img, id || null);
    setSelected(null);
  };
  const typeTitle = img.type ? DOC_TYPES.find((t) => t.type === img.type)!.title : '';
  const presets = img.type ? listPresets(img.type) : [];
  const active = presets.find((p) => p.id === img.presetId) ?? null;
  const defaultId = img.type ? startingPreset(img.type) : null;
  const saveNewPreset = () => {
    if (!img.type) return;
    const name = prompt(`Name this layout for ${typeTitle} (positions only are saved: no image, no text):`, active ? `${active.name} copy` : 'My layout');
    if (name === null) return;
    const p = savePreset(img.type, name, img.boxes);
    img.presetId = p.id;
    img.edited = false;
    setMessage(`Saved “${p.name}”. Use “Make default” to start new ${typeTitle} images with it.`);
    changed();
  };
  const updatePreset = () => {
    if (!img.type || !active || !confirm(`Overwrite “${active.name}” with the boxes on this image?`)) return;
    savePreset(img.type, '', img.boxes, active.id);
    img.edited = false;
    setMessage(`Updated “${active.name}”.`);
    changed();
  };
  const makeDefault = () => {
    if (!img.type) return;
    setDefault(img.type, img.presetId);
    setMessage(`New ${typeTitle} images will now start with ${active ? `“${active.name}”` : 'the built-in layout'}.`);
    changed();
  };
  const removePreset = () => {
    if (!img.type || !active || !confirm(`Delete the saved layout “${active.name}”?`)) return;
    deletePreset(img.type, active.id);
    img.presetId = null;
    setMessage(`Deleted “${active.name}”. This image keeps its current boxes.`);
    changed();
  };
  const copyCurrent = async () => {
    if (!img.boxes.length && !confirm('This image has no black boxes. Copy it anyway?')) return;
    try {
      await copyImage(renderOne(img, { limit: true, format: 'image/png' }));
      setMessage('Copied to clipboard.');
    } catch (e) {
      setMessage(`Copy failed: ${(e as Error).message}`);
    }
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

        {img.type && (
          <div class="row wrap small layout" data-testid="layout-row">
            <label>
              Layout{' '}
              <select value={img.presetId ?? ''} onChange={(e) => pickLayout(e.currentTarget.value)} data-testid="layout-select">
                <option value="">Built-in{defaultId === null ? ' ★' : ''}</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === defaultId ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button class="link" onClick={saveNewPreset} data-testid="save-preset">
              Save boxes as new layout…
            </button>
            {active && (
              <button class="link" onClick={updatePreset}>
                Update “{active.name}”
              </button>
            )}
            {(img.presetId ?? null) !== defaultId && (
              <button class="link" onClick={makeDefault} data-testid="make-default">
                Make default
              </button>
            )}
            {active && (
              <button class="link danger" onClick={removePreset}>
                Delete layout
              </button>
            )}
          </div>
        )}

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
          {canCopyImage() && (
            <button class="btn" onClick={copyCurrent} data-testid="copy" title="Copy this image, with boxes applied, to the clipboard">
              Copy
            </button>
          )}
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

        <RedactCanvas img={img} canvas={canvas} selected={selected} setSelected={setSelected} drawMode={drawMode} setDrawMode={setDrawMode} solid={solid} zoom={ZOOMS[zoom]} onEdit={edit} onSwipe={go} />

        <div class="row wrap small">
          <label class="check">
            <input type="checkbox" checked={solid} onChange={(e) => setSolid(e.currentTarget.checked)} /> Solid preview
          </label>
          <span class="spacer" />
          <button class="link" onClick={reset} disabled={!img.type}>
            Reset boxes
          </button>
        </div>
        {message && <p class="small" role="status">{message}</p>}
        <p class="muted small">Dark boxes are covered with solid black on export. Check every image yourself, including handwriting, before exporting.</p>
      </div>

      <Filmstrip />
      {straighten && <StraightenModal img={img as WorkImage} onClose={() => setStraighten(false)} />}
    </div>
  );
}
