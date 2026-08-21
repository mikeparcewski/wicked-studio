import type { SessionStatus, SessionView } from '../api/types.js';

/**
 * The rail's inline runs section (DES-FEEDBACK-001 §1.4, slice A): the five
 * most-recent runs from the SAME `runs` prop the rail already receives — no
 * new fetch. Active runs lead; terminal runs (done / failed / cancelled)
 * follow regardless of recency. The wire carries no `updated_at` on a session,
 * so "recent" is the daemon's own `/runs` ordering, preserved verbatim within
 * each group.
 *
 * Each row is one glance: the status dot (the SAME tokens the board cards
 * speak — §2.6's status layer), the intent label (truncated to 28ch), and the
 * phase word in the quiet mono ramp. Clicking a row navigates `runPath(id)` —
 * the caller's same routing as `selectRun`. "All runs ›" stays at the bottom
 * as the ONE escape hatch to the flat cross-project list (DES-UXFIX-001 §2.3).
 */

const RECENT_MAX = 5;

const TERMINAL = new Set<SessionStatus>(['completed', 'cancelled', 'failed']);

/** Status dot — exactly the board cards' status tokens (§1.4). */
export const RUN_DOT: Record<SessionStatus, string> = {
  planning:       'var(--status-run)',
  distributing:   'var(--status-run)',
  executing:      'var(--status-run)',
  awaiting_human: 'var(--status-gate)',
  completed:      'var(--status-done)',
  cancelled:      'var(--ink-dim)',
  failed:         'var(--status-fail)',
};

/** The row's phase word: "working 2/4" while live, the state word otherwise. */
export function phaseWord({ session, units }: SessionView): string {
  switch (session.status) {
    case 'awaiting_human': return 'gate';
    case 'completed': return 'done';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default:
      return units.length > 0
        ? `working ${Math.min(session.unit_ix + 1, units.length)}/${units.length}`
        : 'working';
  }
}

/** Active before terminal, incoming (recency) order preserved within each group. */
export function recentRuns(runs: SessionView[], max: number = RECENT_MAX): SessionView[] {
  const active = runs.filter((v) => !TERMINAL.has(v.session.status));
  const terminal = runs.filter((v) => TERMINAL.has(v.session.status));
  return [...active, ...terminal].slice(0, max);
}

interface Props {
  runs: SessionView[];
  runPath: (id: string) => string;
  navigate: (path: string) => void;
}

export function RunsSection({ runs, runPath, navigate }: Props): React.ReactElement {
  const recent = recentRuns(runs);
  return (
    <div data-testid="rail-runs">
      {recent.map((view) => (
        <button
          key={view.session.id}
          type="button"
          data-testid="rail-run"
          data-run-id={view.session.id}
          data-status={view.session.status}
          onClick={() => navigate(runPath(view.session.id))}
          title={view.session.problem}
          className="w-full text-left px-3 py-1 rounded-md transition-colors"
          style={{ background: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-card)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: RUN_DOT[view.session.status] ?? 'var(--ink-dim)' }}
            />
            <span
              data-testid="rail-run-intent"
              className="truncate leading-tight"
              style={{
                maxWidth: '28ch',
                fontSize: 'var(--text-xs)',
                color: 'var(--ink-body)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {view.session.problem}
            </span>
            <span
              data-testid="rail-run-phase"
              className="ml-auto shrink-0"
              style={{
                fontSize: 'var(--text-2xs)',
                color: 'var(--ink-dim)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {phaseWord(view)}
            </span>
          </div>
        </button>
      ))}
      {/* The ONE escape hatch to the flat cross-project run lists (§2.3) — it
          stays at the bottom of the section (§1.4). */}
      <div className="px-3 pt-1 pb-1">
        <a
          href="/runs"
          data-testid="rail-all-runs"
          onClick={(e) => { e.preventDefault(); navigate('/runs'); }}
          className="text-[11px] font-mono transition-opacity hover:opacity-80"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          All runs ›
        </a>
      </div>
    </div>
  );
}
