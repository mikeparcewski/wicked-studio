import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { outcomeOf } from '../board/metrics.js';
import { RunLink } from './RunLink.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import { TimeRangeSelector } from './TimeRangeSelector.js';

type StatusTab = 'all' | 'active' | 'completed' | 'failed' | 'cancelled';

interface Props {
  runs: SessionView[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
  navigate: (path: string) => void;
  /** The current URL search string — §7.4's context-sensitive entry (slice Y):
   *  `?filter=failed` (an all-runs affordance in a failure context) lands with
   *  the Failed tab active. Anything not a tab id is ignored. */
  search?: string;
}

/** The routed status filter, or null when the search carries none/garbage. */
function routedFilter(search: string): StatusTab | null {
  const raw = new URLSearchParams(search).get('filter');
  return raw !== null && TABS.some((t) => t.id === raw) ? (raw as StatusTab) : null;
}

// The J5/A5 partition is THE shared one (src/board/metrics.ts `outcomeOf`):
// cancelled ≠ failed, so the Failed filter lists exactly the set every failed
// COUNT names — the landing's number is reproducible from these rows.
const isTerminal = (s: string) => ['completed', 'failed', 'cancelled'].includes(s);
const isActiveStatus = (s: string) => !isTerminal(s);
const isCompletedStatus = (s: string) => outcomeOf(s) === 'done';
const isFailedStatus = (s: string) => outcomeOf(s) === 'fail';
const isCancelledStatus = (s: string) => outcomeOf(s) === 'cancelled';

const TABS: { id: StatusTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  // Cancelled runs get their OWN filter — they left the Failed set (J5/A5)
  // and every terminal row must still be reachable through some filter.
  { id: 'cancelled', label: 'Cancelled' },
];

export function WorkPage({ runs, selectedRunId, onSelect, navigate, search = '' }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const entryFilter = routedFilter(search);
  const [tab, setTab] = useState<StatusTab>(entryFilter ?? 'all');
  // The page stays mounted across /work navigations, so a LATER entry that
  // carries `?filter=` (a failure-context affordance clicked while already
  // here) re-points the tab too; tab clicks afterwards win as local state.
  useEffect(() => {
    if (entryFilter !== null) setTab(entryFilter);
  }, [entryFilter]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { range, setRange, filter: filterByRange } = useTimeRange('30d');
  // Archived runs (crew#265) are WRITTEN OFF: excluded from the default list server-side, so the
  // chip fetches the complete history on demand rather than always paying for it. `null` = not
  // yet fetched; refetch on toggle-on so an unarchive elsewhere is reflected.
  const [showArchived, setShowArchived] = useState(false);
  const [archivedRuns, setArchivedRuns] = useState<SessionView[] | null>(null);
  useEffect(() => {
    if (!showArchived) return;
    let cancelled = false;
    api
      .listRuns(true)
      .then(({ runs: all }) => {
        if (cancelled) return;
        setArchivedRuns(all.filter((v) => v.session.archived_at != null));
      })
      .catch(() => {
        if (!cancelled) setArchivedRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showArchived]);
  async function unarchive(id: string): Promise<void> {
    try {
      await api.archiveRun(id, false);
      setArchivedRuns((prev) => (prev ? prev.filter((v) => v.session.id !== id) : prev));
    } catch {
      /* surfaced on next fetch; the row simply stays */
    }
  }

  const allWorkRuns = useMemo(
    () => runs.filter((v) => !!v.session.workflow_id && v.session.workflow_id !== 'chat'),
    [runs],
  );

  const windowedRuns = useMemo(() => filterByRange(allWorkRuns), [allWorkRuns, filterByRange]);

  const normalizedQuery = query.toLowerCase();
  const searched = useMemo(
    () => query
      ? windowedRuns.filter(v => v.session.problem.toLowerCase().includes(normalizedQuery))
      : windowedRuns,
    [windowedRuns, query, normalizedQuery],
  );

  // ── Metrics (scoped to time window, before search filter) ────────────────
  const metrics = useMemo(() => {
    const total = windowedRuns.length;
    const active = windowedRuns.filter(v => isActiveStatus(v.session.status)).length;
    const completed = windowedRuns.filter(v => isCompletedStatus(v.session.status)).length;
    const terminal = windowedRuns.filter(v => isTerminal(v.session.status)).length;
    const successRate = terminal > 0
      ? `${Math.round((completed / terminal) * 100)}%`
      : '—';

    // Top workflow by frequency (work sessions only)
    const freq = new Map<string, number>();
    for (const v of windowedRuns) {
      const wf = v.session.workflow_id;
      // Skip chat and unresolved instance UUIDs (wf-<uuid>) — the sessionsDetail patch
      // resolves known builtins; anything still starting with 'wf-' has no known def name.
      if (wf && wf !== 'chat' && !wf.startsWith('wf-')) {
        freq.set(wf, (freq.get(wf) ?? 0) + 1);
      }
    }
    let topWorkflow = '—';
    let topCount = 0;
    freq.forEach((count, wf) => {
      if (count > topCount) { topCount = count; topWorkflow = wf; }
    });

    return { total, active, successRate, topWorkflow };
  }, [windowedRuns]);

  const activeGroup = searched.filter(v => isActiveStatus(v.session.status));
  const completedGroup = searched.filter(v => isCompletedStatus(v.session.status));
  const failedGroup = searched.filter(v => isFailedStatus(v.session.status));
  const cancelledGroup = searched.filter(v => isCancelledStatus(v.session.status));

  const counts: Record<StatusTab, number> = {
    all: searched.length,
    active: activeGroup.length,
    completed: completedGroup.length,
    failed: failedGroup.length,
    cancelled: cancelledGroup.length,
  };

  const filtered =
    tab === 'all' ? searched
    : tab === 'active' ? activeGroup
    : tab === 'completed' ? completedGroup
    : tab === 'failed' ? failedGroup
    : cancelledGroup;

  // EC39, the J5/A5 follow-through: the positional range window can hide the
  // very rows a landing count NAMES (live: the lede's "3 cancelled" linked to
  // a 30d view holding zero cancelled rows — a count with no visible list).
  // When the window excludes rows of the ACTIVE filter, the exclusion is
  // STATED, never silent. Search is the user's own narrowing and says so in
  // its empty state already, so the note counts against the unsearched window.
  const inTabGroup = (v: SessionView): boolean =>
    tab === 'all' ? true
    : tab === 'active' ? isActiveStatus(v.session.status)
    : tab === 'completed' ? isCompletedStatus(v.session.status)
    : tab === 'failed' ? isFailedStatus(v.session.status)
    : isCancelledStatus(v.session.status);
  const windowedTabCount = windowedRuns.filter(inTabGroup).length;
  const hiddenByRange = allWorkRuns.filter(inTabGroup).length - windowedTabCount;

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--ink-high)' }}>
      {/* Header */}
      <div className="px-8 pt-8 pb-4 flex items-center gap-4">
        <h1 className="text-xl font-semibold font-mono">Work</h1>
        <div className="flex-1" />
        <TimeRangeSelector value={range} onChange={setRange} />
        <input
          type="text"
          placeholder="Search work…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="rounded-xl px-4 py-2 text-sm font-mono outline-none"
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--surface-raised)',
            color: 'var(--ink-high)',
            width: '240px',
          }}
        />
        <button
          type="button"
          onClick={() => navigate('/runs/new')}
          className="rounded-lg px-4 py-2 text-sm font-semibold font-mono shrink-0"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Do Work
        </button>
      </div>

