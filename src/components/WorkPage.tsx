import { useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { RunLink } from './RunLink.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import { TimeRangeSelector } from './TimeRangeSelector.js';

type StatusTab = 'all' | 'active' | 'completed' | 'failed';

interface Props {
  runs: SessionView[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
  navigate: (path: string) => void;
}

const isTerminal = (s: string) => ['completed', 'failed', 'cancelled'].includes(s);
const isActiveStatus = (s: string) => !isTerminal(s);
const isCompletedStatus = (s: string) => s === 'completed';
const isFailedStatus = (s: string) => s === 'failed' || s === 'cancelled';

const TABS: { id: StatusTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

export function WorkPage({ runs, selectedRunId, onSelect, navigate }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<StatusTab>('all');
  const { range, setRange, filter: filterByRange } = useTimeRange('30d');

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
      if (wf && wf !== 'chat') {
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

  const counts: Record<StatusTab, number> = {
    all: searched.length,
    active: searched.filter(v => isActiveStatus(v.session.status)).length,
    completed: searched.filter(v => isCompletedStatus(v.session.status)).length,
    failed: searched.filter(v => isFailedStatus(v.session.status)).length,
  };

  const activeGroup = searched.filter(v => isActiveStatus(v.session.status));
  const completedGroup = searched.filter(v => isCompletedStatus(v.session.status));
  const failedGroup = searched.filter(v => isFailedStatus(v.session.status));

  const filtered =
    tab === 'all' ? searched
    : tab === 'active' ? activeGroup
    : tab === 'completed' ? completedGroup
    : failedGroup;

  return (
    <div className="flex flex-col h-full" style={{ color: '#e6edf3' }}>
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
            background: '#1b222e',
            border: '1px solid rgba(230,237,243,0.12)',
            color: '#e6edf3',
            width: '240px',
          }}
        />
        <button
          type="button"
          onClick={() => navigate('/runs/new')}
          className="rounded-lg px-4 py-2 text-sm font-semibold font-mono shrink-0"
          style={{ background: '#ffda19', color: '#0d1117' }}
        >
          Do Work
        </button>
      </div>

      {/* Metrics row */}
      <div className="px-8 pb-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {([
          { label: 'Total Runs',    value: String(metrics.total),       accent: undefined },
          { label: 'Active',        value: String(metrics.active),       accent: '#79c0ff' },
          { label: 'Success Rate',  value: metrics.successRate,          accent: '#3fb950' },
          { label: 'Top Workflow',  value: metrics.topWorkflow,          accent: undefined },
        ] as const).map(s => (
          <div
            key={s.label}
            className="rounded-xl px-4 py-3"
            style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
          >
            <p
              className="text-[10px] font-mono uppercase tracking-widest"
              style={{ color: 'rgba(230,237,243,0.4)', margin: 0 }}
            >
              {s.label}
            </p>
            <p
              className="text-xl font-semibold font-mono mt-1 truncate"
              style={{ color: s.accent ?? '#e6edf3', margin: '4px 0 0' }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="px-8 pb-3 flex items-center gap-2">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="rounded-full px-3 py-1 text-xs font-mono"
            style={
              tab === t.id
                ? { background: 'rgba(230,237,243,0.1)', color: '#e6edf3' }
                : { color: 'rgba(230,237,243,0.4)' }
            }
          >
            {t.label} {counts[t.id]}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-5 pb-8 flex flex-col">
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
            {searched.length === 0 && <EmptyState query={query} />}
          </>
        ) : (
          <>
            {filtered.length === 0 ? (
              <EmptyState query={query} tab={tab} />
            ) : (
              filtered.map(v => (
                <RunLink key={v.session.id} view={v} selectedRunId={selectedRunId} onSelect={onSelect} />
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
      style={{ color: 'rgba(230,237,243,0.4)' }}
    >
      {pulse && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
          style={{ background: '#79c0ff' }}
        />
      )}
      {children}
    </div>
  );
}

function EmptyState({ query, tab }: { query: string; tab?: StatusTab }): React.ReactElement {
  const msg = query
    ? `No runs match "${query}".`
    : tab
    ? `No ${tab} runs yet.`
    : 'No work sessions yet.';
  return (
    <p className="px-3 py-6 text-sm font-mono italic" style={{ color: 'rgba(230,237,243,0.35)' }}>
      {msg}
    </p>
  );
}
