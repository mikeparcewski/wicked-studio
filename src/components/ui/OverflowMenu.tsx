import { useCallback, useId, useRef, useState } from 'react';
import { useDismissable } from '../../hooks/useDismissable.js';

export interface MenuItem { id: string; label: string; onSelect: () => void; danger?: boolean; disabled?: string | null }

/**
 * A menu button: "⋯" (or a labelled button) opening a list of actions (design/UI-CONTRACT.md §4.5;
 * audit rows 35, 37, 82). Arrows move, Enter/Space picks, Escape and an outside click close and focus
 * returns to the button. A disabled item shows its reason as its second line.
 */
export function OverflowMenu({ label, items, text, 'data-testid': testId = 'overflow-menu' }: {
  label: string; items: readonly MenuItem[]; text?: string; 'data-testid'?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null); const btn = useRef<HTMLButtonElement | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]); const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, wrap, btn);
  const focusAt = (i: number): void => { const n = items.length; refs.current[((i % n) + n) % n]?.focus(); };
  return (
    <div ref={wrap} className="wk-menu-wrap" data-testid={testId}>
      <button ref={btn} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`}
        className={text !== undefined ? 'wk-btn wk-btn--quiet wk-btn--sm' : 'wk-btn wk-btn--quiet wk-btn--icon'}
        data-testid={`${testId}-button`}
        onClick={() => { setOpen((o) => !o); if (!open) setTimeout(() => focusAt(0), 0); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setTimeout(() => focusAt(0), 0); } }}
      >{text !== undefined ? `${text} ▾` : <span aria-hidden>⋯</span>}</button>
      {open && (
        <div id={`${id}-menu`} role="menu" aria-label={label} className="wk-menu" data-testid={`${testId}-list`}>
          {items.map((it, i) => (
            <button key={it.id} ref={(el) => { refs.current[i] = el; }} type="button" role="menuitem"
              aria-disabled={it.disabled != null} data-item={it.id}
              className={`wk-menu-item${it.danger === true ? ' wk-menu-item--danger' : ''}`}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
                if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1); }
                if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
                if (e.key === 'End') { e.preventDefault(); focusAt(items.length - 1); }
              }}
              onClick={() => { if (it.disabled != null) return; setOpen(false); btn.current?.focus(); it.onSelect(); }}
            >
              <span>{it.label}</span>
              {it.disabled != null && <span className="wk-menu-item-note">{it.disabled}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
