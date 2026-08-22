import { useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { useTimeRange, type TimeRange } from '../hooks/useTimeRange.js';
import { useGateStore } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import { GatesWaitingTile, TileBand } from './DashboardTiles.js';
import { MetricTile } from './MetricTile.js';
import { RunSparkline } from './RunSparkline.js';
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

// ── The chats-over-time tile (DES-FEEDBACK-003 §4.3 row 1, slice P) ───────────

const RANGE_DAYS: Record<TimeRange, number> = { '30d': 30, '60d': 60, '90d': 90 };
const BUCKETS = 12;
const DAY_MS = 86_400_000;

/**
 * "Is conversation increasing or drying up?" — the range-filtered chat runs,
 * bucketed over the range's span on the membership attach clock (the one
 * honest per-run clock; `AgentSession` carries no timestamps — the same
 * wire-honesty note RunOutcomeBar carries). Chats the mirror cannot place in
 * the window (unfiled, or older than the range) are excluded from the bars
 * and counted in `data-unplaced` rather than painted at an invented time.
 * Reads the mirror + the `runs` prop only: zero requests.
 */
function ChatsOverTimeTile({ chats, range, now }: {
  chats: SessionView[];
  range: TimeRange;
  now?: number;
}): React.ReactElement {
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const at = now ?? Date.now();
  const days = RANGE_DAYS[range];
  const { counts, placed } = useMemo(() => {
    const span = days * DAY_MS;
    const start = at - span;
    const buckets = new Array<number>(BUCKETS).fill(0);
    let inWindow = 0;
    for (const v of chats) {
      const clock = attachedAt[v.session.id];
      if (clock === undefined || clock < start || clock > at) continue;
      const ix = Math.min(BUCKETS - 1, Math.floor(((clock - start) / span) * BUCKETS));
      buckets[ix] = (buckets[ix] ?? 0) + 1;
      inWindow += 1;
    }
    return { counts: buckets, placed: inWindow };
  }, [chats, attachedAt, at, days]);

  return (
    <MetricTile
      testId="chats-over-time-tile"
      question="Is conversation increasing or drying up?"
      title={`Chats (${range})`}
      value={placed === 0 ? `no placed chats in ${range}` : `${placed} in ${range}`}
      data={{ 'data-total': placed, 'data-unplaced': chats.length - placed }}
    >
      {placed === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          No chats with an attach clock in the window.
        </p>
      ) : (
        <RunSparkline counts={counts} width={168} height={26} color="var(--accent)" />
      )}
    </MetricTile>
  );
}

export function ChatsPage({ runs, onSelect, navigate }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const { range, setRange, filter: filterByRange } = useTimeRange('30d');

  // Strict filter: include 'chat' runs and legacy runs with no workflow stamp as a transitional fallback.
  const allChats = useMemo(() => runs.filter(isChatRun), [runs]);

  const chats = useMemo(() => filterByRange(allChats), [allChats, filterByRange]);

  const active = useMemo(() => chats.filter(v => !terminal(v.session.status)), [chats]);

  // Gates from chats (§4.3 row 3): the gate store filtered to THIS partition —
  // "Did a conversation stall on me?" is asked of every chat, not just the
  // range-filtered slice, so the filter is the partition predicate alone.
  const gates = useGateStore((s) => s.gates);
  const chatGates = useMemo(() => {
    const ids = new Set(allChats.map((v) => v.session.id));
    return Object.values(gates).filter((g) => ids.has(g.runId));
  }, [gates, allChats]);

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

      {/* ── The reporting band (DES-FEEDBACK-003 §4.3, slice P): the page's
             derived numbers promoted into the shared MetricTile dress, ABOVE
             the untouched list (EC28); every tile answers its named question
             (EC19); the old stat cards are superseded by this band. ── */}
      <div className="px-8">
        <TileBand testId="chats-dashboard-tiles">
          <ChatsOverTimeTile chats={chats} range={range} />
          <MetricTile
            testId="chats-active-tile"
            question="How many threads are warm?"
            title="Active now"
            value={`${active.length} of ${chats.length}`}
            data={{ 'data-count': active.length }}
          >
            <p
              className="text-lg font-semibold leading-none"
              style={{ margin: 0, color: active.length > 0 ? 'var(--status-run)' : 'var(--ink-dim)' }}
            >
              {active.length}
            </p>
          </MetricTile>
          <GatesWaitingTile
            gates={chatGates}
            question="Did a conversation stall on me?"
            title="Gates from chats"
            testId="chats-gates-tile"
          />
        </TileBand>
      </div>

      {/* ── List / Empty state (untouched below the band, §4.3) ── */}
      <div className="px-8 pb-8 flex flex-col gap-2" data-testid="chats-list">
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
              data-testid="chat-row"
              data-run-id={v.session.id}
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
