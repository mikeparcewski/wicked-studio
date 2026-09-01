import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import {
  liveSeatCount, stalledLiveChats, STALLED_IDLE_SECS, type LiveChatSnapshot,
} from '../board/chatStats.js';
import { gateOpenPath } from '../board/gateActions.js';
import { outcomeOf } from '../board/metrics.js';
import {
  attachSeries, deltaWord, orderByAttention, statusCounts, windowBuckets, windowDelta,
} from '../board/windowStats.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { rangeWord, useTimeRange } from '../hooks/useTimeRange.js';
import { useGateStore } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import { ageWord } from './DashboardTiles.js';
import {
  DashboardGrid, FilterStrip, KpiBand, KpiGroup, StatTile, type FilterChip,
} from './dashboardKit.js';
import { humanTitle, runShortId, runWhenWord } from './runIdentity.js';
import { RUN_DOT } from './RunsSection.js';

interface Props {
  runs: SessionView[];
  onSelect: (id: string) => void;
  navigate: (path: string) => void;
}

/**
 * The /chats landing as a COMMAND SURFACE (lane B, the 0.4.6 treatment): the
 * conversations you direct. A KPI band organized around the command-center
 * questions (performance / pipeline / risk), then one card per conversation —
 * LIVE warm sessions first (the daemon's seat pool, findable + endable, the
 * §7.9-5 zombie-cleanup contract preserved), then chat runs ordered needs-you
 * first. Every tile and card clicks through; "needs you" jumps STRAIGHT to
 * the waiting run's gate; the creation verb (New Chat) lives in the header.
 *
 * Wire honesty: chat HISTORY rides the app's one `GET /runs` (chat sessions
 * are runs — `isChatRun`'s partition), so windowed counts use the shared
 * positional window folds ("last 30", never a fabricated "30d", "—" when no
 * full prior bucket exists). The LIVE band rides the page's one declared
 * `GET /chats` (`{chatId, seats, idleSecs}` — nothing more), so the only live
 * metrics are seats, warm-session count, and idle age. Neither wire serves a
 * message/turn count, so no card claims one.
 */

/**
 * The Chat predicate — exported so Make's complement is VERBATIM this filter
 * (DES-FEEDBACK-003 §4.2/§3.3: every run under exactly one path): chat runs
 * are 'chat'-stamped runs plus legacy runs with no workflow stamp.
 */
export const isChatRun = (v: SessionView): boolean =>
  !v.session.workflow_id || v.session.workflow_id === 'chat';

/** One warm chat session on the daemon (`GET /chats` — the FINDING-027 wire). */
interface LiveChatRow extends LiveChatSnapshot {
  /** When this page last SAW a stream frame for the chat (0 = never). */
  lastFrameAt: number;
}

/** A frame this recent reads as "streaming now" — observed, never asserted. */
const STREAMING_WINDOW_MS = 30_000;

type StatusChip = 'all' | 'live' | 'needs-you' | 'active' | 'failed' | 'done';

function matchesChip(status: string, chip: StatusChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'live') return false; // runs never match the live chip
  const o = outcomeOf(status);
  if (chip === 'needs-you') return o === 'gate';
  if (chip === 'active') return o === 'run';
  if (chip === 'failed') return o === 'fail';
  return o === 'done' || o === 'cancelled';
}

const CARD: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
  background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
  borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-4)',
  cursor: 'pointer',
};

const CARD_META: React.CSSProperties = {
  fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

/** One agent seat as a chip (claude / pi / codex…) — the wire's own names. */
function SeatChips({ seats }: { seats: readonly string[] }): React.ReactElement | null {
  if (seats.length === 0) return null;
  return (
    <span style={{ display: 'flex', gap: '4px', flexShrink: 0, minWidth: 0, overflow: 'hidden' }}>
      {seats.map((s) => (
        <span
          key={s}
          data-testid="chat-seat"
          data-seat={s}
          style={{
            fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
            border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-full)',
            padding: '0 7px', whiteSpace: 'nowrap',
          }}
        >
          {s}
        </span>
      ))}
    </span>
  );
}

