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

export function ChatsPage({ runs, onSelect, navigate }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const { range, setRange, filter: filterByRange } = useTimeRange('30d');

  // Strict filter: include 'chat' runs and legacy runs with no workflow stamp as a transitional fallback.
  const allChats = useMemo(
    () => runs.filter((v) => !v.session.workflow_id || v.session.workflow_id === 'chat'),
    [runs],
  );

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
    <div className="flex flex-col gap-6" style={{ color: '#e6edf3' }}>

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
              background: '#1b222e',
              border: '1px solid rgba(230,237,243,0.12)',
              color: '#e6edf3',
              width: '220px',
            }}
          />
          <button
            type="button"
            onClick={() => navigate('/chat/new')}
            className="rounded-lg px-4 py-2 text-sm font-semibold font-mono shrink-0"
            style={{ background: '#ffda19', color: '#0d1117' }}
          >
            New Chat
          </button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="px-8 grid grid-cols-3 gap-4">
        {([
          { label: 'Total Chats', value: String(chats.length),  accent: undefined   },
          { label: 'Active',      value: String(active.length), accent: '#79c0ff'   },
          { label: 'Avg Units',   value: avgUnits,              accent: '#a78bfa'   },
        ] as const).map(s => (
          <div
            key={s.label}
            className="rounded-2xl px-6 py-4"
            style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
          >
            <p
              className="text-xs font-mono uppercase tracking-widest"
              style={{ color: 'rgba(230,237,243,0.4)' }}
            >
              {s.label}
            </p>
            <p
              className="text-3xl font-semibold mt-1"
              style={{ color: s.accent ?? '#e6edf3' }}
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
            style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
          >
            <p className="text-base font-mono font-semibold mb-3">No chat sessions yet</p>
            <p
              className="text-sm font-mono"
              style={{ color: 'rgba(230,237,243,0.45)' }}
            >
              Chat sessions let you explore your repos, ask questions, and get answers
              without kicking off a full build workflow.
            </p>
            <p className="mt-5">
              <button
                type="button"
                onClick={() => navigate('/chat/new')}
                className="text-sm font-mono hover:underline"
                style={{ color: '#79c0ff', background: 'none', border: 'none', cursor: 'pointer' }}
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
              style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.07)' }}
            >
              <p className="text-sm font-mono truncate">{v.session.problem}</p>
              <p className="text-xs mt-1 font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
                {v.session.id.slice(0, 8)} · {v.session.status}
              </p>
            </button>
          ))
        )}
      </div>

    </div>
  );
}
