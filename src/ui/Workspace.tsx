import { useEffect, useState } from 'preact/hooks';
import { DOC_TYPES } from '../presets/defaults';
import { deletePreset, listPresets, savePreset, setDefault, startingPreset } from '../presets/templates';
import {
  applyPreset,
  changed,
  clearType,
  currentImage,
  getCanvas,
  getFullCanvas,
  go,
  isSaved,
  keepFullOnly,
  needsFull,
  shownPx,
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
import { saveCurrent, saveLabel, saveMode } from '../export/saveOne';
import { Filmstrip } from './Filmstrip';
import { OverflowMenu } from './OverflowMenu';
import { RedactCanvas } from './RedactCanvas';
import { StraightenModal } from './StraightenModal';

/** Zoom levels: 0 fits the whole photo in the frame; the rest are multiples of actual size (1 = one photo pixel per screen pixel). */
const ZOOMS = [0, 0.5, 1, 2, 4];
const zoomLabel = (z: number) => (z === 0 ? 'Fit' : `${z * 100}%`);
const STAMPS = ['RE', 'LE', 'OD', 'OS', 'OU'];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

export function Workspace({ onImport, onCamera, onImportFolder }: { onImport: () => void; onCamera: () => void; onImportFolder?: () => void }) {
  const img = currentImage();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [solid, setSolid] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [hi, setHi] = useState<HTMLCanvasElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [straighten, setStraighten] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Load the photo (and warm up its neighbours) whenever the current image changes.
  useEffect(() => {
    setCanvas(null);
    setSelected(null);
    if (!img) return;
    // Carry the last-used type forward so a run of similar photos needs no taps.
    if (!img.type && !img.noType && session.lastType) setType(img, session.lastType);
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

  // A status message belongs to the photo it was about.
  useEffect(() => setMessage(null), [img?.id]);

  // Zoomed in on a big photo: use the full-resolution decode so detail is sharp, and free it when zooming out.
  useEffect(() => {
    setHi(null);
    keepFullOnly(img && zoom !== 0 ? img.id : null);
    if (!img || zoom === 0 || !needsFull(img)) return;
    let live = true;
    getFullCanvas(img).then((c) => live && setHi(c), () => undefined);
    return () => {
      live = false;
    };
  }, [img?.id, img?.rotation, img?.blob, zoom]);

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
      if (document.querySelector('[role="alertdialog"]')) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        // Save this photo instead of the browser's "save page".
        e.preventDefault();
        if (!straighten && img) void saveNow();
        return;
      }
      if (typing(e.target) || straighten || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeBox(selected);
      else if (e.key === 'Escape') {
        setSelected(null);
        setDrawMode(false);
      } else if (e.key === 'f' || e.key === 'F') setZoom(0);
      else if (e.key === '1') setZoom(1);
      else if (e.key === 'Enter' && img) {
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
          {onImportFolder && (
            <button class="btn big" onClick={onImportFolder} title="Open every photo in a folder so the originals can be replaced after redaction">
              Import folder…
            </button>
          )}
        </div>
        <p class="muted small">You can also drop photos onto this page, or share them to Deidentifier from your gallery on Android.</p>
      </div>
    );
  }

  const index = session.images.indexOf(img);
  const count = session.images.length;

  const choose = (type: DocType) => {
    // Tapping the chosen type again deselects it and removes its boxes.
    if (img.type === type) {
      if (img.edited && !confirm('Remove all the boxes from this image?')) return;
      clearType(img);
      setSelected(null);
      return;
    }
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

  const saveNow = async () => {
    if (!img || saving || isSaved(img)) return;
    setSaving(true);
    setMessage(null);
    try {
      const r = await saveCurrent(img);
      if (r.ok) setMessage(r.message);
      else if (!r.cancelled) setMessage(r.message);
    } finally {
      setSaving(false);
    }
  };

  // Controls for the selected box float over the photo, on the side away from the box.
  const boxBar = box && (
    <>
      <span class="nowrap">Print on box:</span>
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
    </>
  );

  return (
    <div class="stack tight">
      <div class="card stack tight">
        <div class="types" role="group" aria-label="Image type">
          {DOC_TYPES.map((t) => (
            <button key={t.type} class={`chip type ${img.type === t.type ? 'on' : ''}`} onClick={() => choose(t.type)} data-type={t.type} aria-pressed={img.type === t.type} title={img.type === t.type ? `${t.description}. Tap again to deselect.` : t.description}>
              {t.short}
            </button>
          ))}
        </div>

        {img.type && presets.length > 0 && (
          <div class="row small layout" data-testid="layout-row">
            <label class="row">
              Layout
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
          </div>
        )}

        <div class="toolbar row">
          <button class="btn icon" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous image" data-testid="prev">
            ‹
          </button>
          <span class="small count" data-testid="count">
            {index + 1} / {count}
          </span>
          <button class="btn icon" onClick={() => go(1)} disabled={index === count - 1} aria-label="Next image" data-testid="next">
            ›
          </button>
          <button class={`btn ${img.done ? 'primary' : ''}`} onClick={() => ((img.done = !img.done), changed())} aria-pressed={img.done} data-testid="done" title="Enter">
            {img.done ? '✓ Done' : 'Done'}
          </button>
          <span class="spacer" />
          <button class={`btn ${drawMode ? 'primary' : ''}`} onClick={() => setDrawMode(!drawMode)} aria-pressed={drawMode} data-testid="draw" title="Turn on to draw as many boxes as you like; Esc to stop">
            + Box
          </button>
          <OverflowMenu title="Zoom" label={`${zoomLabel(zoom)} ▾`} testid="zoom-menu">
            {(close) => (
              <>
                {ZOOMS.map((z) => (
                  <button key={z} class="menu-item" data-zoom={z} aria-pressed={z === zoom} onClick={() => (close(), setZoom(z))}>
                    {z === zoom ? '✓ ' : ''}
                    {z === 0 ? 'Fit to screen' : z === 1 ? '100% (actual size)' : zoomLabel(z)}
                  </button>
                ))}
                <p class="menu-note">100% = one photo pixel per screen pixel. Keys: F fit, 1 = 100%.</p>
              </>
            )}
          </OverflowMenu>
          <OverflowMenu title="Photo tools" testid="photo-menu">
            {(close) => {
              const run = (fn: () => void) => () => {
                close();
                fn();
              };
              return (
                <>
                  <button class="menu-item" onClick={run(() => rotate(img))}>
                    Rotate ↻
                  </button>
                  <button class="menu-item" onClick={run(() => setStraighten(true))}>
                    Straighten…
                  </button>
                  <button class="menu-item" onClick={run(() => setSolid(!solid))} aria-pressed={solid}>
                    {solid ? '✓ ' : ''}Solid preview
                  </button>
                  <button class="menu-item" onClick={run(reset)} disabled={!img.type}>
                    Reset boxes
                  </button>
                  <p class="menu-note">Layouts for {typeTitle || 'this type'}</p>
                  <button class="menu-item" onClick={run(saveNewPreset)} disabled={!img.type} data-testid="save-preset">
                    Save boxes as new layout…
                  </button>
                  {active && (
                    <button class="menu-item" onClick={run(updatePreset)}>
                      Update “{active.name}”
                    </button>
                  )}
                  {img.type && (img.presetId ?? null) !== defaultId && (
                    <button class="menu-item" onClick={run(makeDefault)} data-testid="make-default">
                      Make default
                    </button>
                  )}
                  {active && (
                    <button class="menu-item danger" onClick={run(removePreset)}>
                      Delete layout
                    </button>
                  )}
                </>
              );
            }}
          </OverflowMenu>
        </div>

        <RedactCanvas
          img={img}
          canvas={hi ?? canvas}
          selected={selected}
          setSelected={setSelected}
          drawMode={drawMode}
          solid={solid}
          zoom={zoom}
          pxW={shownPx(img).w}
          onEdit={edit}
          onSwipe={go}
          boxBar={boxBar}
          boxBarAt={box && box.y + box.h / 2 > 0.5 && zoom === 0 ? 'top' : 'bottom'}
          hint={drawMode ? 'Drawing: drag for each box, tap a box to select it. Esc or + Box to stop.' : img.type ? undefined : 'Choose a type above to place the boxes'}
          hintAt={drawMode ? 'top' : 'center'}
        />
        <div class="filebar" data-testid="filebar">
          <span class="fname" title={img.name} data-testid="filename">
            {img.name}
          </span>
          {canCopyImage() && (
            <button class="btn" onClick={copyCurrent} data-testid="copy" title="Copy this image, with boxes applied, to the clipboard">
              Copy
            </button>
          )}
          <button
            class={`btn ${isSaved(img) ? '' : 'primary'}`}
            disabled={saving || isSaved(img)}
            onClick={saveNow}
            data-testid="save"
            title={saveMode(img) === 'overwrite' ? 'Replace the original file with this redacted photo (Ctrl+S)' : saveMode(img) === 'update' ? 'Write your changes to the file you saved (Ctrl+S)' : 'Save this photo as a new file (Ctrl+S)'}
          >
            {isSaved(img) ? 'Saved ✓' : saving ? 'Saving…' : saveLabel(saveMode(img))}
          </button>
        </div>
        {message && (
          <p class="small" role="status">
            {message}
          </p>
        )}
      </div>

      <Filmstrip />
      <p class="muted small foot">Dark boxes become solid black on export. Check every photo yourself, including handwriting.</p>
      {straighten && <StraightenModal img={img as WorkImage} onClose={() => setStraighten(false)} />}
    </div>
  );
}