export function ChatsPage({ runs, onSelect, navigate }: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<StatusChip>('all');
  const { range, setRange } = useTimeRange('30d');

  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const gates = useGateStore((s) => s.gates);

  // ── Live sessions (DES-UX-001 §7.9-5): the warm seat pool, findable ────────
  // The review's zombie class — "abandoned tabs leak working agents nothing
  // points at" — dies here: every live chat the daemon holds is LISTED (one
  // GET /chats riding this navigation — a page-load read, not a mount ambush
  // on another surface), each with its seats, idle age, and an End control
  // (`DELETE /chats/:id`, the same teardown Chat's Close uses). Streams
  // announce themselves: a chatDelta/chatReply frame flags its session
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
        if (!cancelled) setLiveChats([]); // unreachable — the live cards stay absent
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

  // ── The chat-run partition + the window (the shared positional idiom) ──────
  const allChats = useMemo(
    () => orderByAttention(runs.filter((v) => isChatRun(v) && v.session.archived_at == null)),
    [runs],
  );
  const now = Date.now();
  const buckets = useMemo(() => windowBuckets(allChats, range), [allChats, range]);
  const windowIds = useMemo(() => new Set(buckets.current.map((v) => v.session.id)), [buckets]);

  // ── KPI folds — one selector each, over the two wires ──────────────────────
  const liveCounts = useMemo(() => statusCounts(allChats), [allChats]);
  const chatsDelta = useMemo(() => windowDelta(buckets, (rs) => rs.length), [buckets]);
  const failedDelta = useMemo(
    () => windowDelta(buckets, (rs) => rs.filter((v) => outcomeOf(v.session.status) === 'fail').length),
    [buckets],
  );
  const chatSpark = useMemo(
    () => attachSeries(buckets.current.map((v) => v.session.id), attachedAt, 14, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` re-derives with the data, not a timer
    [buckets, attachedAt],
  );
  const live = liveChats ?? [];
  const liveN = live.length;
  const seatN = liveSeatCount(live);
  const stalled = stalledLiveChats(live);
  // "Did a conversation stall on me?" is asked of every chat run, not just the
  // windowed slice — the oldest open chat gate's age off the gate store.
  const oldestChatGate = useMemo(() => {
    const ids = new Set(allChats.map((v) => v.session.id));
    return Object.values(gates)
      .filter((g) => ids.has(g.runId))
      .reduce<number | null>((acc, g) => (acc === null || g.receivedAt < acc ? g.receivedAt : acc), null);
  }, [gates, allChats]);

  /** The gate jump: the run's thread AT the gate when its project is known;
   *  the flat run detail (where the approval dock lives) when unfiled. */
  const gateJump = (id: string): string => {
    const pid = projectIdByRun[id];
    return pid !== undefined ? gateOpenPath(pid, id) : `/runs/${encodeURIComponent(id)}`;
  };

  // ── Filtering (search lifts the window — the Work page idiom) ──────────────
  const q = query.trim().toLowerCase();
  const searchedRuns = q === ''
    ? allChats.filter((v) => windowIds.has(v.session.id))
    : allChats.filter((v) =>
        v.session.problem.toLowerCase().includes(q)
        || runShortId(v.session.id).includes(q)
        || v.session.clis.some((c) => c.toLowerCase().includes(q)));
  const visibleRuns = chip === 'live' ? [] : searchedRuns.filter((v) => matchesChip(v.session.status, chip));
  const searchedLive = q === ''
    ? live
    : live.filter((c) => c.chatId.toLowerCase().includes(q) || c.seats.some((s) => s.toLowerCase().includes(q)));
  const visibleLive = (chip === 'all' || chip === 'live') ? searchedLive : [];
  const hiddenByWindow = q === '' ? allChats.length - buckets.current.length : 0;

  const chipCounts = useMemo(() => {
    const counts: Record<StatusChip, number> = { all: 0, live: searchedLive.length, 'needs-you': 0, active: 0, failed: 0, done: 0 };
    for (const v of searchedRuns) {
      counts.all += 1;
      for (const c of ['needs-you', 'active', 'failed', 'done'] as const) {
        if (matchesChip(v.session.status, c)) counts[c] += 1;
      }
    }
    counts.all += searchedLive.length;
    return counts;
  }, [searchedRuns, searchedLive.length]);

  const chips: FilterChip[] = [
    { id: 'all', label: 'All', count: chipCounts.all },
    { id: 'live', label: 'Live', count: chipCounts.live },
    { id: 'needs-you', label: 'Needs you', count: chipCounts['needs-you'] },
    { id: 'active', label: 'Active', count: chipCounts.active },
    { id: 'failed', label: 'Failed', count: chipCounts.failed },
    { id: 'done', label: 'Done', count: chipCounts.done },
  ];

  return (
    // FULL WIDTH — the section flows with the viewport; no max-width column.
    <div
      data-testid="chats-page"
      className="flex flex-col"
      style={{ color: 'var(--ink-high)', padding: '0 var(--space-8) var(--space-8)', gap: 'var(--space-4)' }}
    >
      {/* ── Header: the section name + its creation verb ── */}
      <div className="pt-8 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-4 min-w-0">
          <h1 className="text-2xl font-semibold font-mono" style={{ margin: 0 }}>Chats</h1>
          <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)' }}>
            the conversations you direct — live seats · chat runs
          </p>
        </div>
        <button
          type="button"
          data-testid="chats-new"
          onClick={() => navigate('/chat/new')}
          className="rounded-lg px-4 py-2 text-sm font-semibold font-mono shrink-0"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', cursor: 'pointer' }}
        >
          New Chat
        </button>
      </div>

      {/* ── The KPI band — the command-center model: three questions ── */}
      <KpiBand testId="chats-kpis">
        <KpiGroup label="Performance" grow={2}>
          <StatTile
            testId="stat-chats"
            label="Chats"
            value={buckets.current.length}
            delta={chatsDelta}
            context={deltaWord(range, chatsDelta)}
            spark={chatSpark}
            title="Chat runs in the window — click to clear filters"
            onOpen={() => { setChip('all'); setQuery(''); }}
          />
          <StatTile
            testId="stat-live-seats"
            label="Live seats"
            value={seatN}
            context={liveN > 0 ? `${liveN} warm session${liveN === 1 ? '' : 's'}` : 'no live sessions'}
            title="Warm agent seats on the daemon — filter to the live sessions"
            onOpen={() => setChip('live')}
          />
        </KpiGroup>
        <KpiGroup label="Pipeline" grow={2}>
          <StatTile
            testId="stat-active"
            label="Conversations now"
            value={liveN + liveCounts.active}
            context={liveN > 0 ? `${liveN} live · ${liveCounts.active} runs moving` : 'right now'}
            title="Live sessions plus chat runs moving — filter the grid to them"
            onOpen={() => setChip(liveCounts.active > 0 ? 'active' : 'live')}
          />
          <StatTile
            testId="stat-gates"
            label="Needs you"
            value={liveCounts.gates}
            valueColor={liveCounts.gates > 0 ? 'var(--status-gate)' : undefined}
            context={oldestChatGate !== null ? `oldest waiting ${ageWord(now - oldestChatGate)}` : 'nothing waiting'}
            title="Chat runs waiting on a human — filter the grid to them"
            onOpen={() => setChip('needs-you')}
          />
        </KpiGroup>
        <KpiGroup label="Risk" grow={2}>
          <StatTile
            testId="stat-failed"
            label="Failed"
            value={failedDelta.current}
            valueColor={failedDelta.current > 0 ? 'var(--status-fail)' : undefined}
            delta={failedDelta}
            deltaSense="bad-up"
            context={deltaWord(range, failedDelta)}
            title="Failed chat runs in the window — filter the grid to them"
            onOpen={() => setChip('failed')}
          />
          <StatTile
            testId="stat-stalled"
            label="Stalled live"
            value={stalled.length}
            valueColor={stalled.length > 0 ? 'var(--status-gate)' : undefined}
            context={liveN > 0 ? `idle ≥ ${STALLED_IDLE_SECS / 60}m of ${liveN} live` : 'no live sessions'}
            title="Warm sessions idle past 10 minutes — filter to the live sessions"
            onOpen={() => setChip('live')}
          />
        </KpiGroup>
      </KpiBand>

      {/* ── Filters — first-class at the top of the list ── */}
      <FilterStrip
        testId="chats-filter"
        query={query}
        onQuery={setQuery}
        placeholder="Search chats…"
        chips={chips}
        active={chip}
        onChip={(id) => setChip(id as StatusChip)}
        range={range}
        onRange={setRange}
      >
        {hiddenByWindow > 0 && (
          <button
            type="button"
            data-testid="chats-hidden-chip"
            data-hidden={hiddenByWindow}
            onClick={() => setRange('all')}
            title={`the ${rangeWord(range)} window holds back ${hiddenByWindow} older chat${hiddenByWindow === 1 ? '' : 's'} — click to show all`}
            style={{
              borderRadius: 'var(--radius-full)', padding: '3px 10px',
              fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              border: '1px solid var(--surface-raised)', background: 'transparent',
              color: 'var(--ink-muted)',
            }}
          >
            +{hiddenByWindow} older · show all
          </button>
        )}
      </FilterStrip>

      {/* ── The grid: live sessions FIRST (the NOW), then chat-run history ── */}
      {(visibleLive.length > 0 || visibleRuns.length > 0) && (
        <DashboardGrid testId="chats-list" min={340}>
          {visibleLive.map((c) => {
            const streaming = c.lastFrameAt !== 0 && now - c.lastFrameAt < STREAMING_WINDOW_MS;
            return (
              // J4/C6: a live card is a DOOR — clicking it (or Enter/Space)
              // opens the session at its real URL, `/chat/:id`, where the
              // surface rejoins the warm seats. End stays its own gesture.
              <div
                key={c.chatId}
                data-testid="live-chat-row"
                data-chat-id={c.chatId}
                data-streaming={streaming}
                role="link"
                tabIndex={0}
                title="Open this live session"
                onClick={() => navigate(`/chat/${encodeURIComponent(c.chatId)}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/chat/${encodeURIComponent(c.chatId)}`);
                  }
                }}
                className="transition-colors hover:bg-surface-raised"
                style={CARD}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span
                    aria-hidden
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: 'var(--status-run)' }}
                  />
                  <span className="text-sm font-mono truncate" style={{ color: 'var(--ink-high)', minWidth: 0 }}>
                    live · {c.chatId.slice(0, 8)}
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
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    data-testid="live-chat-end"
                    title="Disconnect this session's agents and end it"
                    onClick={(e) => {
                      e.stopPropagation(); // End is not Open
                      endLiveChat(c.chatId);
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-lg shrink-0"
                    style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)', border: '1px solid var(--surface-overlay)', cursor: 'pointer' }}
                  >
                    End
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  {c.seats.length > 0
                    ? <SeatChips seats={c.seats} />
                    : <span style={CARD_META}>seats unknown</span>}
                  <span style={{ ...CARD_META, marginLeft: 'auto' }}>warm on the daemon</span>
                </div>
              </div>
            );
          })}
          {visibleRuns.map((v) => {
            const { session } = v;
            const id = session.id;
            return (
              <div
                key={id}
                data-testid="chat-row"
                data-run-id={id}
                data-status={session.status}
                role="link"
                tabIndex={0}
                onClick={() => onSelect(id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelect(id); }}
                className="transition-colors hover:bg-surface-raised"
                style={CARD}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span
                    aria-hidden
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: RUN_DOT[session.status] ?? 'var(--ink-dim)' }}
                  />
                  {/* Derived title (runTitle's grammar) — the raw prompt lives
                      on the hover title, never the row. */}
                  <span
                    data-testid="chat-run-title"
                    title={session.problem}
                    style={{
                      flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', fontSize: 'var(--text-xs)',
                      fontFamily: 'var(--font-sans)', color: 'var(--ink-body)',
                    }}
                  >
                    {humanTitle(session.problem)}
                  </span>
                  <span className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
                    {session.status}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <SeatChips seats={session.clis} />
                  <span style={CARD_META}>
                    {runShortId(id)} · #{session.attempt + 1} · {runWhenWord(attachedAt[id], now)}
                  </span>
                  <span style={{ flex: 1 }} />
                  {session.status === 'awaiting_human' && (
                    <button
                      type="button"
                      data-testid="chat-needs-you"
                      data-run-id={id}
                      title="Jump straight to this conversation's gate"
                      onClick={(e) => { e.stopPropagation(); navigate(gateJump(id)); }}
                      style={{
                        flexShrink: 0, cursor: 'pointer',
                        background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)',
                        borderRadius: 'var(--radius-full)', padding: '2px 10px',
                        fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
                        fontWeight: 'var(--weight-bold)', color: 'var(--status-gate)',
                      }}
                    >
                      needs you →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </DashboardGrid>
      )}

      {/* ── The honest corpus boundary (J4/C6): live sessions but no recorded
             chat runs — say WHY the history is empty, never "No chat sessions
             yet" beside a live card. ── */}
      {liveN > 0 && allChats.length === 0 && (
        <p
          data-testid="chats-empty-live"
          style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
        >
          No recorded chat runs — your live sessions are above. Chat transcripts
          aren’t stored beyond the live session, so ended chats don’t appear here.
        </p>
      )}

      {/* ── Empty states — every one carries its CTA ── */}
      {visibleLive.length === 0 && visibleRuns.length === 0 && (
        (allChats.length > 0 || liveN > 0) ? (
          <p data-testid="chats-empty-filter" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', fontStyle: 'italic' }}>
            No conversations match this filter
            {hiddenByWindow > 0 ? ` — ${hiddenByWindow} sit outside the ${rangeWord(range)} window` : ''}.{' '}
            <button
              type="button"
              data-testid="chats-clear-filters"
              onClick={() => { setChip('all'); setQuery(''); }}
              style={{
                background: 'none', border: 'none', padding: 0, font: 'inherit',
                color: 'var(--ink-muted)', textDecoration: 'underline', cursor: 'pointer',
              }}
            >
              clear filters
            </button>
          </p>
        ) : (
          <div
            data-testid="chats-empty"
            className="rounded-2xl p-10 text-center"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
          >
            <p className="text-base font-mono font-semibold mb-3">No chat sessions yet</p>
            <p className="text-sm font-mono" style={{ color: 'var(--ink-muted)' }}>
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
      )}
    </div>
  );
}
