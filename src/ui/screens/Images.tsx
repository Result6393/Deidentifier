import { useRef, useState } from 'preact/hooks';
import { changed, removeImage, session } from '../../state/session';
import { blobToCanvas, newWorkImage } from '../../capture/load';
import { Thumb } from '../Thumb';

interface Props {
  onCamera: () => void;
  onProcess: (id: string) => void;
  onEditTerms: () => void;
}

export function ImagesScreen({ onCamera, onProcess, onEditTerms }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const termCount = session.terms.patient.length + session.terms.clinician.length;

  const onFiles = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    setError(null);
    setLoading(true);
    for (const f of files) {
      try {
        session.images.push(newWorkImage(await blobToCanvas(f)));
      } catch {
        setError('A file could not be opened as an image.');
      }
    }
    // Drop the browser's reference to the original file.
    input.value = '';
    setLoading(false);
    changed();
  };

  return (
    <div class="stack">
      <div class="card stack">
        <h1>Photos</h1>
        <div class="row wrap">
          <button class="btn primary big" onClick={onCamera}>
            Take photo
          </button>
          <button class="btn big" onClick={() => fileRef.current?.click()} disabled={loading}>
            {loading ? 'Opening…' : 'Import photos'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} data-testid="file-input" />
        </div>
        <p class="muted small">
          The in-app camera keeps photos out of your gallery. Imported photos stay in your gallery, so delete the originals there yourself.
        </p>
        <p class="muted small">
          {termCount ? `${termCount} search term${termCount > 1 ? 's' : ''} set.` : 'No search terms set.'}{' '}
          <button class="link" onClick={onEditTerms}>
            Edit search terms
          </button>
        </p>
        {error && <p class="error">{error}</p>}
      </div>

      {session.images.length > 0 && (
        <div class="grid">
          {session.images.map((img, i) => (
            <div class="card tile" key={img.id}>
              <Thumb src={img.flat ?? img.source} />
              <div class="row between">
                <span>
                  Image {i + 1}
                  {img.exported && <span class="ok"> · exported</span>}
                </span>
                <button class="link danger" onClick={() => removeImage(img.id)}>
                  Delete
                </button>
              </div>
              <button class="btn primary" onClick={() => onProcess(img.id)}>
                {img.exported ? 'Open again' : img.type ? 'Continue' : 'De-identify'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
