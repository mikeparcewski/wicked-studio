import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/**
 * THE LIVE SIDE OF AN ASK (DES-ASK-TEAM-CHAT-001 §4.8, slice ASK-S1): what this client knows about
 * a chat's turns before the daemon's transcript has them.
 *
 *  - The Ask dock deposits the operator's turn the moment `POST /chats/:id/messages` answers 202
 *    (`turnId`, and — on a daemon with `capabilities.askPath` — the `runId` / `stepId` of the ask
 *    path it launched or continued), so the session thread shows the question at once.
 *  - The app-level `/ws` fold deposits the PA's reply as it streams: `chatDelta` grows a pending
 *    turn (live typing), `chatReply` finishes it (the text is the canonical output the relay read
 *    at the fold — it REPLACES the accumulated deltas, never merges with them). `chatClosed` drops
 *    the chat.
 *  - `runs` is every run id known to be an ask path (from the 202, or `GET /chats/:id.path`): the
 *    gate store reads it to leave the ask's TURN gate undrawn (§4.8 — the composer is the answer),
 *    and the needs-you fold reads it to keep that turn out of the Desk's gate rows.
 *
 * A turn the transcript now carries is deduplicated by the thread (`turnId`, and `cliKey` for a
 * reply), so a reload or a late join renders each turn once; `replySeq` ticks per finished reply so
 * the session re-reads `GET /chats/:id` (the transcript's `seat`, `citations` and `decisions`
 * records, and the path's reviewer / helpers) exactly when something landed.
 */
export interface AskTurn {
  turnId: string;
  /** `you`, or the seat that answered (the PA). */
  who: 'you' | string;
  text: string;
  /** A reply still streaming (`chatDelta`s, no `chatReply` yet). */
  pending: boolean;
  ok: boolean;
  /** Client time of the deposit / first frame (Unix millis). */
  at: number;
  runId?: string;
  stepId?: string;
  ord?: number;
}

export interface AskSent {
  turnId: string;
  text: string;
  runId?: string;
  stepId?: string;
  at?: number;
}

interface AskThreadState {
  turns: Record<string, AskTurn[]>;
  /** chat → the ask path's run. */
  runByChat: Record<string, string>;
  /** Every run id this client knows as an ask path. */
  runs: ReadonlySet<string>;
  /** Per run: a `plan.accepted` carried a creator step — from then on every gate is real work's (#1). */
  creatorAccepted: Record<string, boolean>;
  /** Per run: the TURN gate the gate store left undrawn (`{ord, at}`) — the one positive fact the
   *  needs-you fold and the thread act on; an UNKNOWN gate is never treated as a turn gate (#2). */
  turnGates: Record<string, { ord: number; at: number }>;
  /** Per chat: ticks on every finished reply. */
  replySeq: Record<string, number>;
  /** Per chat: the seat whose frames answer — the PA (§8 F6's "claude is still answering"). */
  paByChat: Record<string, string>;
  sent: (chatId: string, turn: AskSent) => void;
  linkRun: (chatId: string, runId: string) => void;
  /** The runs list arrived: a run launched from a chat whose every unit is an answer step
   *  (`answer-N — …`, the engine's own step-id naming) is an ask path — so a fresh page (the Desk
   *  after a reload) classifies its turn gate before the gate reconcile runs. */
  learnRuns: (views: ReadonlyArray<{ session: { id: string; chat_id?: string | null }; units: ReadonlyArray<{ description?: string | null }> }>) => void;
  /** The session's hydrate learnt whether the accepted plan has a creator step. */
  setCreatorAccepted: (runId: string, accepted: boolean) => void;
  /** The gate store left this run's turn gate undrawn. */
  recordTurnGate: (runId: string, ord: number) => void;
  /** A real gate opened or the run moved: the recorded turn gate is spent. */
  clearTurnGate: (runId: string) => void;
  ingest: (event: CoreEvent) => void;
  /** The chat ended (End, `chatClosed`, the daemon forgot it). */
  drop: (chatId: string) => void;
}

