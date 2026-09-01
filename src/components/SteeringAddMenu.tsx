import { useCallback, useRef, useState } from 'react';
import { useDismissable } from '../hooks/useDismissable.js';

/**
 * ONE "Add" menu per type page — collapsed to TWO entries by the spreadsheet wave (round-3
 * operator steer): the three management flows it used to hold moved into their new homes —
 * individual add became the GRID's draft row, and import/author folded into the ASSIST DOCK
 * (one chat panel that imports docs directly or launches the governed authoring run).
 *
 *  - "Add row" keeps the `steering-add-open` testid (the affordance survived, its target
 *    changed: the modal form → the grid's inline draft row);
 *  - "Open assistant" is the way into the dock when it is collapsed (and a no-op focus
 *    otherwise) — import and add-with-chat live THERE now.
 */
export function SteeringAddMenu({ onAddRow, onOpenAssistant }: {
  /** Opens the grid's editable draft row. */
  onAddRow: () => void;
  /** Expands the assist dock (import / author live there). */
  onOpenAssistant: () => void;
}): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The overlay contract (usability review #10): Escape closes the menu and
  // returns focus to the Add trigger; a click outside closes it too.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismissable(menuOpen, closeMenu, menuRef, triggerRef);

  const pick = (action: () => void): void => {
    setMenuOpen(false);
    action();
  };

  const item = (testid: string, label: string, sublabel: string, action: () => void): React.ReactElement => (
    <button
      type="button"
      role="menuitem"
      data-testid={testid}
      onClick={() => pick(action)}
      className="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-surface-raised"
      style={{ background: 'transparent' }}
    >
      <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>{label}</span>
      <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{sublabel}</span>
    </button>
  );

  return (
    <div ref={menuRef} className="relative self-start">
      <button
        ref={triggerRef}
        data-testid="steering-add-menu"
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="rounded px-2.5 py-1 text-[11px] font-semibold"
        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
      >
        Add ▾
      </button>
      {menuOpen && (
        <div
          data-testid="steering-add-menu-list"
          role="menu"
          className="absolute left-0 top-8 z-30 w-64 py-1"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {item('steering-add-open', 'Add row', 'An editable draft row in the grid — manual id, saved on commit', onAddRow)}
          {item('steering-assist-open', 'Open assistant', 'Chat, analyze docs, or import rule files directly', onOpenAssistant)}
        </div>
      )}
    </div>
  );
}
