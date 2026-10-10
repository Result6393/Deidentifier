import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface Choice {
  id: string;
  label: string;
  kind?: 'primary' | 'danger';
  /** Stays disabled until the acknowledgement box is ticked. */
  needsTick?: boolean;
}

export interface AskOptions {
  title: string;
  body?: string;
  /** A short list shown under the body (file names, counts…). */
  details?: string[];
  /** Label of an "I understand" tick box; when set, choices marked needsTick wait for it. */
  tickLabel?: string;
  choices: Choice[];
  /** Which choice has focus first: the safest one. */
  focus: string;
}

interface Pending {
  opts: AskOptions;
  resolve: (id: string) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Shows a dialog and resolves with the id of the chosen button ('cancel' if dismissed). */
export function ask(opts: AskOptions): Promise<string> {
  pending?.resolve('cancel');
  return new Promise((resolve) => {
    pending = { opts, resolve };
    notify();
  });
}

function settle(id: string) {
  const p = pending;
  pending = null;
  notify();
  p?.resolve(id);
}

/** Mount once near the app root. */
export function DialogHost() {
  const [, tick] = useState(0);
  const [ticked, setTicked] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = () => {
      setTicked(false);
      tick((n) => n + 1);
    };
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);

  const p = pending;
  // Layout effect: focus and Esc/Tab handling are in place the moment the dialog is on screen.
  useLayoutEffect(() => {
    if (!p) return;
    cardRef.current?.querySelector<HTMLElement>(`[data-choice="${p.opts.focus}"]`)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        settle('cancel');
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const items = Array.from(cardRef.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length];
        e.preventDefault();
        next?.focus();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [p]);

  if (!p) return null;
  const { opts } = p;
  return (
    <div class="modal" role="alertdialog" aria-modal="true" aria-label={opts.title} data-testid="dialog">
      <div class="modal-card stack dialog" ref={cardRef}>
        <h2>{opts.title}</h2>
        {opts.body && <p class="dialog-body">{opts.body}</p>}
        {opts.details && opts.details.length > 0 && (
          <ul class="dialog-list small">
            {opts.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        {opts.tickLabel && (
          <label class="check">
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.currentTarget.checked)} data-testid="dialog-tick" /> {opts.tickLabel}
          </label>
        )}
        <div class="row wrap dialog-buttons">
          {opts.choices.map((c) => (
            <button
              key={c.id}
              data-choice={c.id}
              data-testid={`dialog-${c.id}`}
              class={`btn ${c.kind === 'primary' ? 'primary' : ''} ${c.kind === 'danger' ? 'danger' : ''}`}
              disabled={!!c.needsTick && !ticked}
              onClick={() => settle(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