function withRun(runs: ReadonlySet<string>, runId: string): ReadonlySet<string> {
  return runs.has(runId) ? runs : new Set([...runs, runId]);
}

export const useAskThreadStore = create<AskThreadState>((set) => ({
  turns: {},
  runByChat: {},
  runs: new Set<string>(),
  creatorAccepted: {},
  turnGates: {},
  replySeq: {},
  paByChat: {},
  learnRuns: (views) =>
    set((s) => {
      let runs: Set<string> | null = null;
      let runByChat: Record<string, string> | null = null;
      for (const v of views) {
        const chat = v.session.chat_id;
        if (typeof chat !== 'string' || chat === '' || v.units.length === 0) continue;
        if (!v.units.every((u) => typeof u.description === 'string' && /^answer-\d+ — /.test(u.description))) continue;
        if (!s.runs.has(v.session.id)) { runs ??= new Set(s.runs); runs.add(v.session.id); }
        if (s.runByChat[chat] !== v.session.id) { runByChat ??= { ...s.runByChat }; runByChat[chat] = v.session.id; }
      }
      if (runs === null && runByChat === null) return s;
      return { ...(runs !== null ? { runs } : {}), ...(runByChat !== null ? { runByChat } : {}) };
    }),
  setCreatorAccepted: (runId, accepted) =>
    set((s) => (s.creatorAccepted[runId] === accepted ? s : { creatorAccepted: { ...s.creatorAccepted, [runId]: accepted } })),
  recordTurnGate: (runId, ord) => set((s) => ({ turnGates: { ...s.turnGates, [runId]: { ord, at: Date.now() } } })),
  clearTurnGate: (runId) =>
    set((s) => {
      if (!(runId in s.turnGates)) return s;
      const turnGates = { ...s.turnGates }; delete turnGates[runId];
      return { turnGates };
    }),
  sent: (chatId, turn) =>
    set((s) => {
      const cur = s.turns[chatId] ?? [];
      if (cur.some((t) => t.who === 'you' && t.turnId === turn.turnId)) return s;
      const next: AskTurn = {
        turnId: turn.turnId, who: 'you', text: turn.text, pending: false, ok: true, at: turn.at ?? Date.now(),
        ...(turn.runId !== undefined ? { runId: turn.runId } : {}),
        ...(turn.stepId !== undefined ? { stepId: turn.stepId } : {}),
      };
      return {
        turns: { ...s.turns, [chatId]: [...cur, next] },
        ...(turn.runId !== undefined ? { runByChat: { ...s.runByChat, [chatId]: turn.runId }, runs: withRun(s.runs, turn.runId) } : {}),
      };
    }),
  linkRun: (chatId, runId) =>
    set((s) => (s.runByChat[chatId] === runId && s.runs.has(runId) ? s : { runByChat: { ...s.runByChat, [chatId]: runId }, runs: withRun(s.runs, runId) })),
  ingest: (event) =>
    set((s) => {
      const f = event as unknown as { type: string; chat?: unknown; cliKey?: unknown; text?: unknown; ok?: unknown; turn_id?: unknown; run_id?: unknown; ord?: unknown; session?: unknown; event?: unknown };
      // A team row of an ask run: `plan.accepted` with a creator step ends the turn-gate regime (#1).
      if (f.type === 'teamEvent') {
        const ev = f.event as { event_type?: unknown; payload?: { run_id?: unknown; steps?: unknown } } | undefined;
        const runId = ev?.payload?.run_id;
        if (ev?.event_type !== 'wicked.team.plan.accepted' || typeof runId !== 'string' || !s.runs.has(runId)) return s;
        const steps = Array.isArray(ev.payload?.steps) ? (ev.payload.steps as Array<{ catalog?: unknown }>) : [];
        const creator = steps.some((st) => st.catalog === 'build' || st.catalog === 'produce');
        if (!creator || s.creatorAccepted[runId] === true) return s;
        const turnGates = { ...s.turnGates }; delete turnGates[runId];
        return { creatorAccepted: { ...s.creatorAccepted, [runId]: true }, turnGates };
      }
      // The run moved past its pause: a recorded turn gate is spent.
      if ((f.type === 'resumed' || f.type === 'sessionCompleted' || f.type === 'runCancelled' || f.type === 'sessionFailed') && typeof f.session === 'string' && f.session in s.turnGates) {
        const turnGates = { ...s.turnGates }; delete turnGates[f.session];
        return { turnGates };
      }
      if (typeof f.chat !== 'string' || f.chat === '') return s;
      // A verdict or a decision landed after the reply: the transcript holds it — re-read (#6).
      if (f.type === 'chatCitations' || f.type === 'chatDecisions') {
        return { replySeq: { ...s.replySeq, [f.chat]: (s.replySeq[f.chat] ?? 0) + 1 } };
      }
      if (f.type === 'chatClosed') {
        if (!(f.chat in s.turns) && !(f.chat in s.runByChat)) return s;
        const turns = { ...s.turns }; delete turns[f.chat];
        const runByChat = { ...s.runByChat }; delete runByChat[f.chat];
        return { turns, runByChat };
      }
      if (f.type !== 'chatDelta' && f.type !== 'chatReply') return s;
      if (typeof f.cliKey !== 'string' || f.cliKey === '') return s;
      const cur = s.turns[f.chat] ?? [];
      // The frame's turn; else (a daemon predating the turn index, #5) the seat's own PENDING turn,
      // else the newest operator turn, else a stable per-seat key — one bubble per reply, never one
      // per frame.
      const pendingOfSeat = [...cur].reverse().find((t) => t.who === f.cliKey && t.pending);
      const turnId = typeof f.turn_id === 'string' && f.turn_id !== ''
        ? f.turn_id
        : pendingOfSeat?.turnId ?? [...cur].reverse().find((t) => t.who === 'you')?.turnId ?? `live:${f.cliKey}:${cur.filter((t) => t.who === f.cliKey && !t.pending).length}`;
      const i = cur.findIndex((t) => t.who === f.cliKey && t.turnId === turnId);
      const text = typeof f.text === 'string' ? f.text : '';
      const pa = s.paByChat[f.chat] === f.cliKey ? {} : { paByChat: { ...s.paByChat, [f.chat]: f.cliKey } };
      if (f.type === 'chatDelta') {
        if (i === -1) return { ...pa, turns: { ...s.turns, [f.chat]: [...cur, { turnId, who: f.cliKey, text, pending: true, ok: true, at: Date.now() }] } };
        const prev = cur[i]!;
        if (!prev.pending) return pa; // a late delta after the reply: the canonical text stands
        const next = [...cur]; next[i] = { ...prev, text: prev.text + text };
        return { ...pa, turns: { ...s.turns, [f.chat]: next } };
      }
      const finished: AskTurn = {
        turnId, who: f.cliKey, text, pending: false, ok: f.ok !== false, at: i === -1 ? Date.now() : cur[i]!.at,
        ...(typeof f.run_id === 'string' ? { runId: f.run_id } : {}),
        ...(typeof f.ord === 'number' ? { ord: f.ord } : {}),
      };
      const next = [...cur];
      if (i === -1) next.push(finished); else next[i] = finished;
      return {
        ...pa,
        turns: { ...s.turns, [f.chat]: next },
        replySeq: { ...s.replySeq, [f.chat]: (s.replySeq[f.chat] ?? 0) + 1 },
        ...(typeof f.run_id === 'string' && f.run_id !== '' ? { runByChat: { ...s.runByChat, [f.chat]: f.run_id }, runs: withRun(s.runs, f.run_id) } : {}),
      };
    }),
  drop: (chatId) =>
    set((s) => {
      if (!(chatId in s.turns) && !(chatId in s.runByChat)) return s;
      const turns = { ...s.turns }; delete turns[chatId];
      const runByChat = { ...s.runByChat }; delete runByChat[chatId];
      return { turns, runByChat };
    }),
}));
