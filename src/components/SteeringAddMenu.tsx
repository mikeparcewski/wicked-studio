import { useCallback, useRef, useState } from 'react';
import type { SteeringRule, SteeringType } from '../api/steering.js';
import { useDismissable } from '../hooks/useDismissable.js';
import { AuthorPanel } from './SteeringAuthorPanel.js';
import { SteeringImportPanel } from './SteeringImportPanel.js';
import { SteeringRuleFormModal } from './SteeringRuleForm.js';

/**
 * ONE "Add" menu per type page — the three management flows behind a single split-button,
 * each opening ON DEMAND (none rendered open by default):
 *  - Add individual → the modal rule form (the existing individual-add fields);
 *  - Import → the file-picker panel (as today);
 *  - Add with chat → the governed authoring run (the existing author flow).
 * Every write still goes through crew's API, typed from THIS page — the wires are untouched.
 *
 * The menu items keep the retired management bar's testids (`steering-add-open`,
 * `steering-import-open`, `steering-author-open`): the affordances survived, only their
 * placement changed.
 */

type Flow = 'form' | 'import' | 'author';

export function SteeringAddMenu({ type, rules, onSaved, onRulesChanged }: {
  type: SteeringType;
  /** The loaded corpus — the individual form derives its fresh-id suggestion from it. */
  rules: SteeringRule[];
  /** Fires with the saved id after the individual form's upsert succeeded. */
  onSaved: (id: string) => void;
  /** Fires when a flow may have landed rules (import results, an approved propose gate). */
  onRulesChanged: () => void;
}): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The overlay contract (usability review #10): Escape closes the menu and
  // returns focus to the Add trigger; a click outside closes it too. This menu
  // was the live-verified gap — it survived Escape while the drawer honored it.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismissable(menuOpen, closeMenu, menuRef, triggerRef);

  const pick = (f: Flow): void => {
    setMenuOpen(false);
    setFlow(f);
  };

  const item = (testid: string, label: string, sublabel: string, f: Flow): React.ReactElement => (
    <button
      type="button"
      role="menuitem"
      data-testid={testid}
      onClick={() => pick(f)}
      className="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-surface-raised"
      style={{ background: 'transparent' }}
    >
      <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>{label}</span>
      <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{sublabel}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
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
            {item('steering-add-open', 'Add individual', 'One rule, the full form — saved on this page’s type', 'form')}
            {item('steering-import-open', 'Import', 'A Markdown rules doc or a .json rule batch', 'import')}
            {item('steering-author-open', 'Add with chat', 'A governed run drafts rules and stops at a propose gate', 'author')}
          </div>
        )}
      </div>

      {flow === 'form' && (
        <SteeringRuleFormModal
          type={type}
          rules={rules}
          initial={null}
          onClose={() => setFlow(null)}
          onSaved={(id) => { setFlow(null); onSaved(id); }}
        />
      )}
      {flow === 'import' && (
        <SteeringImportPanel
          type={type}
          onClose={() => setFlow(null)}
          onImported={onRulesChanged}
        />
      )}
      {flow === 'author' && (
        <AuthorPanel
          type={type}
          onClose={() => setFlow(null)}
          onAuthored={onRulesChanged}
        />
      )}
    </div>
  );
}
