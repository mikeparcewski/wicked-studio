import { useEffect, useRef } from 'react';
import type { SheetTab } from '../../board/objectActions.js';

/**
 * THE SHEET (DES-STUDIO-REBUILD-001 §5.5, slice S11; DESIGN-interaction rule 9): an object's depth,
 * opened from the object itself — a title, its tabs, ONE primary action, and the line saying every
 * other action is ⌘K for this object. A drawer over the right edge, never a modal: the page stays
 * readable beside it. Esc and × close it (a sheet is not a decision, so Esc may close it).
 */
export function Sheet({ title, sub, objectAttr, tabs, tab, onTab, primary, onClose, children }: {
  title: string;
  sub?: string | null;
  /** The object's `data-object` spelling: ⌘K inside the sheet acts on it. */
  objectAttr: string;
  tabs: readonly SheetTab[];
  tab: string;
  onTab: (id: string) => void;
  primary: { label: string; onClick: () => void; disabled?: string | null } | null;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={title}
      data-testid="sheet"
      data-object={objectAttr}
      className="wk-sheet"
    >
      <header className="wk-sheet-head">
        <div className="wk-sheet-head-body">
          <h2 data-testid="sheet-title" className="wk-sheet-title">{title}</h2>
          {sub !== undefined && sub !== null && <p data-testid="sheet-sub" className="wk-sheet-sub">{sub}</p>}
        </div>
        <button type="button" data-testid="sheet-close" aria-label="Close" onClick={onClose} className="wk-sheet-x">×</button>
      </header>
      <div role="tablist" aria-label={`${title}: look underneath`} className="wk-sheet-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            data-testid="sheet-tab"
            data-tab={t.id}
            onClick={() => onTab(t.id)}
            className={`wk-sheet-tab${t.id === tab ? ' wk-sheet-tab--on' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" data-testid="sheet-body" data-tab={tab} className="wk-sheet-body">{children}</div>
      <footer className="wk-sheet-foot">
        {primary !== null && (
          <button
            type="button"
            data-testid="sheet-primary"
            disabled={primary.disabled !== undefined && primary.disabled !== null}
            title={primary.disabled ?? undefined}
            onClick={primary.onClick}
            className="wk-prop-btn wk-prop-btn--primary"
          >
            {primary.label}
          </button>
        )}
        {primary?.disabled !== undefined && primary.disabled !== null && <span data-testid="sheet-primary-why" className="wk-sheet-hint">{primary.disabled}</span>}
        <span className="wk-sheet-hint">Everything else for this: ⌘K</span>
      </footer>
    </aside>
  );
}
