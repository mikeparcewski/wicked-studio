import { useEffect, useRef, useState } from 'react';
import type { Project } from '../api/types.js';

/**
 * The shared inline project switcher (DES-FEEDBACK-001 §5.2, slice A — built
 * here for slice B's create-flow defaults and §4.3's "change ›" link): a
 * compact dropdown showing the current binding ("Unfiled" when none), opening
 * to a filterable list of projects plus the Unfiled entry, with an optional
 * "+ New project" row that hands off to `NewProjectModal` (§1.3).
 *
 * `onSelect(null)` means Unfiled — no `project_id` in the eventual POST body,
 * the backend default (§5.1). The component owns no data fetch: the caller
 * passes the projects it already has.
 *
 * Slice J (DES-FEEDBACK-002 §4) adds the header-flavored dress: a
 * `variant="crumb"` trigger — SAME behavior, breadcrumb typography instead of
 * the form-field box — for the project-context header's 1-click pivot. The
 * crumb is a pivot between projects, not a binding field, so it renders no
 * Unfiled row (Unfiled is not a project you can stand in) and marks the
 * current project with a ✓; an optional `⌂ Project dashboard` last row keeps
 * the dashboard reachable from the dropdown. The keyboard repair (§4.3) lands
 * for EVERY call site: ArrowDown/ArrowUp walk the rows with real DOM focus
 * (EC22 — the `--accent` ring rides `.wk-switcher-row` in global.css), and
 * Escape closes and restores focus to the trigger.
 */

interface Props {
  /** The currently bound project; `null` = Unfiled (§5.1's default). */
  current: Project | null;
  projects: Project[];
  onSelect: (projectId: string | null) => void;
  /** When set, renders the "+ New project" row (§5.2) and calls this on click. */
  onNewProject?: () => void;
  /** §4.3 pre-bound surfaces: render the value, refuse to open. */
  locked?: boolean;
  /**
   * Fired when the dropdown OPENS — the lazy-load hook for callers with a
   * request budget (Chat's zero-requests-on-mount, DES-UXFIX-001 §2.4): the
   * project list is fetched on this first user action, never on mount.
   */
  onOpen?: () => void;
  /** Open the list ABOVE the field — for fields docked at the viewport bottom
   *  (Chat's composer), where a downward list would fall below the fold. */
  dropUp?: boolean;
  /** The trigger's dress (DES-FEEDBACK-002 §4.2): `field` is the slice-A/B
   *  form-field box; `crumb` is the context header's breadcrumb typography —
   *  same behavior, no Unfiled row, current project checked. */
  variant?: 'field' | 'crumb';
  /** The trigger's testid — the context header keeps `project-name` (§4.4). */
  triggerTestId?: string;
  /** When set, the dropdown's last row is `⌂ Project dashboard` — a real link
   *  (`href`) that also navigates in-app via `onGo` (§4.2). */
  dashboard?: { href: string; onGo: () => void };
}

