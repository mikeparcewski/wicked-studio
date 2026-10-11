import { useCallback, useEffect, useId, useRef } from 'react';
import type { SheetTab } from '../../board/objectActions.js';
import { useModalEscape } from '../Modal.js';
import { Tabs } from '../ui/index.js';

/**
 * THE SHEET (DES-STUDIO-REBUILD-001 §5.5, slice S11; DESIGN-interaction rule 9): an object's depth,
 * opened from the object itself — a title, its tabs, ONE primary action, and the line saying every
 * other action is ⌘K for this object. A drawer over the right edge, never a modal: the page stays
 * readable beside it. Esc and × close it (a sheet is not a decision, so Esc may close it). Esc is one
 * step at a time: the sheet is a layer in the modal chain (`useModalEscape`), so a sheet opened over a
 * drawer — "look underneath" from a rule's page (S12) — closes first and the drawer under it stays.
 */
export function Sheet({ title, sub, objectAttr, tabs, tab, onTab, primary, onClose, actions, children }: {
  title: string;
  sub?: string | null;
  /** The object's `data-object` spelling: ⌘K inside the sheet acts on it. */
  objectAttr: string;
  tabs: readonly SheetTab[];
  tab: string;
  onTab: (id: string) => void;
  primary: { label: string; onClick: () => void; disabled?: string | null } | null;
  onClose: () => void;
  /** S16a-1d: the object's secondary actions under its title (a session's Archive / Draft update). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const uid = useId().replace(/:/g, '');
  // Escape is one layer at a time: an open "More" menu closes first (focus back on its button).
  const onEscape = useCallback(() => {
    const more = ref.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"][aria-expanded="true"]');
    if (more) { more.click(); more.focus(); return; }
    onClose();
  }, [onClose]);
  useModalEscape(onEscape);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { prev?.focus?.({ preventScroll: true }); };
  }, []);
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
          {actions}
        </div>
        <button type="button" data-testid="sheet-close" aria-label="Close" onClick={onClose} className="wk-btn wk-btn--quiet wk-sheet-x">×</button>
      </header>
      <div className="wk-sheet-tabs">
        <Tabs tabs={tabs} active={tab} onChange={onTab} aria-label={`${title}: look underneath`} idBase={uid} data-testid="sheet-tabs" tabTestId={/* testid */ 'sheet-tab'} />
      </div>
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} data-testid="sheet-body" data-tab={tab} className="wk-sheet-body">{children}</div>
      <footer className="wk-sheet-foot">
        {primary !== null && (
          <button
            type="button"
            data-testid="sheet-primary"
            disabled={primary.disabled !== undefined && primary.disabled !== null}
            title={primary.disabled ?? undefined}
            onClick={primary.onClick}
            className="wk-btn wk-btn--primary"
          >
            {primary.label}
          </button>
        )}
        {primary?.disabled !== undefined && primary.disabled !== null && <span data-testid="sheet-primary-why" className="wk-sheet-hint">{primary.disabled}</span>}
        <span className="wk-sheet-hint wk-sheet-hint--keys">Everything else for this: ⌘K</span>
      </footer>
    </aside>
  );
}
