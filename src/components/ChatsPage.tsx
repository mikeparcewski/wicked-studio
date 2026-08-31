import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { rangeWord, useTimeRange, type TimeRange } from '../hooks/useTimeRange.js';
import { useGateStore } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import { GatesWaitingTile, TileBand } from './DashboardTiles.js';
import { MetricTile } from './MetricTile.js';
import { humanTitle } from './runIdentity.js';
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

const RANGE_DAYS: Record<TimeRange, number> = { '30d': 30, '60d': 60, '90d': 90, all: 365 };

/** The honest window phrase: "in the last 30" (runs), or "overall" for `all`. */
const windowWordOf = (r: TimeRange): string => (r === 'all' ? 'overall' : `in the ${rangeWord(r)}`);
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
      title={`Chats (${rangeWord(range)})`}
      value={placed === 0 ? `no placed chats ${windowWordOf(range)}` : `${placed} ${windowWordOf(range)}`}
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

/** One warm chat session on the daemon (`GET /chats` — the FINDING-027 wire). */
interface LiveChatRow {
  chatId: string;
  seats: string[];
  idleSecs: number | null;
  /** When this page last SAW a stream frame for the chat (0 = never). */
  lastFrameAt: number;
}

/** A frame this recent reads as "streaming now" — observed, never asserted. */
const STREAMING_WINDOW_MS = 30_000;

