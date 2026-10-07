import { DOC_TYPES } from '../../presets/defaults';
import { hasTemplate } from '../../presets/templates';
import { changed, type WorkImage } from '../../state/session';
import type { DocType } from '../../types';

export function TypeStep({ img, onNext }: { img: WorkImage; onNext: () => void }) {
  const choose = (type: DocType) => {
    if (img.type !== type) {
      // A different type means different preset boxes.
      img.boxes = [];
      img.ocr = 'idle';
    }
    img.type = type;
    changed();
    onNext();
  };
  return (
    <div class="card stack">
      <h2>What is this image?</h2>
      <div class="grid types">
        {DOC_TYPES.map((t) => (
          <button key={t.type} class={`type-tile ${img.type === t.type ? 'selected' : ''}`} onClick={() => choose(t.type)} data-type={t.type}>
            <strong>{t.title}</strong>
            <span class="muted small">{t.description}</span>
            {hasTemplate(t.type) && <span class="ok small">Using your saved template</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
