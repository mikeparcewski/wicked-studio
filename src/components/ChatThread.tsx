import { useState } from 'react';
import { Markdown } from './Markdown.js';
import { ArtifactCard } from './ArtifactCard.js';
import {
  TONE_COLOR,
  TONE_GLYPH,
  type ChatFeedItem,
  type NarrationTone,
} from './narrator.js';

/**
 * The chat transcript renderer (DES-RUN-NARRATOR §11), extracted from
 * GroupChat so the surface component holds the machinery and this module holds
 * the pixels. Two views over ONE message log:
 *
 * - `narrated` (§11.1, the default): the user's messages and the crew's direct
 *   conversational replies stay first-class chat turns; a seat's still-
 *   streaming worker output, over-long output dumps, failed replies and seat
 *   lifecycle moments collapse into short narration lines — seat identity as a
 *   chip on the line, the raw bytes behind an expander (the same idiom the run
 *   feed ships). The classification lives in narrator.ts (`buildChatFeed`);
 *   this module only renders its items.
 * - `full` (§11.6): the old transcript, verbatim — every bubble, in the list or
 *   columns arrangement (DES-FEEDBACK-002 §6, slice K, unchanged).
 */

// ── Message log types (moved from GroupChat — same shapes, same contracts) ──

export interface UserMsg {
  kind: 'user';
  text: string;
  /** The send ordinal this message opened (1-based) — §7.9-3 turn identity. */
  turn?: number;
}
export interface SeatMsg {
  kind: 'seat';
  cliKey: string;
  text: string;
  pending: boolean;
  ok: boolean;
  /** The send ordinal this reply answers — chunk routing keys on seat+turn. */
  turn?: number;
}
/** A surface-recorded moment (§11.1: seat joined / could not join) — already
 *  narration; it never renders as a bubble in either view. */
export interface SysMsg {
  kind: 'sys';
  text: string;
  tone: NarrationTone;
  seat: string | null;
}
export type Msg = UserMsg | SeatMsg | SysMsg;

/**
 * Finalize-time retention (E4: "claude's complete plan was lost to the
 * collapse"). The chat wire keeps NO history — what the client streamed is the
 * ONLY copy — so a terminal `chatReply` that arrives SHORTER than the
 * accumulated deltas (an upstream output cap trimming older text, a failure
 * reframed as its reason line) must never clobber them. The LONGER text
 * stands; at equal length the terminal reply is authoritative — which also
 * keeps the §7.9-3 healing intact: a block mounted mid-stream holds partial
 * deltas, and the (longer) terminal reply still replaces them whole.
 */
export function retainOnFinalize(streamed: string, terminal: string): string {
  return terminal.length >= streamed.length ? terminal : streamed;
}

/**
 * Seat identity under the token contract (DES-VISION-001 §2.11): every chip and
 * avatar wears the SAME surface/ink pair, and identity rides the monogram +
 * name, not a per-CLI hue. Color is reserved for signal (§1.5 rule 2).
 */
export const SEAT_CHIP = { bg: 'var(--surface-raised)', fg: 'var(--ink-body)' } as const;

// ── Chat layout: list vs columns (DES-FEEDBACK-002 §6, slice K) ──────────────
//
// A round = a user message plus every seat message before the next user message
// (§6.1: the flat `messages` array already groups naturally — a send appends one
// UserMsg then N pending SeatMsgs that fill in place). Columns mode re-renders
// each round as a grid; the grouping below is PURE derivation over transcript
// state — it can never fire a request (§6.3: the toggle reads and re-arranges
// `messages` only).

export type ChatLayout = 'list' | 'columns';
/** §11.6: which rendering of the log — the narrated feed or the full transcript. */
export type ChatView = 'narrated' | 'full';

export interface ChatRound {
  user: UserMsg | null;
  seats: SeatMsg[];
}

/** §6.1's grouping rule: a new round starts at each user message; replies to
 *  DIFFERENT prompts (non-siblings) land in different rounds and stay linear —
 *  only same-round (same-prompt) replies ever sit side by side. Sys narration
 *  is a §11 feed concern, not a bubble — rounds skip it. */
export function groupRounds(messages: Msg[]): ChatRound[] {
  const rounds: ChatRound[] = [];
  for (const m of messages) {
    if (m.kind === 'sys') continue;
    if (m.kind === 'user') {
      rounds.push({ user: m, seats: [] });
    } else {
      let last = rounds[rounds.length - 1];
      if (last === undefined) {
        // Defensive: a seat message with no user message before it (cannot
        // happen via `send`, but the grouping must not throw on it).
        last = { user: null, seats: [] };
        rounds.push(last);
      }
      last.seats.push(m);
    }
  }
  return rounds;
}

/** §6.2: column order is stable across rounds — first-seen seat order — so the
 *  same agent is always in the same column. */
export function seatColumnOrder(messages: Msg[]): string[] {
  const order: string[] = [];
  for (const m of messages) {
    if (m.kind === 'seat' && !order.includes(m.cliKey)) order.push(m.cliKey);
  }
  return order;
}