export function ProjectSwitcher({
  current, projects, onSelect, onNewProject, locked = false, onOpen, dropUp = false,
  variant = 'field', triggerTestId = 'project-field', dashboard,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const q = filter.trim().toLowerCase();
  const visible = (q === '' ? projects : projects.filter((p) => p.name.toLowerCase().includes(q)))
    .filter((p) => p.id !== 'default');

  const pick = (id: string | null): void => { onSelect(id); setOpen(false); setFilter(''); };

  // §4.3's keyboard repair, every call site: the rows are real buttons/anchors,
  // and the arrows move real DOM focus among them (EC22 — the cursor IS focus).
  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setFilter('');
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('.wk-switcher-row') ?? [],
    );
    if (rows.length === 0) return;
    const at = rows.findIndex((r) => r === document.activeElement);
    const next = e.key === 'ArrowDown'
      ? rows[Math.min(at + 1, rows.length - 1)]
      : at <= 0 ? rows[0] : rows[at - 1];
    next?.focus();
  };

  const crumb = variant === 'crumb';

  return (
    <div ref={ref} className="relative inline-block" data-testid="project-switcher" onKeyDown={onListKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        data-locked={locked ? 'true' : 'false'}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (locked) return;
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className={crumb
          ? 'wk-crumb-trigger flex items-center gap-1 p-0'
          : 'flex items-center gap-1 px-2 py-1 rounded text-xs transition-opacity hover:opacity-80'}
        style={crumb
          ? {
              // The context header's CRUMB spec (§4.3): sans, sm, medium, muted —
              // the exact dress the plain project-name link wore before slice J.
              background: 'transparent', border: 'none',
              fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)',
              fontFamily: 'var(--font-sans)', color: 'var(--ink-muted)',
              cursor: locked ? 'default' : 'pointer',
            }
          : {
              background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)',
              color: 'var(--ink-body)', fontFamily: 'var(--font-sans)',
              cursor: locked ? 'default' : 'pointer',
            }}
      >
        <span className="truncate" style={{ maxWidth: '24ch' }}>{current?.name ?? 'Unfiled'}</span>
        {!locked && (
          <span aria-hidden className={crumb ? 'wk-crumb-caret' : undefined}
            style={{ color: crumb && open ? 'var(--ink-high)' : 'var(--ink-dim)' }}>
            ▾
          </span>
        )}
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          data-testid="project-switcher-list"
          className={`absolute left-0 w-56 rounded-lg py-1 z-50 max-h-64 overflow-y-auto ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
          }}
        >
          <div className="px-2 pb-1">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter projects…"
              autoFocus
              className="w-full bg-transparent text-xs font-mono outline-none border-b px-1 py-0.5"
              style={{ color: 'var(--ink-body)', borderColor: 'var(--ink-dim)', caretColor: 'var(--accent)' }}
            />
          </div>
          {/* No Unfiled row in the crumb (§4.2): a pivot between projects, not a
              binding field — Unfiled is not a project you can stand in. */}
          {!crumb && (
            <button
              type="button"
              role="option"
              aria-selected={current === null}
              data-testid="project-switcher-unfiled"
              onClick={() => pick(null)}
              className="wk-switcher-row w-full text-left px-3 py-1.5 text-xs font-mono transition-colors hover:bg-surface-card"
              style={{ color: current === null ? 'var(--ink-high)' : 'var(--ink-muted)' }}
            >
              Unfiled
            </button>
          )}
          {visible.map((p) => {
            const isCurrent = current?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                data-testid="project-switcher-option"
                data-project-id={p.id}
                onClick={() => pick(p.id)}
                className="wk-switcher-row w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors hover:bg-surface-card"
                style={{ color: isCurrent ? 'var(--ink-high)' : 'var(--ink-muted)' }}
              >
                {p.name}
                {/* The current project renders with a ✓ (§4.2) — `--accent`,
                    selecting it is a no-op close (the caller ignores same-id). */}
                {crumb && isCurrent && (
                  <span aria-hidden style={{ color: 'var(--accent)', marginLeft: '6px' }}>✓</span>
                )}
              </button>
            );
          })}
          {onNewProject !== undefined && (
            <button
              type="button"
              data-testid="project-switcher-add"
              onClick={() => { setOpen(false); onNewProject(); }}
              className="wk-switcher-row w-full text-left px-3 py-1.5 text-xs font-mono transition-opacity hover:opacity-80"
              style={{ color: 'var(--accent)', borderTop: '1px solid var(--surface-card)' }}
            >
              + New project
            </button>
          )}
          {/* The dashboard link the name used to be does not vanish (§4.2): the
              dropdown's last row keeps it — a REAL link, middle-clickable. */}
          {dashboard !== undefined && (
            <a
              data-testid="switcher-dashboard-row"
              href={dashboard.href}
              onClick={(e) => { e.preventDefault(); setOpen(false); setFilter(''); dashboard.onGo(); }}
              className="wk-switcher-row block w-full text-left px-3 py-1.5 text-xs font-mono transition-opacity hover:opacity-80"
              style={{
                color: 'var(--ink-muted)', textDecoration: 'none',
                borderTop: '1px solid var(--surface-card)',
              }}
            >
              ⌂ Project dashboard
            </a>
          )}
        </div>
      )}
    </div>
  );
}
