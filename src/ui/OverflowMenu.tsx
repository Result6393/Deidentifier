import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

interface Props {
  title: string;
  testid?: string;
  /** Small green dot on the button, e.g. "ready for offline use". */
  dot?: boolean;
  /** Button text; defaults to the ⋯ icon. */
  label?: string;
  /** Menu contents; call `close` after an action to dismiss the menu. */
  children: (close: () => void) => ComponentChildren;
}

/** A "⋯" button that opens a small menu (a bottom sheet on phones). */
export function OverflowMenu({ title, testid, dot, label, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Layout effect: Esc and outside-click work the instant the menu is on screen.
  useLayoutEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        e.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  return (
    <div class="menu" ref={ref}>
      <button class={`btn ${label ? '' : 'icon'}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={title} title={title} data-testid={testid}>
        {label ?? '⋯'}
        {dot && <span class="dot" aria-hidden="true" />}
      </button>
      {open && (
        <div class="menu-panel menu-list" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
