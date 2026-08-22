import { useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import { TimeRangeSelector } from './TimeRangeSelector.js';

interface Props {
  runs: SessionView[];
  onSelect: (id: string) => void;
  navigate: (path: string) => void;
}

const terminal = (s: string): boolean =>
  ['completed', 'failed', 'cancelled'].includes(s);

/**
 * The Chat predicate — exported so Make's complement is VERBATIM this filter
 * (DES-FEEDBACK-003 §4.2/§3.3: every run under exactly one path): chat runs
 * are 'chat'-stamped runs plus legacy runs with no workflow stamp.
 */
export const isChatRun = (v: SessionView): boolean =>
  !v.session.workflow_id || v.session.workflow_id === 'chat';

export function ChatsPage({ runs, onSelect, navigate }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const { range, setRange, filter: filterByRange } = useTimeRange('30d');

  // Strict filter: include 'chat' runs and legacy runs with no workflow stamp as a transitional fallback.
  const allChats = useMemo(() => runs.filter(isChatRun), [runs]);

  const chats = useMemo(() => filterByRange(allChats), [allChats, filterByRange]);

  const active = useMemo(() => chats.filter(v => !terminal(v.session.status)), [chats]);

  // Avg units per chat session (round to 1 decimal)
  const avgUnits = useMemo(() => {
    if (chats.length === 0) return '—';
    const total = chats.reduce((sum, v) => sum + v.units.length, 0);
    const avg = total / chats.length;
    return avg % 1 === 0 ? String(avg) : avg.toFixed(1);
  }, [chats]);

  const filtered = useMemo(
    () => query
      ? chats.filter(v => v.session.problem.toLowerCase().includes(query.toLowerCase()))
      : chats,
    [chats, query],
  );

  return (
    <div className="flex flex-col gap-6" style={{ color: 'var(--ink-high)' }}>

      {/* ── Header ── */}
      <div className="px-8 pt-8 pb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold font-mono">Chats</h1>
        <div className="flex items-center gap-3">
          <TimeRangeSelector value={range} onChange={setRange} />
          <input
            type="text"
            placeholder="Search chats…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="rounded-xl px-4 py-2 text-sm font-mono outline-none"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--surface-raised)',
              color: 'var(--ink-high)',
              width: '220px',
            }}
          />
          <button
            type="button"
            onClick={() => navigate('/chat/new')}
            className="rounded-lg px-4 py-2 text-sm font-semibold font-mono shrink-0"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            New Chat
          </button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="px-8 grid grid-cols-3 gap-4">
        {([
          { label: 'Total Chats', value: String(chats.length),  accent: undefined   },
          { label: 'Active',      value: String(active.length), accent: 'var(--status-run)'   },
          { label: 'Avg Units',   value: avgUnits,              accent: 'var(--accent)'   },
        ] as const).map(s => (
          <div
            key={s.label}
            className="rounded-2xl px-6 py-4"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
          >
            <p
              className="text-xs font-mono uppercase tracking-widest"
              style={{ color: 'var(--ink-dim)' }}
            >
              {s.label}
            </p>
            <p
              className="text-3xl font-semibold mt-1"
              style={{ color: s.accent ?? 'var(--ink-high)' }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── List / Empty state ── */}
      <div className="px-8 pb-8 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div
            className="rounded-2xl p-10 text-center"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
          >
            <p className="text-base font-mono font-semibold mb-3">No chat sessions yet</p>
            <p
              className="text-sm font-mono"
              style={{ color: 'var(--ink-muted)' }}
            >
              Chat sessions let you explore your repos, ask questions, and get answers
              without kicking off a full build workflow.
            </p>
            <p className="mt-5">
              <button
                type="button"
                onClick={() => navigate('/chat/new')}
                className="text-sm font-mono hover:underline"
                style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Click New Chat to start
              </button>
            </p>
          </div>
        ) : (
          filtered.map(v => (
            <button
              key={v.session.id}
              type="button"
              onClick={() => onSelect(v.session.id)}
              className="w-full text-left rounded-2xl px-5 py-4 transition-colors"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
            >
              <p className="text-sm font-mono truncate">{v.session.problem}</p>
              <p className="text-xs mt-1 font-mono" style={{ color: 'var(--ink-dim)' }}>
                {v.session.id.slice(0, 8)} · {v.session.status}
              </p>
            </button>
          ))
        )}
      </div>

    </div>
  );
}
