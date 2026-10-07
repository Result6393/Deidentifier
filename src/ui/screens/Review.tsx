import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { changed, session, zeroCanvas, type WorkImage } from '../../state/session';
import { renderRedacted } from '../../export/render';
import { verifyOutput, type Finding } from '../../export/verify';
import { canCopyImage, canShareFiles, copyImage, saveImage, shareImage, type Format } from '../../export/output';

const CHECKS = [
  'The sticker, header and image overlays are fully covered',
  'Names, numbers and addresses in the body text are covered',
  'I have checked handwriting by eye (text scan can’t read it reliably)',
  'Clinician names and signatures are covered',
  'No barcodes, QR codes or faces are visible',
];

interface Props {
  img: WorkImage;
  onBack: () => void;
  onDone: () => void;
  onNextImage?: () => void;
}

export function ReviewStep({ img, onBack, onDone, onNextImage }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(true);
  const [format, setFormat] = useState<Format>('image/jpeg');
  const [state, setState] = useState<'running' | 'done' | 'failed'>('running');
  const [progress, setProgress] = useState(0);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [checks, setChecks] = useState<boolean[]>(CHECKS.map(() => false));
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The exact pixels that get verified are the pixels that get exported.
  const out = useMemo(() => renderRedacted(img.flat!, img.boxes, limit ? 2000 : null), [img.flat, limit]);

  useEffect(() => {
    const holder = holderRef.current!;
    out.classList.add('display');
    holder.prepend(out);
    let cancelled = false;
    setState('running');
    setFindings([]);
    setOverride(false);
    const invert = img.type === 'optos1' || img.type === 'optos2';
    verifyOutput(out, img.boxes, session.terms, { invert, onProgress: setProgress })
      .then((f) => {
        if (cancelled) return;
        setFindings(f);
        setState('done');
      })
      .catch(() => !cancelled && setState('failed'));
    return () => {
      cancelled = true;
      out.remove();
      zeroCanvas(out);
    };
  }, [out]);

  const needsOverride = state === 'failed' || findings.length > 0;
  const ready = state !== 'running' && checks.every(Boolean) && (!needsOverride || override);

  const run = async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setResult(null);
    try {
      await fn();
      img.exported = true;
      changed();
      setResult(label);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    }
  };

  return (
    <div class="card stack">
      <h2>Review & export</h2>
      <div class={`status ${state === 'done' && !findings.length ? 'done' : state === 'running' ? 'running' : 'failed'}`} role="status">
        {state === 'running' && `Re-checking the final image for identifiers… ${Math.round(progress * 100)}%`}
        {state === 'done' && !findings.length && 'Automatic re-check found no identifiers outside the black boxes.'}
        {state === 'done' && findings.length > 0 && `Warning: ${findings.length} possible identifier${findings.length > 1 ? 's' : ''} still visible (outlined in red).`}
        {state === 'failed' && 'The automatic re-check could not run. Check the image very carefully.'}
      </div>

      {findings.length > 0 && (
        <ul class="findings small">
          {findings.map((f, i) => (
            <li key={i}>{f.reason}</li>
          ))}
        </ul>
      )}

      <div class="viewport">
        <div class="surface" ref={holderRef}>
          {findings.map((f, i) => (
            <div
              key={i}
              class="finding"
              style={{
                left: `${(f.bbox.x0 / out.width) * 100}%`,
                top: `${(f.bbox.y0 / out.height) * 100}%`,
                width: `${((f.bbox.x1 - f.bbox.x0) / out.width) * 100}%`,
                height: `${((f.bbox.y1 - f.bbox.y0) / out.height) * 100}%`,
              }}
            />
          ))}
        </div>
      </div>

      <fieldset class="stack checklist">
        <legend>Before exporting, confirm:</legend>
        {CHECKS.map((c, i) => (
          <label class="check" key={c}>
            <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks(checks.map((v, j) => (j === i ? e.currentTarget.checked : v)))} /> {c}
          </label>
        ))}
        {needsOverride && state !== 'running' && (
          <label class="check warn">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.currentTarget.checked)} />
            {state === 'failed'
              ? 'The re-check failed. I have checked the whole image myself.'
              : 'I have looked at every red outline and none of them is an identifier.'}
          </label>
        )}
      </fieldset>

      <div class="row wrap small">
        <label class="check">
          <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.currentTarget.checked)} /> Limit to 2000 px (smaller file)
        </label>
        <label>
          Format{' '}
          <select value={format} onChange={(e) => setFormat(e.currentTarget.value as Format)}>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
          </select>
        </label>
      </div>

      <div class="row wrap">
        <button class="btn" onClick={onBack}>
          ← Edit boxes
        </button>
        <span class="spacer" />
        {canCopyImage() && (
          <button class="btn primary" disabled={!ready} onClick={() => run('Copied. Paste it into Claude.', () => copyImage(out))}>
            Copy
          </button>
        )}
        <button class="btn primary" disabled={!ready} onClick={() => run('Saved.', () => saveImage(out, format))} data-testid="save">
          Save
        </button>
        {canShareFiles() && (
          <button class="btn primary" disabled={!ready} onClick={() => run('Shared.', () => shareImage(out, format))}>
            Share
          </button>
        )}
      </div>
      {!ready && state !== 'running' && <p class="muted small">Tick every box above to enable export.</p>}
      {result && (
        <div class="row wrap">
          <span class="ok">{result}</span>
          <span class="spacer" />
          {onNextImage && (
            <button class="btn" onClick={onNextImage}>
              Next image →
            </button>
          )}
          <button class="btn" onClick={onDone}>
            Back to photos
          </button>
        </div>
      )}
      {error && <p class="error">{error}</p>}
    </div>
  );
}