/** §6.2: the choice persists per-session — a reading posture, not configuration,
 *  so it is deliberately NOT a crew setting (a settings write would violate the
 *  surface's request frugality). sessionStorage, wrapped: private-mode browsers
 *  degrade to per-mount state, never to a broken surface. */
const CHAT_LAYOUT_KEY = 'wicked.chat.layout';
const CHAT_VIEW_KEY = 'wicked.chat.view';
export function readStoredLayout(): ChatLayout {
  try {
    return sessionStorage.getItem(CHAT_LAYOUT_KEY) === 'columns' ? 'columns' : 'list';
  } catch {
    return 'list';
  }
}
export function writeStoredLayout(layout: ChatLayout): void {
  try {
    sessionStorage.setItem(CHAT_LAYOUT_KEY, layout);
  } catch {
    /* non-fatal — see readStoredLayout */
  }
}
/**
 * §11.6: narrated is the default; a stored view wins, and — for continuity with
 * transcripts arranged before the narrated view existed — a stored LAYOUT
 * preference with no stored view reads as "the full transcript, as arranged".
 */
export function readStoredView(): ChatView {
  try {
    const v = sessionStorage.getItem(CHAT_VIEW_KEY);
    if (v === 'narrated' || v === 'full') return v;
    return sessionStorage.getItem(CHAT_LAYOUT_KEY) !== null ? 'full' : 'narrated';
  } catch {
    return 'narrated';
  }
}
export function writeStoredView(view: ChatView): void {
  try {
    sessionStorage.setItem(CHAT_VIEW_KEY, view);
  } catch {
    /* non-fatal */
  }
}

// ── Bubbles (§5.3 token usage — moved verbatim from GroupChat) ───────────────

/** §5.3 token usage: user messages are transparent — the hairline keeps the
 *  bubble shape without claiming a surface of its own. */
function userBubble(m: UserMsg, key: React.Key): React.ReactElement {
  return (
    <div
      key={key}
      data-testid="user-bubble"
      data-turn={m.turn}
      className="self-end max-w-[70%] rounded-xl px-4 py-2 text-[13px]"
      style={{ background: 'transparent', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
    >
      {m.text}
    </div>
  );
}

function bubbleBody(m: SeatMsg): React.ReactElement {
  return (
    <div
      // §5.3 token usage: agent bubbles sit on --surface-card; the
      // border speaks status while a reply is pending or failed.
      // §7.9-3: the bubble WEARS its seat+turn identity, so chunk routing
      // is assertable in the DOM (data-turn matches the causing send).
      data-testid="seat-bubble"
      data-agent={m.cliKey}
      data-turn={m.turn}
      data-pending={m.pending}
      className="rounded-xl px-4 py-2 text-[13px] min-w-[60px]"
      style={{
        background: 'var(--surface-card)',
        border: `1px solid ${m.pending ? 'var(--status-run-dim)' : m.ok ? 'var(--surface-raised)' : 'var(--status-fail-dim)'}`,
      }}
    >
      {m.pending && m.text === '' ? (
        <span className="opacity-50 font-mono text-[11px] animate-pulse">thinking…</span>
      ) : (
        <Markdown>{m.text}</Markdown>
      )}
    </div>
  );
}

/** The seat avatar + bubble row — a seat turn in list/narrated dress. */
function seatRow(m: SeatMsg, key: React.Key): React.ReactElement {
  return (
    <div key={key} className="self-start max-w-[80%] flex gap-2">
      <span
        className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold mt-0.5"
        style={{ background: SEAT_CHIP.bg, color: SEAT_CHIP.fg }}
      >
        {m.cliKey.slice(0, 2).toUpperCase()}
      </span>
      {bubbleBody(m)}
    </div>
  );
}

/** §6.2 column header: the seat chip in the existing chip dress — monogram
 *  avatar + cliKey, SEAT_CHIP tokens verbatim. */
function columnHeader(cliKey: string): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-mono font-bold"
        style={{ background: SEAT_CHIP.bg, color: SEAT_CHIP.fg }}
      >
        {cliKey.slice(0, 2).toUpperCase()}
      </span>
      <span className="truncate text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>{cliKey}</span>
    </span>
  );
}

// ── The thread ────────────────────────────────────────────────────────────────

interface Props {
  messages: Msg[];
  view: ChatView;
  layout: ChatLayout;
  /** First-seen seat order (the caller's derivation — §6.2). */
  seatOrder: string[];
  /** The §11 narrated feed over `messages` (the caller's `buildChatFeed` memo —
   *  shared with its now-bar derivations, computed once). */
  items: ChatFeedItem[];
}

/**
 * Renders as a fragment INSIDE the caller's one scrolling region — GroupChat
 * keeps the container (and its boundary notes) so the dock stays a structural
 * sibling of the scroll region.
 */