      {/* Metrics row */}
      <div className="px-8 pb-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {([
          { label: 'Total Runs',    value: String(metrics.total),       accent: undefined },
          { label: 'Active',        value: String(metrics.active),       accent: 'var(--status-run)' },
          { label: 'Success Rate',  value: metrics.successRate,          accent: 'var(--status-run)' },
          { label: 'Top Workflow',  value: metrics.topWorkflow,          accent: undefined },
        ] as const).map(s => (
          <div
            key={s.label}
            className="rounded-xl px-4 py-3"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
          >
            <p
              className="text-[10px] font-mono uppercase tracking-widest"
              style={{ color: 'var(--ink-dim)', margin: 0 }}
            >
              {s.label}
            </p>
            <p
              className="text-xl font-semibold font-mono mt-1 truncate"
              style={{ color: s.accent ?? 'var(--ink-high)', margin: '4px 0 0' }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div
        role="tablist"
        aria-label="Filter by status"
        data-filter={tab}
        className="px-8 pb-3 flex items-center gap-2"
        onKeyDown={e => {
          const ids = TABS.map(t => t.id);
          const idx = ids.indexOf(tab);
          let nextIdx: number | null = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            nextIdx = (idx + 1) % ids.length;
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            nextIdx = (idx - 1 + ids.length) % ids.length;
          }
          if (nextIdx !== null) {
            setTab(ids[nextIdx]!);
            tabRefs.current[nextIdx]?.focus();
          }
        }}
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={el => { tabRefs.current[i] = el; }}
            id={`work-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`work-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className="rounded-full px-3 py-1 text-xs font-mono"
            style={
              tab === t.id
                ? { background: 'var(--surface-raised)', color: 'var(--ink-high)' }
                : { color: 'var(--ink-dim)' }
            }
          >
            {t.label} {counts[t.id]}
          </button>
        ))}
        <div className="flex-1" />
        {/* Archived is orthogonal to status: a write-off toggle, not a fifth status tab. */}
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(s => !s)}
          className="rounded-full px-3 py-1 text-xs font-mono"
          style={
            showArchived
              ? { background: 'var(--surface-raised)', color: 'var(--ink-high)', border: '1px dashed var(--ink-dim)' }
              : { color: 'var(--ink-dim)', border: '1px dashed var(--surface-raised)' }
          }
        >
          Archived{archivedRuns !== null ? ` ${archivedRuns.length}` : ''}
        </button>
      </div>

      {/* List */}
      <div
        id={`work-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`work-tab-${tab}`}
        className="flex-1 overflow-y-auto px-5 pb-8 flex flex-col"
      >
        {hiddenByRange > 0 && (
          <p
            data-testid="work-range-hidden-note"
            data-hidden={hiddenByRange}
            className="px-3 pb-2 text-[11px] font-mono"
            style={{ color: 'var(--ink-muted)', margin: 0 }}
          >
            {hiddenByRange} more{tab === 'all' ? '' : ` ${tab}`} run{hiddenByRange === 1 ? '' : 's'} sit
            {hiddenByRange === 1 ? 's' : ''} outside this {range} view
            {range !== '90d' ? (
              <>
                {' — '}
                <button
                  type="button"
                  data-testid="work-range-widen"
                  onClick={() => setRange('90d')}
                  className="underline"
                  style={{ color: 'var(--ink-muted)', background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
                >
                  widen to 90d
                </button>
              </>
            ) : (
              ' (the view is positional — newest first)'
            )}
          </p>
        )}
        {tab === 'all' ? (
          <>
            {activeGroup.length > 0 && (
              <>
                <GroupLabel pulse>Active</GroupLabel>
                {activeGroup.map(v => (
                  <RunLink key={v.session.id} view={v} selectedRunId={selectedRunId} onSelect={onSelect} />
                ))}
              </>
            )}
            {completedGroup.length > 0 && (
              <>
                <GroupLabel>Completed</GroupLabel>
                {completedGroup.map(v => (
                  <RunLink key={v.session.id} view={v} selectedRunId={selectedRunId} onSelect={onSelect} />
                ))}
              </>
            )}
            {failedGroup.length > 0 && (
              <>
                <GroupLabel>Failed</GroupLabel>
                {failedGroup.map(v => (
                  <RunLink key={v.session.id} view={v} selectedRunId={selectedRunId} onSelect={onSelect} />
                ))}
              </>
            )}
            {cancelledGroup.length > 0 && (
              <>
                <GroupLabel>Cancelled</GroupLabel>
                {cancelledGroup.map(v => (
                  <RunLink key={v.session.id} view={v} selectedRunId={selectedRunId} onSelect={onSelect} />
                ))}
              </>
            )}
            {searched.length === 0 && <EmptyState query={query} hidden={hiddenByRange} />}
          </>
        ) : (
          <>
            {filtered.length === 0 ? (
              <EmptyState query={query} tab={tab} hidden={hiddenByRange} />
            ) : (
              filtered.map(v => (
                <RunLink key={v.session.id} view={v} selectedRunId={selectedRunId} onSelect={onSelect} />
              ))
            )}
          </>
        )}
        {showArchived && archivedRuns !== null && (
          <>
            <GroupLabel>Archived</GroupLabel>
            {archivedRuns.length === 0 ? (
              <p className="px-3 py-3 text-sm font-mono italic" style={{ color: 'var(--ink-dim)' }}>
                Nothing archived.
              </p>
            ) : (
              archivedRuns.map(v => (
                <div key={v.session.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0" style={{ opacity: 0.55 }}>
                    <RunLink view={v} selectedRunId={selectedRunId} onSelect={onSelect} />
                  </div>
                  <button
                    type="button"
                    onClick={() => void unarchive(v.session.id)}
                    className="rounded-lg px-2 py-1 text-[11px] font-mono shrink-0"
                    style={{ color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
                  >
                    Unarchive
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

function GroupLabel({ children, pulse }: { children: React.ReactNode; pulse?: boolean }): React.ReactElement {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-widest font-semibold font-mono"
      style={{ color: 'var(--ink-dim)' }}
    >
      {pulse && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
          style={{ background: 'var(--status-run)' }}
        />
      )}
      {children}
    </div>
  );
}

function EmptyState({ query, tab, hidden = 0 }: { query: string; tab?: StatusTab; hidden?: number }): React.ReactElement {
  // ONE truth per screen: "No <tab> runs yet." may not sit under a note saying
  // N exist outside the range window — when rows are hidden, say WHERE they are.
  const msg = query
    ? `No runs match "${query}".`
    : hidden > 0
    ? `No${tab ? ` ${tab}` : ''} runs in this range view — ${hidden} exist${hidden === 1 ? 's' : ''} outside it.`
    : tab
    ? `No ${tab} runs yet.`
    : 'No work sessions yet.';
  return (
    <p className="px-3 py-6 text-sm font-mono italic" style={{ color: 'var(--ink-dim)' }}>
      {msg}
    </p>
  );
}