export function ChatsPage({ runs, onSelect, navigate }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const { range, setRange, filter: filterByRange } = useTimeRange('30d');

  // ── Live sessions (DES-UX-001 §7.9-5): the warm seat pool, findable ────────
  // The review's zombie class — "abandoned tabs leak working agents nothing
  // points at" — dies here: every live chat the daemon holds is LISTED on
  // /chats (one GET /chats riding this navigation — a page-load read, not a
  // mount ambush on another surface), each with its seats, idle age, and an
  // End control (`DELETE /chats/:id`, the same teardown Chat's Close uses).
  // Streams announce themselves: a chatDelta/chatReply frame flags its session
  // "streaming now" from the FIRST frame — a session is visible here while it
  // streams, even one this list fetch predates.
  const [liveChats, setLiveChats] = useState<LiveChatRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .listChats()
      .then(({ chats }) => {
        if (cancelled) return;
        setLiveChats(chats.map((c) => ({ ...c, lastFrameAt: 0 })));
      })
      .catch(() => {
        if (!cancelled) setLiveChats([]); // unreachable — the band stays absent
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEventStream((ev) => {
    const frame = ev as { type: string; chat?: string; cliKey?: string; reason?: string };
    if (typeof frame.chat !== 'string' || frame.chat === '') return;
    if (frame.type === 'chatClosed') {
      setLiveChats((prev) => (prev === null ? prev : prev.filter((c) => c.chatId !== frame.chat)));
      return;
    }
    if (!['chatDelta', 'chatReply', 'chatSessionReady'].includes(frame.type)) return;
    setLiveChats((prev) => {
      const now = Date.now();
      const list = prev ?? [];
      const found = list.find((c) => c.chatId === frame.chat);
      if (found === undefined) {
        // §7.9-5: listed from its FIRST frame — a session the fetch predates.
        return [
          ...list,
          { chatId: frame.chat!, seats: frame.cliKey ? [frame.cliKey] : [], idleSecs: null, lastFrameAt: now },
        ];
      }
      return list.map((c) =>
        c.chatId === frame.chat
          ? {
              ...c,
              lastFrameAt: now,
              seats: frame.cliKey && !c.seats.includes(frame.cliKey) ? [...c.seats, frame.cliKey] : c.seats,
            }
          : c,
      );
    });
  });

  /** End a warm session from the list — the zombie-cleanup affordance. */
  function endLiveChat(chatId: string): void {
    void api
      .closeChat(chatId)
      .then(() => setLiveChats((prev) => (prev === null ? prev : prev.filter((c) => c.chatId !== chatId))))
      .catch(() => {
        /* teardown is best-effort — the daemon's idle reaper collects either way */
      });
  }

  // Strict filter: include 'chat' runs and legacy runs with no workflow stamp as a transitional fallback.
  const allChats = useMemo(() => runs.filter(isChatRun), [runs]);

  const chats = useMemo(() => filterByRange(allChats), [allChats, filterByRange]);

  const active = useMemo(() => chats.filter(v => !terminal(v.session.status)), [chats]);

  /** Live pool sessions visible on this screen — the Active-now headline
   *  counts them too (round 2, J4 minor / EC39: the number matches the page). */
  const liveCount = liveChats?.length ?? 0;

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
            // Round 2, J4 minor / EC39: the headline counts what THIS SCREEN
            // shows — live pool sessions (the band below) plus non-terminal
            // chat runs in the selected range — and labels each part, so
            // "0 of 0" can never sit beside a visible live row.
            value={
              liveCount > 0
                ? `${liveCount} live session${liveCount === 1 ? '' : 's'} · ${active.length} chat run${active.length === 1 ? '' : 's'} ${windowWordOf(range)}`
                : `${active.length} of ${chats.length} chat runs ${windowWordOf(range)}`
            }
            data={{ 'data-count': active.length + liveCount, 'data-live': liveCount }}
          >
            <p
              className="text-lg font-semibold leading-none"
              style={{
                margin: 0,
                color: active.length + liveCount > 0 ? 'var(--status-run)' : 'var(--ink-dim)',
              }}
            >
              {active.length + liveCount}
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

      {/* ── Live sessions (DES-UX-001 §7.9-5): warm seats, findable + endable.
             Absent entirely when the daemon holds none — the run list below is
             history; this band is the NOW. ── */}
      {liveChats !== null && liveChats.length > 0 && (
        <div className="px-8 flex flex-col gap-2" data-testid="live-chats" data-count={liveChats.length}>
          <p
            className="text-[10px] font-mono uppercase tracking-widest m-0"
            style={{ color: 'var(--ink-dim)' }}
          >
            Live sessions — warm agent seats on the daemon
          </p>
          {liveChats.map((c) => {
            const streaming = c.lastFrameAt !== 0 && Date.now() - c.lastFrameAt < STREAMING_WINDOW_MS;
            return (
              // J4/C6: a live row is a DOOR, not a plaque — clicking it (or
              // Enter/Space with focus) opens the session at its real URL,
              // `/chat/:id`, where the surface rejoins the warm seats. The End
              // control stays its own gesture (stopPropagation).
              <div
                key={c.chatId}
                data-testid="live-chat-row"
                data-chat-id={c.chatId}
                data-streaming={streaming}
                role="button"
                tabIndex={0}
                title="Open this live session"
                onClick={() => navigate(`/chat/${encodeURIComponent(c.chatId)}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/chat/${encodeURIComponent(c.chatId)}`);
                  }
                }}
                className="w-full flex items-center gap-3 rounded-2xl px-5 py-3 cursor-pointer"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
              >
                <span className="text-sm font-mono truncate" style={{ color: 'var(--ink-high)' }}>
                  {c.chatId.slice(0, 8)}
                </span>
                <span className="text-xs font-mono truncate" style={{ color: 'var(--ink-muted)' }}>
                  {c.seats.length > 0 ? c.seats.join(' · ') : 'seats unknown'}
                </span>
                {streaming ? (
                  <span
                    data-testid="live-chat-streaming"
                    title="A reply frame from this session was observed in the last 30s"
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: 'var(--status-run)', border: '1px solid var(--status-run-dim)' }}
                  >
                    streaming now
                  </span>
                ) : (
                  <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--ink-dim)' }}>
                    {c.idleSecs === null ? 'idle (age unknown)' : `idle ${Math.round(c.idleSecs)}s`}
                  </span>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  data-testid="live-chat-end"
                  title="Disconnect this session's agents and end it"
                  onClick={(e) => {
                    e.stopPropagation(); // End is not Open
                    endLiveChat(c.chatId);
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-lg shrink-0"
                  style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)', border: '1px solid var(--surface-overlay)' }}
                >
                  End
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── List / Empty state (below the band, §4.3) ── */}
      <div className="px-8 pb-8 flex flex-col gap-2" data-testid="chats-list">
        {filtered.length === 0 ? (
          // ONE truth per screen (J4/C6): "No chat sessions yet" may never sit
          // beside a non-empty live band. With live sessions above, this rail
          // says what it actually holds — recorded chat RUNS — and states the
          // persistence boundary honestly (chat transcripts are not stored
          // beyond the live session; there is no history wire to list here).
          (liveChats?.length ?? 0) > 0 ? (
            <div
              data-testid="chats-empty-live"
              className="rounded-2xl p-10 text-center"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
            >
              <p className="text-base font-mono font-semibold mb-3">
                No recorded chat runs — your live sessions are above
              </p>
              <p className="text-sm font-mono" style={{ color: 'var(--ink-muted)' }}>
                Open a live session to continue it. Chat transcripts aren’t stored
                beyond the live session, so ended chats don’t appear here.
              </p>
            </div>
          ) : (
          <div
            data-testid="chats-empty"
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
          )
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
              <p className="text-sm font-mono truncate" title={v.session.problem}>
                {humanTitle(v.session.problem)}
              </p>
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