export function ChatThread({ messages, view, layout, seatOrder, items }: Props): React.ReactElement {
  // §11.1 expanders: which narration lines have their raw output open. Keyed by
  // message index — stable, because the log is append-only. Collapsed default:
  // the narration is the headline; the bytes are one click below it. The raw
  // body stays MOUNTED (hidden) so streaming keeps flowing into it.
  const [openRaw, setOpenRaw] = useState<Record<number, boolean>>({});

  const narrationLine = (item: Extract<ChatFeedItem, { kind: 'narration' }>): React.ReactElement => {
    const expandable = item.index !== null;
    const msg = expandable ? messages[item.index as number] : undefined;
    const open = expandable ? openRaw[item.index as number] === true : false;
    return (
      <div key={item.key} className="flex flex-col gap-1.5">
        <div
          data-testid="chat-narration-line"
          data-tone={item.tone}
          {...(item.seat !== null ? { 'data-agent': item.seat } : {})}
          className="flex items-center gap-2 px-1"
        >
          <span aria-hidden="true" className="shrink-0 text-[10px] font-mono" style={{ color: TONE_COLOR[item.tone] }}>
            {TONE_GLYPH[item.tone]}
          </span>
          {item.seat !== null && (
            <span
              data-testid="chat-narration-seat"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-mono"
              style={{ background: SEAT_CHIP.bg, color: SEAT_CHIP.fg }}
            >
              {item.seat}
            </span>
          )}
          <span
            className="text-[12.5px] font-mono leading-relaxed min-w-0"
            style={{ color: item.tone === 'info' ? 'var(--ink-muted)' : 'var(--ink-body)' }}
          >
            {item.text}
          </span>
          {expandable && (
            <button
              type="button"
              data-testid={`chat-narration-toggle-${item.index}`}
              aria-expanded={open}
              onClick={() =>
                setOpenRaw((prev) => ({ ...prev, [item.index as number]: !(prev[item.index as number] === true) }))}
              className="shrink-0 text-xs font-medium font-mono hover:underline"
              style={{ color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {open ? '▾ Hide output' : '▸ Show output'}
            </button>
          )}
        </div>
        {expandable && msg !== undefined && msg.kind === 'seat' && (
          <div
            data-testid={`chat-narration-raw-${item.index}`}
            // Inline display toggle, NOT unmounting: the live stream keeps
            // accumulating in the (hidden) bubble, and tests/readers can reach
            // the bytes without a click.
            style={open ? undefined : { display: 'none' }}
          >
            {seatRow(msg, `raw${item.index}`)}
          </div>
        )}
      </div>
    );
  };

  if (view === 'narrated') {
    return (
      <>
        {items.map((item) => {
          if (item.kind === 'artifact') {
            return <ArtifactCard key={item.key} artifact={item.artifact} />;
          }
          if (item.kind === 'narration') return narrationLine(item);
          const m = messages[item.index];
          if (m === undefined || m.kind === 'sys') return null;
          return m.kind === 'user' ? userBubble(m, item.key) : seatRow(m, item.key);
        })}
      </>
    );
  }

  // ── The full transcript (§11.6) — the old rendering, verbatim ──────────────
  const transcript = messages.filter((m): m is UserMsg | SeatMsg => m.kind !== 'sys');
  if (layout === 'columns' && seatOrder.length >= 2) {
    // §6.2 columns mode: each round renders its user bubble (unchanged) then a
    // grid of the round's replies — one column per seat, order stable across
    // rounds (first-seen), an empty dimmed cell where a seat did not answer
    // this round (absence is information). The grid scrolls horizontally
    // INSIDE its round container past 3 columns — the page never scrolls
    // horizontally. No motion is added here, so the arrangement is
    // reduced-motion safe by construction.
    return (
      <>
        {groupRounds(transcript).map((round, ri) => (
          <div key={ri} data-testid="chat-round" className="flex flex-col gap-3">
            {round.user !== null && userBubble(round.user, 'u')}
            <div
              data-testid="chat-round-grid"
              data-columns={seatOrder.length}
              style={{
                display: 'grid',
                gap: '8px',
                gridTemplateColumns: `repeat(${seatOrder.length}, minmax(260px, 1fr))`,
                overflowX: 'auto',
              }}
            >
              {seatOrder.map((cliKey) => {
                const reply = round.seats.find((s) => s.cliKey === cliKey);
                return reply === undefined ? (
                  <div
                    key={cliKey}
                    data-testid="chat-cell-empty"
                    data-agent={cliKey}
                    className="flex flex-col gap-1.5 min-w-0"
                  >
                    {columnHeader(cliKey)}
                    <div
                      className="rounded-xl px-4 py-2 text-[13px] font-mono"
                      style={{ border: '1px dashed var(--surface-raised)', color: 'var(--ink-dim)' }}
                    >
                      —
                    </div>
                  </div>
                ) : (
                  <div
                    key={cliKey}
                    data-testid="chat-cell"
                    data-agent={cliKey}
                    className="flex flex-col gap-1.5 min-w-0"
                  >
                    {columnHeader(cliKey)}
                    {bubbleBody(reply)}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {transcript.map((m, i) => (m.kind === 'user' ? userBubble(m, i) : seatRow(m, i)))}
    </>
  );
}
