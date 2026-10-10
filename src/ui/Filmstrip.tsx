import { useEffect, useRef } from 'preact/hooks';
import { isSaved, removeImage, select, session } from '../state/session';

export function Filmstrip() {
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [session.currentId]);

  return (
    <div class="filmstrip" role="list" aria-label="Photos">
      {session.images.map((img, i) => {
        const current = img.id === session.currentId;
        return (
          <div role="listitem" key={img.id} class={`film ${current ? 'current' : ''}`}>
            <button ref={current ? currentRef : undefined} class="film-btn" onClick={() => select(img.id)} aria-label={`Image ${i + 1}`} aria-current={current}>
              <span class="film-img">
                <img src={img.thumb} alt="" draggable={false} />
                {img.boxes.map((b) => (
                  <span key={b.id} class="film-box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />
                ))}
              </span>
              {isSaved(img) && (
                <span class="film-saved" title="Saved">
                  ⤓
                </span>
              )}
              <span class={`film-badge ${img.done ? 'done' : img.boxes.length ? 'todo' : 'none'}`}>{img.done ? '✓' : img.boxes.length ? i + 1 : '?'}</span>
            </button>
            {current && (
              <button
                class="film-x"
                onClick={() => confirm('Delete this photo from the session?') && removeImage(img.id)}
                aria-label="Delete photo"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
