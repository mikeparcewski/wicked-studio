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
}

export function ProjectSwitcher({ current, projects, onSelect, onNewProject, locked = false, onOpen, dropUp = false }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={ref} className="relative inline-block" data-testid="project-switcher">
      <button
        type="button"
        data-testid="project-field"
        data-locked={locked ? 'true' : 'false'}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (locked) return;
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-opacity hover:opacity-80"
        style={{
          background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)',
          color: 'var(--ink-body)', fontFamily: 'var(--font-sans)',
          cursor: locked ? 'default' : 'pointer',
        }}
      >
        <span className="truncate" style={{ maxWidth: '24ch' }}>{current?.name ?? 'Unfiled'}</span>
        {!locked && <span aria-hidden style={{ color: 'var(--ink-dim)' }}>▾</span>}
      </button>

      {open && (
        <div
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
          <button
            type="button"
            role="option"
            aria-selected={current === null}
            data-testid="project-switcher-unfiled"
            onClick={() => pick(null)}
            className="w-full text-left px-3 py-1.5 text-xs font-mono transition-colors hover:bg-surface-card"
            style={{ color: current === null ? 'var(--ink-high)' : 'var(--ink-muted)' }}
          >
            Unfiled
          </button>
          {visible.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={current?.id === p.id}
              data-testid="project-switcher-option"
              data-project-id={p.id}
              onClick={() => pick(p.id)}
              className="w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors hover:bg-surface-card"
              style={{ color: current?.id === p.id ? 'var(--ink-high)' : 'var(--ink-muted)' }}
            >
              {p.name}
            </button>
          ))}
          {onNewProject !== undefined && (
            <button
              type="button"
              data-testid="project-switcher-add"
              onClick={() => { setOpen(false); onNewProject(); }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono transition-opacity hover:opacity-80"
              style={{ color: 'var(--accent)', borderTop: '1px solid var(--surface-card)' }}
            >
              + New project
            </button>
          )}
        </div>
      )}
    </div>
  );
}
