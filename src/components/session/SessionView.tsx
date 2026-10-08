import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { ChatPathView, SessionView as RunView } from '../../api/types.js';
import { needsByRun } from '../../board/deskModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import { endedAtMs, finishedAtMs } from '../../board/needsYou.js';
import type { WatchCoverage } from '../../api/watch-wire.js';
import { coverageSummary } from '../../store/watch.js';
import {
  CLOSED_LINE, conversationOf, ORPHANED_LINE, orphanedOf, parseSessionId, runChatIdOf, sessionPath, sessionState, sessionTitle, sinceYouLeft,
  type Conversation, type SessionState,
} from '../../board/sessionModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { readSessionVisit, useSessionDrafts, writeSessionVisit } from '../../store/sessionDrafts.js';
import { humanTitle } from '../runIdentity.js';
import type { ChatCitations } from '../../api/chat-wire.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../../board/gateActions.js';
import { finishedDeliveryArm, proposalKindOf, statusSentence } from '../../board/proposalCard.js';
import { useGateStore } from '../../store/gates.js';
import { useRunEventStore } from '../../store/events.js';
import { ChainLine, useRunChain } from './ChainLine.js';
import { ProposalCard } from './ProposalCard.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { StrandedCard } from './StrandedCard.js';
import { RunRecordLines } from './RunRecord.js';
import { parseJump } from '../../store/watch.js';
import { GateRow } from './GateRow.js';
import { SourceChips } from './SourceChips.js';
import { SinceYouLeft } from './SinceYouLeft.js';
import { Composer, type ComposerSend } from './Composer.js';
import { quoteLabel } from '../../board/aboutChips.js';
import { addAboutChip } from '../../store/composerChips.js';
import { usePlanDrafts } from '../../store/planDrafts.js';
import { wordOf } from '../../board/planDraft.js';
import { undoDecision } from '../../board/undoQueue.js';
import { openSheet } from '../../store/sheets.js';
import type { DecisionView } from '../../api/decisions.js';
import { turnKey, useDecisionsStore } from '../../store/decisions.js';
import { DecisionLine } from '../decisions/DecisionLine.js';
import { TurnConsidered } from '../decisions/ConsideredLine.js';
import { collapseArtifacts, paneOpen, useArtifactSizes } from '../../store/artifactSizes.js';
import { RunArtifacts } from './RunArtifacts.js';
import { OperatorMessage } from '../OperatorMessage.js';
import { applyCheckState } from '../../board/checkState.js';
import { useRunAcceptance } from '../../hooks/useRunAcceptance.js';
import { momentOfRecording, useRecordingsStore } from '../../store/recordings.js';
import { requestWalkthroughSeek } from '../../store/walkthroughSeek.js';
import { askAnswerOrds, askLines, askPathOf, askProposal, askShapeFooter, askThinking, isAskTurnGate, type AskLine, type AskProposal } from '../../board/askThread.js';
import { useAskThreadStore } from '../../store/askThread.js';
import { useTeamFold } from '../../hooks/useTeamFold.js';
import { AskLineView, AskTyping } from './AskThread.js';

/**
 * A SESSION (`/s/:id`, DES-STUDIO-REBUILD-001 §5.4, slice S6a): the goal sentence, the thread (the
 * chat's turns and the runs launched from it, in time order), each run's chain line, and the
 * session's composer.
 *
 *  - The runs are `GET /runs` filtered by `chat_id` (C1). Without `capabilities.runChatId` the only
 *    sessions are single runs (`run:<id>`), so a chat id finds none and says so.
 *  - A chat the daemon reclaimed renders its runs under one honest line (§5.3), never an empty
 *    thread that looks like nothing happened.
 *  - R4: the draft and the thread's scroll survive switching sessions and coming back.
 *  - R2: opened after 4 h away, the since-you-left card overlays the top of the thread; it
 *    collapses to one line and never pushes the thread down.
 *  - The composer (S7) hands the message to the Ask dock (as the Desk's does), led by its
 *    about-chips; its `/` adds a step to the newest live run as a plan draft, and a selection in
 *    the thread becomes an "about: “…”" chip.
 *  - ASK-S1 (DES-ASK-TEAM-CHAT-001 §4.8): under `capabilities.askPath` an ask is a team PATH — the
 *    chat's run. The thread folds THREE sources into one list in time order: the transcript (and the
 *    live turns this client deposited or streamed before the transcript has them), the path's
 *    `wicked.team.*` rows as quiet lines (who answers and why; the reviewer; a finding on the
 *    answer; help asked and whether it came; a re-pick; a timeout; the end) and the other runs'
 *    blocks. Only the PA's reply is a bubble; the ask run's own block (chain line, proposal card)
 *    stays hidden while its plan has no creator step — the thread IS the chain — and appears once
 *    one is accepted, or when the run opened a gate the composer cannot answer (a hand-over, an
 *    escalation), or stopped. Without the capability the thread renders as before and says so.
 */

interface ChatDetail {
  scope?: unknown;
  /** (api-types 0.92.0) The chat's ask path once its first message launched it. */
  path?: ChatPathView;
  messages?: Array<{
    at?: number; kind: string; text?: string; cliKey?: string; ok?: boolean; turnId?: string;
    /** A `citations` record (crew#561, api-types 0.68.0): the verdicts of the earlier reply with the same turn + seat;
     *  a `decisions` record (DC-S4b, api-types 0.84.0): what crew recorded from the turn's operator message. */
    verified?: number; unverifiable?: number; corrected?: number; unchecked?: number; items?: ChatCitations['items'] | DecisionView[];
  }>;
}

type ThreadEntry =
  | { kind: 'turn'; key: string; at: number; who: 'you' | string; text: string; ok: boolean; citations?: ChatCitations; turnId: string | null; pending?: boolean }
  | { kind: 'run'; key: string; at: number; view: RunView }
  | { kind: 'line'; key: string; at: number; line: AskLine }
  | { kind: 'typing'; key: string; at: number; who: string }
  | { kind: 'proposal'; key: string; at: number; view: RunView; ask: AskProposal };

/** How long a just-decided proposal keeps the run's block away while the daemon's status catches up. */
const JUST_DECIDED_MS = 15_000;
/** How long an open proposal with NO cached gate keeps the block away (the reconcile reads the gate back). */
const OPEN_GRACE_MS = 60_000;

const STATE_WORD: Record<SessionState, string> = {
  waiting: 'Waiting on you', working: 'Being worked on', blocked: 'Stopped', done: 'Finished', quiet: 'Quiet',
};

function launchedMs(v: RunView): number {
  const c = (v.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0;
}

export function SessionPage({ sessionId, runs, runsLoaded, needRows, navigate, onAsk }: {
  sessionId: string;
  runs: RunView[];
  runsLoaded: boolean;
  needRows: NeedRow[];
  navigate: Navigate;
  onAsk: (text: string, opts: ComposerSend) => void;
}): React.ReactElement {
  const ref = useMemo(() => parseSessionId(sessionId), [sessionId]);
  const runChatId = useCapabilities((s) => s.runChatId);
  // With C1, a run launched from a chat belongs to that chat's session: a `run:<id>` address for
  // it (followed while `/health` was still loading) is replaced by the chat's (Copilot).
  useEffect(() => {
    if (ref.kind !== 'run' || !runChatId) return;
    const v = runs.find((r) => r.session.id === ref.runId);
    const chat = v === undefined ? null : runChatIdOf(v);
    if (chat !== null) navigate(sessionPath(chat), { replace: true });
  }, [ref, runChatId, runs, navigate]);
  const mine = useMemo(() => {
    const list = ref.kind === 'run'
      ? runs.filter((v) => v.session.id === ref.runId)
      : runChatId ? runs.filter((v) => runChatIdOf(v) === ref.chatId) : [];
    return [...list].sort((a, b) => launchedMs(a) - launchedMs(b));
  }, [ref, runs, runChatId]);

  // The chat's transcript (and whether the daemon still holds it). Crew answers an unknown or
  // reclaimed chat with 200 `scope: null, messages: []`, so only that answer means "closed"; a
  // failed read says it failed (with a retry) and claims nothing about the conversation.
  const [chat, setChat] = useState<
    { id: string; detail: ChatDetail } | { id: string; error: string } | null
  >(null);
  const [chatTry, setChatTry] = useState(0);
  useEffect(() => {
    if (ref.kind !== 'chat') return;
    let cancelled = false;
    api.getChat(ref.chatId)
      .then((d) => { if (!cancelled) setChat({ id: ref.chatId, detail: d as unknown as ChatDetail }); })
      .catch((e: unknown) => {
        if (!cancelled) setChat({ id: ref.chatId, error: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [ref, chatTry]);
  const mineChat = ref.kind === 'chat' && chat?.id === ref.chatId ? chat : null;
  const chatDetail = mineChat !== null && 'detail' in mineChat ? mineChat.detail : null;
  const chatError = mineChat !== null && 'error' in mineChat ? mineChat.error : null;
  const chatLoaded = ref.kind !== 'chat' || mineChat !== null;
  const conversation: Conversation | 'pending' | 'unreadable' = ref.kind === 'run' ? 'none'
    : chatError !== null ? 'unreadable'
      : chatDetail === null ? 'pending' : conversationOf(ref, chatDetail);
  const messages = useMemo(() => chatDetail?.messages ?? [], [chatDetail]);
  const title = sessionTitle(messages, mine);

  // ── ASK-S1: the ask path behind this chat ──────────────────────────────────────────────────
  const askPathOn = useCapabilities((s) => s.askPath);
  const chatId = ref.kind === 'chat' ? ref.chatId : null;
  const liveTurns = useAskThreadStore((s) => (chatId === null ? undefined : s.turns[chatId]));
  const replySeq = useAskThreadStore((s) => (chatId === null ? 0 : s.replySeq[chatId] ?? 0));
  const linkedRun = useAskThreadStore((s) => (chatId === null ? undefined : s.runByChat[chatId]));
  const askRunsKnown = useAskThreadStore((s) => s.runs);
  const creatorAcceptedKnown = useAskThreadStore((s) => s.creatorAccepted);
  const answerOrdsKnown = useAskThreadStore((s) => s.answerOrds);
  const askKnow = useMemo(() => ({ runs: askRunsKnown, creatorAccepted: creatorAcceptedKnown, answerOrds: answerOrdsKnown }), [askRunsKnown, creatorAcceptedKnown, answerOrdsKnown]);
  const turnGates = useAskThreadStore((s) => s.turnGates);
  // A finished reply re-reads the transcript: its `seat`, `citations` and `decisions` records and
  // the path's reviewer / helpers land there; the live turn then yields to the record.
  const seenReply = useRef(replySeq);
  useEffect(() => {
    if (replySeq === seenReply.current) return;
    seenReply.current = replySeq;
    setChatTry((n) => n + 1);
  }, [replySeq]);
  // Under the capability only: an older daemon's chat is a plain transcript, whatever it carries (F13; r3).
  const askRunId = askPathOn ? chatDetail?.path?.runId ?? linkedRun ?? null : null;
  useEffect(() => {
    if (askPathOn && chatId !== null && chatDetail?.path?.runId !== undefined) useAskThreadStore.getState().linkRun(chatId, chatDetail.path.runId);
  }, [askPathOn, chatId, chatDetail?.path?.runId]);
  const askView = askRunId === null ? null : mine.find((v) => v.session.id === askRunId) ?? null;
  const { fold: askFold, error: askTeamError, retry: askTeamRetry } = useTeamFold(askRunId, askView === null ? '' : `${askView.session.status}:${askView.session.unit_ix}`);
  const askRows = useMemo(() => askFold?.rows ?? [], [askFold]);
  const askPath = useMemo(() => askPathOf(askRows), [askRows]);
  // The hydrate's knowledge reaches the gate filter too (a late join learns the creator step here) —
  // positive knowledge only: an empty fold on a remount never resets it (codex r2 #1).
  useEffect(() => {
    if (askRunId !== null && askPath.creatorAccepted) useAskThreadStore.getState().markCreatorAccepted(askRunId);
  }, [askRunId, askPath.creatorAccepted]);
  // The fold's `step.claimed{answer-N}` rows name the answer units — the ords a turn gate may sit at —
  // for a late join whose plan mixes research or build steps between the answers (codex r4 #2).
  useEffect(() => {
    if (askRunId === null) return;
    const ords = askAnswerOrds(askRows);
    if (ords.length === 0) return;
    useAskThreadStore.getState().learnAnswerOrds(askRunId, ords);
    useGateStore.getState().reclassifyAskGates();
  }, [askRunId, askRows]);
  // What the thread and the fold know between them: the stored fact survives an empty fold (r3 #3).
  const creatorAccepted = askPath.creatorAccepted || (askRunId !== null && creatorAcceptedKnown[askRunId] === true);
  const lines = useMemo(() => {
    const out = askLines(askRows);
    // §8 F7: the path ran un-teamed (no team transport) — said in the thread, since the chain line that
    // carries the banner is hidden here; a failed team read is said with a retry (codex on ASK-S1 #7).
    const snap = askFold?.snapshot ?? null;
    if (snap !== null && snap.teamed && snap.transport === 'none') {
      out.unshift({ key: 'transport', at: 0, kind: 'transport', text: `Un-teamed: the team transport was unavailable${snap.reason !== null ? ` — ${snap.reason}` : ''}. The answer still comes; no reviewer or helpers this time.`, detail: [], tone: 'problem', ord: null });
    }
    if (askTeamError !== null) {
      out.unshift({ key: 'team-error', at: 0, kind: 'transport', text: `Could not read the team's rows (${askTeamError}); showing the conversation without them.`, detail: [], tone: 'problem', ord: null, action: 'retry' });
    }
    return out;
  }, [askRows, askFold, askTeamError]);
  const thinking = useMemo(() => askThinking(askRows), [askRows]);
  // S2 (§4.7): the PA's pending proposal to build — its card sits in the thread, not in a run block.
  const proposal = useMemo(() => askProposal(askRows), [askRows]);
  const askGate = useGateStore((s) => (askRunId === null ? undefined : s.gates[askRunId]));
  // Rule 3: the ask run's block stays hidden while the thread is its chain. It comes back when a
  // creator step is accepted, when the run stopped, or when a gate the composer cannot answer is open
  // (a hand-over, an escalation). An UNKNOWN gate on a waiting run is shown, not hidden: only a turn
  // gate the gate store positively recorded keeps the block away (codex #2). The plan approval of a
  // pending BUILD proposal is the proposal card's (S2, §4.7) — drawn in the thread, so the block stays
  // hidden while that gate is open.
  // The cached gate, when it is THIS card's plan gate: a deliver, escalation or any other gate on the
  // run takes precedence — the block (and its controls) shows (codex on ASK-S2 #2).
  // …and THIS proposal's plan gate, not another revision's: when the prompt names a rev it must be the
  // proposal's (a stale card never answers a newer question with its own words — codex on ASK-S2 r3 #1).
  const promptRev = askGate === undefined ? null : (/^\s*Approve plan rev (\d+)\b/i.exec(askGate.prompt)?.[1] ?? null);
  const askGateIsPlan = askGate !== undefined && (askGate.gateKind === 'plan_approval' || promptRev !== null)
    && (promptRev === null || proposal === null || proposal.planRev === null || Number(promptRev) === proposal.planRev);
  // With no cached gate at all, the rows' open proposal keeps the block away only for a while: a gate
  // the daemon still holds is read back by the runs reconcile; past the grace the run's own block shows.
  const openAgo = proposal === null ? null : Date.now() - proposal.at;
  const proposalOpen = proposal !== null && proposal.gateOpen && (askGate !== undefined ? askGateIsPlan : openAgo !== null && openAgo < OPEN_GRACE_MS);
  // The proposal's gate was just answered (its `gate.decided` row is in) and the daemon's run status has
  // not caught up: for a few seconds the card says what was answered and the block waits for the run to
  // move. Bounded: past that an unknown waiting gate is shown, not hidden (the runs reconcile reads it).
  const [, tickDecided] = useReducer((n: number) => n + 1, 0);
  const decidedAgo = proposal?.decidedAt === null || proposal?.decidedAt === undefined ? null : Date.now() - proposal.decidedAt;
  const proposalJustDecided = proposal !== null && !proposal.gateOpen && proposal.decision !== null && askGate === undefined
    && askView?.session.status === 'awaiting_human' && decidedAgo !== null && decidedAgo < JUST_DECIDED_MS;
  useEffect(() => {
    const waits: number[] = [];
    if (proposalJustDecided && decidedAgo !== null) waits.push(JUST_DECIDED_MS - decidedAgo + 20);
    if (proposalOpen && askGate === undefined && openAgo !== null) waits.push(OPEN_GRACE_MS - openAgo + 20);
    if (waits.length === 0) return;
    const id = setTimeout(tickDecided, Math.max(0, Math.min(...waits)));
    return () => clearTimeout(id);
  }, [proposalJustDecided, decidedAgo, proposalOpen, askGate, openAgo]);
  const askBlockHidden = askRunId !== null && !creatorAccepted && askView?.session.status !== 'failed'
    && (proposalOpen || proposalJustDecided || (askGate !== undefined
      ? isAskTurnGate(askKnow, askRunId, askGate.gateKind, askGate.prompt, askGate.ord)
      : askView?.session.status !== 'awaiting_human' || askRunId in turnGates));

  const badges = useMemo(() => needsByRun(needRows), [needRows]);
  const badge = mine.reduce((n, v) => n + (badges[v.session.id] ?? 0), 0);
  const state: SessionState = mine.some((v) => v.session.status === 'awaiting_human') ? 'waiting'
    : mine.some((v) => sessionState(v.session.status) === 'working') ? 'working'
      : mine.length > 0 ? sessionState(mine[mine.length - 1]!.session.status) : 'quiet';

  // R2: the last visit, read once per session before this visit is stamped.
  // (A memo runs during render, before the effect below stamps this visit; switching away stamps
  // it again, so coming back minutes later shows no card.)
  const lastSeen = useMemo(() => readSessionVisit(sessionId), [sessionId]);
  useEffect(() => {
    writeSessionVisit(sessionId, Date.now());
    return () => writeSessionVisit(sessionId, Date.now());
  }, [sessionId]);
  const since = useMemo(() => sinceYouLeft(lastSeen, Date.now(), mine, badges), [lastSeen, mine, badges]);

  const entries = useMemo<ThreadEntry[]>(() => {
    const out: ThreadEntry[] = [];
    const seatAt = new Map<string, number>(); // `${turnId}:${cliKey}` → the reply's index in `out`
    messages.forEach((m, i) => {
      if (m.kind === 'citations') {
        // S6b: the verdicts land after their reply (append-only); fold them onto it. A record with
        // no reply to fold onto is dropped, never rendered alone.
        const at = seatAt.get(`${m.turnId ?? ''}:${m.cliKey ?? ''}`);
        const e = at === undefined ? undefined : out[at];
        if (e !== undefined && e.kind === 'turn') {
          e.citations = {
            verified: m.verified ?? 0, unverifiable: m.unverifiable ?? 0, corrected: m.corrected ?? 0,
            unchecked: m.unchecked ?? 0, items: (m.items ?? []) as ChatCitations['items'],
          };
        }
        return;
      }
      // DC-S6: a `decisions` record is folded onto its turn through the decisions store (below), so
      // the line under the operator's message is the same whether it came from a reload or live.
      if (m.kind === 'decisions') return;
      if ((m.kind !== 'user' && m.kind !== 'seat') || typeof m.text !== 'string') return;
      if (m.kind === 'seat') seatAt.set(`${m.turnId ?? ''}:${m.cliKey ?? ''}`, out.length);
      out.push({
        kind: 'turn', key: `m${i}`, at: typeof m.at === 'number' ? m.at : 0,
        who: m.kind === 'user' ? 'you' : (m.cliKey ?? 'helper'), text: m.text, ok: m.ok !== false,
        turnId: typeof m.turnId === 'string' ? m.turnId : null,
      });
    });
    // ASK-S1: the turns this client knows before the transcript does — the question just sent, the
    // reply streaming in. A turn the transcript now carries is the record's, once. Without the
    // capability the thread is the transcript alone (an older daemon's frames carry no turn ids to
    // reconcile by — §8 F13; codex on ASK-S1 #5).
    const have = new Set(out.filter((e): e is Extract<ThreadEntry, { kind: 'turn' }> => e.kind === 'turn' && e.turnId !== null).map((e) => `${e.turnId}:${e.who === 'you' ? 'you' : e.who}`));
    const liveOrd = new Map<string, number>(); // a live reply's entry key → its unit ord (from the relay's frame)
    for (const t of askPathOn ? liveTurns ?? [] : []) {
      if (have.has(`${t.turnId}:${t.who}`)) continue;
      const key = `live:${t.turnId}:${t.who}`;
      if (t.ord !== undefined) liveOrd.set(key, t.ord);
      out.push({ kind: 'turn', key, at: t.at, who: t.who, text: t.text, ok: t.ok, turnId: t.turnId, ...(t.pending ? { pending: true } : {}) });
    }
    // A line marked `under` (a finding on the answer, a help exchange) goes right after the reply bubble
    // of ITS answer step — matched by unit, not by time (codex on ASK-S1 #4): a live reply carries the
    // relay's `ord`; the transcript's k-th PA reply is the k-th answer step's (`step.claimed` order).
    const answerOrds = askAnswerOrds(askRows);
    const replyAtByOrd = new Map<number, number>();
    const settled = out.filter((e): e is Extract<ThreadEntry, { kind: 'turn' }> => e.kind === 'turn' && e.who !== 'you' && e.pending !== true).sort((a, b) => a.at - b.at);
    let k = 0;
    for (const e of settled) {
      const ord = liveOrd.get(e.key) ?? answerOrds[k];
      k += 1;
      if (ord !== undefined && !replyAtByOrd.has(ord)) replyAtByOrd.set(ord, e.at);
    }
    lines.forEach((line, i) => {
      let at = line.at;
      if (line.under === true && line.ord !== null) {
        // Wherever the row landed in time (a slow final pass publishes a finding after later turns),
        // the line sits under ITS reply.
        const reply = replyAtByOrd.get(line.ord);
        if (reply !== undefined) at = reply + 0.5 + i * 1e-4;
      }
      out.push({ kind: 'line', key: line.key, at, line });
    });
    const streaming = (liveTurns ?? []).some((t) => t.who !== 'you' && t.pending);
    if (!streaming) {
      for (const th of thinking) {
        if ((liveTurns ?? []).some((t) => t.who !== 'you' && t.ord === th.ord)) continue;
        out.push({ kind: 'typing', key: `typing:${th.ord}`, at: th.at, who: th.by });
      }
    }
    for (const v of mine) {
      if (askBlockHidden && v.session.id === askRunId) {
        if (proposal !== null) out.push({ kind: 'proposal', key: `p:${proposal.proposalId}`, at: proposal.at, view: v, ask: proposal });
        continue;
      }
      out.push({ kind: 'run', key: `r:${v.session.id}`, at: launchedMs(v), view: v });
    }
    return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);
  }, [messages, mine, liveTurns, lines, thinking, askBlockHidden, askRunId, askRows, askPathOn, proposal]);

  // DC-S8: the considered line sits under the LAST reply of each turn (one Consideration per turn,
  // whatever the number of seats); it is re-read when the turn gains a reply.
  const replies = useMemo(() => {
    const last = new Map<string, string>();
    const count = new Map<string, number>();
    for (const e of entries) {
      if (e.kind !== 'turn' || e.who === 'you' || e.turnId === null) continue;
      last.set(e.turnId, e.key);
      count.set(e.turnId, (count.get(e.turnId) ?? 0) + 1);
    }
    return { last, count };
  }, [entries]);

  // DC-S6: the transcript's `decisions` records (one per operator turn crew read) feed the store,
  // so a reload restores every decision line; live `chatDecisions` frames land in the same place.
  useEffect(() => {
    if (ref.kind !== 'chat') return;
    let any = false;
    for (const m of messages) {
      if (m.kind === 'decisions' && typeof m.turnId === 'string' && Array.isArray(m.items)) {
        useDecisionsStore.getState().ingestTurn(ref.chatId, m.turnId, m.items as DecisionView[]);
        any = true;
      }
    }
    // The records hold the state at recording time; the ledger's current views win (remembered,
    // undone, dismissed since) — one read per chat.
    if (any) void useDecisionsStore.getState().syncChat(ref.chatId);
  }, [ref, messages]);

  // R4: scroll and draft per session.
  const scroller = useRef<HTMLDivElement | null>(null);
  const setScroll = useSessionDrafts((s) => s.setScroll);
  const draft = useSessionDrafts((s) => s.drafts[sessionId] ?? '');
  const setDraft = useSessionDrafts((s) => s.setDraft);
  // Not ready until `/health` answered too: before it, "no runs in this chat" could be false (Copilot).
  const capsLoaded = useCapabilities((s) => s.loaded);
  const ready = runsLoaded && chatLoaded && capsLoaded;
  // ASK-S1: a running conversation keeps its newest line in view. While the operator is at (or near)
  // the bottom, growth — their own turn, the typing line, a reply streaming in, a quiet line — scrolls
  // the thread to it; once they have scrolled up to read, nothing moves under them. R4: a returning
  // visitor's saved place is restored and RE-APPLIED while the thread is still filling (a thread
  // shorter than the saved place clamps it; the transcript and the team rows land after it is ready),
  // and a saved place means they were reading there — nothing follows until they scroll again. The
  // thread's own scrolls are told apart from the operator's, so a restore or a follow never saves
  // itself as their place or re-reads "near the bottom" off a half-filled thread (codex r2 #4, #5).
  const nearBottom = useRef(true);
  const newestKey = useRef<string | null>(null);
  const lastHeight = useRef(0);
  const programmatic = useRef(false);
  const restore = useRef<{ top: number; pending: boolean }>({ top: 0, pending: false });
  const scrollThread = (el: HTMLDivElement, top: number): void => {
    const before = el.scrollTop;
    el.scrollTop = top;
    if (el.scrollTop !== before) programmatic.current = true;
  };
  useLayoutEffect(() => {
    if (!ready) return;
    const el = scroller.current;
    const saved = useSessionDrafts.getState().scroll[sessionId];
    // A first visit starts at the top: the scroller is reused across sessions (Copilot). A SAVED place —
    // the top included — means they were reading there: nothing follows until they scroll again (r3 #5).
    const top = saved ?? 0;
    restore.current = { top, pending: top > 0 };
    if (el !== null) {
      scrollThread(el, top);
      nearBottom.current = saved === undefined && el.scrollHeight - el.clientHeight < 80;
      lastHeight.current = el.scrollHeight;
    }
  }, [sessionId, ready]);
  useLayoutEffect(() => {
    const el = scroller.current;
    const last = entries.length > 0 ? entries[entries.length - 1]!.key : null;
    const grew = last !== newestKey.current || (el !== null && el.scrollHeight !== lastHeight.current);
    newestKey.current = last;
    if (el !== null) lastHeight.current = el.scrollHeight;
    if (!ready || el === null) return;
    if (restore.current.pending) {
      // Their place, as far as the thread reaches so far; settled once the thread holds it.
      const max = el.scrollHeight - el.clientHeight;
      if (max >= restore.current.top) { scrollThread(el, restore.current.top); restore.current.pending = false; }
      else scrollThread(el, max);
      return;
    }
    if (grew && nearBottom.current) scrollThread(el, el.scrollHeight);
  }, [entries, ready]);

  // Where a source's passage can be read from: the session's runs with a worktree, newest first.
  const readers = useMemo(() => [...mine].reverse().map((v) => ({
    id: v.session.id, workdir: typeof v.session.workdir === 'string' ? v.session.workdir : null,
  })).filter((r) => r.workdir !== null), [mine]);
  const missing = ready && mine.length === 0 && (conversation === 'closed' || conversation === 'none');
  // S8: an artifact open as a pane sits beside the thread; the thread and composer make room.
  // Leaving the session (or switching to another) folds them back: a remembered pane from
  // another session must not narrow this one.
  const pane = useArtifactSizes(paneOpen);
  useEffect(() => () => collapseArtifacts(), [sessionId]);

  return (
    <div data-testid="session" data-object={`session:${sessionId}`} data-session-id={sessionId} data-conversation={conversation} data-state={state} data-pane={pane} className={`wk-session${pane ? ' wk-session--pane' : ''}`}>
      <header className="wk-session-head">
        <span aria-hidden className={`wk-desk-dot wk-desk-dot--${state}`} />
        <div className="wk-session-head-body">
          <h1 data-testid="session-title" className="wk-session-title">{title}</h1>
          <p data-testid="session-status" className="wk-session-status">
            {STATE_WORD[state]}
            {mine.length > 1 && ` · ${mine.length} runs`}
            {badge > 0 && <> · <mark className="wk-desk-mark">{badge === 1 ? '1 needs you' : `${badge} need you`}</mark></>}
          </p>
        </div>
        {/* S11: look underneath the session — goal, helpers, activity, sign-ins and the run's sections. */}
        <button type="button" data-testid="session-sheet-open" aria-label="Look underneath this session" title="Look underneath (⌘K for everything else)" onClick={() => openSheet({ kind: 'session', sessionId })} className="wk-sheet-open">⋯</button>
      </header>

      <div className="wk-session-body">
        {since !== null && ready && <SinceYouLeft key={sessionId} card={since} runs={mine} />}
        <div
          ref={scroller}
          data-testid="session-thread"
          className="wk-session-thread"
          onScroll={(e) => {
            const el = e.currentTarget;
            // The thread's own scroll (a restore, a follow) is not the operator's place.
            if (programmatic.current) { programmatic.current = false; return; }
            restore.current.pending = false;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            setScroll(sessionId, el.scrollTop);
          }}
          // DESIGN-interaction rule 2: selecting a sentence in the work makes it the subject of the
          // next message — an "about: “…”" chip on the composer (never a button row).
          onMouseUp={(e) => {
            const sel = window.getSelection();
            const node = sel?.anchorNode ?? null;
            if (sel === null || node === null || !e.currentTarget.contains(node)) return;
            const label = quoteLabel(sel.toString());
            if (label !== null) addAboutChip(sessionId, { kind: 'about', key: `q:${label}`, label });
          }}
        >
          {conversation === 'closed' && mine.length > 0 && (
            <p data-testid="session-closed-line" className="wk-session-grey">{CLOSED_LINE}</p>
          )}
          {chatError !== null && (
            <p data-testid="session-chat-error" className="wk-session-grey">
              Could not read this conversation from the daemon ({chatError}).{' '}
              <button type="button" data-testid="session-chat-retry" onClick={() => { setChat(null); setChatTry((n) => n + 1); }} className="wk-since-toggle">Try again</button>
            </p>
          )}
          {missing && (
            <p data-testid="session-missing" className="wk-session-grey">
              {ref.kind === 'chat' && !runChatId
                ? 'This daemon does not link runs to their chat, so this session has no runs to show.'
                : 'Nothing in this session is on this daemon.'}
            </p>
          )}
          {!ready && <p className="wk-session-grey">Loading…</p>}
          {/* §8 F13: an older daemon has no team path — every helper answers at once; said once, in grey. */}
          {ready && ref.kind === 'chat' && !askPathOn && conversation === 'live' && messages.length > 0 && (
            <p data-testid="session-ask-older" className="wk-session-grey">Older daemon: every helper answers at once — no primary helper, reviewer or help requests in this conversation.</p>
          )}
          {entries.map((e) => (e.kind === 'line'
            ? <AskLineView key={e.key} line={e.line} onSignIn={() => openSheet({ kind: 'session', sessionId }, 'signins')} onRetry={askTeamRetry} />
            : e.kind === 'typing'
              ? <AskTyping key={e.key} who={e.who} />
              : e.kind === 'proposal'
                ? <AskProposalBlock key={e.key} view={e.view} ask={e.ask} onBringBack={() => setDraft(sessionId, 'Go ahead with the plan you proposed.')} />
                : e.kind === 'turn'
            ? (
              <div key={e.key} data-testid="session-turn" data-who={e.who === 'you' ? 'you' : 'helper'} {...(e.pending ? { 'data-pending': 'true' } : {})} className={`wk-session-turn wk-session-turn--${e.who === 'you' ? 'you' : 'helper'}${e.pending ? ' wk-session-turn--pending' : ''}`}>
                <p className="wk-session-who">{e.who === 'you' ? 'You' : e.pending ? `${e.who} · answering` : e.who}</p>
                <p className={`wk-session-text${e.ok ? '' : ' wk-session-grey'}`}>{e.who === 'you' ? <OperatorMessage text={e.text} /> : e.text}</p>
                {e.who !== 'you' && <SourceChips citations={e.citations} runs={readers} />}
                {/* DC-S8: the rules the turn's seats were given — considered · set aside · cited (unchecked). */}
                {e.who !== 'you' && ref.kind === 'chat' && e.turnId !== null && replies.last.get(e.turnId) === e.key && (
                  <TurnConsidered chatId={ref.chatId} turnId={e.turnId} replies={replies.count.get(e.turnId) ?? 0} navigate={navigate} />
                )}
                {/* DC-S6: what crew made of the operator's words — remembered, offered, or nothing. */}
                {e.who === 'you' && ref.kind === 'chat' && e.turnId !== null && <TurnDecisions chatId={ref.chatId} turnId={e.turnId} navigate={navigate} />}
              </div>
            )
            : <RunBlock key={e.key} view={e.view} badge={badges[e.view.session.id] ?? 0} sessionId={sessionId} navigate={navigate} />))}
        </div>
      </div>
      {/* Rule 3: while the thread is the chain, the shape line names the path's steps for the operator. */}
      {askBlockHidden && askPath.shape.length > 0 && (
        <p data-testid="session-ask-shape" className="wk-session-grey wk-session-shape">{askShapeFooter(askPath)}</p>
      )}

      <Composer
        composerKey={sessionId}
        text={draft}
        setText={(t) => setDraft(sessionId, t)}
        onSend={onAsk}
        runs={mine}
        started={entries.length > 0}
        className="wk-session-composer"
        ariaLabel="Ask or tell studio what to do next"
        placeholder="Ask about this, or tell studio what to do next — / adds a step, @ names a project or a helper"
        variant="session"
      />
    </div>
  );
}

/** ASK-S2 (§4.7): the ask path's Continue in Build card, in the thread where the proposal landed —
 *  the run's own block stays hidden until the work is accepted (rule 3). */
function AskProposalBlock({ view, ask, onBringBack }: { view: RunView; ask: AskProposal; onBringBack: () => void }): React.ReactElement {
  const { chain } = useRunChain(view);
  return (
    <div data-testid="session-ask-proposal" data-run-id={view.session.id} data-proposal-id={ask.proposalId} data-first-creator={ask.firstCreator ? 'true' : 'false'} className="wk-session-ask-proposal">
      {/* A re-proposal is a new row: the card's own state (Not now, the confirm) starts over with it. */}
      <ProposalCard key={`${ask.proposalId}:${ask.at}`} view={view} chain={chain} ask={ask} onBringBack={onBringBack} />
    </div>
  );
}

/** DC-S6: the decisions crew recorded from one operator turn, live or from the transcript. */
function TurnDecisions({ chatId, turnId, navigate }: { chatId: string; turnId: string; navigate: Navigate }): React.ReactElement | null {
  const ids = useDecisionsStore((s) => s.byTurn[turnKey(chatId, turnId)]);
  const byId = useDecisionsStore((s) => s.byId);
  const decisions = useMemo(() => (ids ?? []).map((id) => byId[id]).filter((d): d is DecisionView => d !== undefined), [ids, byId]);
  if (decisions.length === 0) return null;
  return <DecisionLine decisions={decisions} navigate={navigate} />;
}

export function RunBlock({ view, badge, sessionId, navigate }: {
  view: RunView;
  badge: number;
  sessionId: string;
  /** S16a-1c: the record lines' links (the stop story's "All runs ›", rule links). */
  navigate?: Navigate;
}): React.ReactElement {
  const { chain: planChain, teamError, retry } = useRunChain(view);
  const id = view.session.id;
  const state = sessionState(view.session.status);
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(view.session.status);
  const endedMs = isTerminal ? (endedAtMs(view) ?? finishedAtMs(view)) : null;
  const [watchCoverage, setWatchCoverage] = useState<WatchCoverage[] | undefined>(undefined);
  const watchFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isTerminal || watchFetchedFor.current === id) return;
    watchFetchedFor.current = id;
    api.getWatch({ run: id, limit: 1 })
      .then((r) => { setWatchCoverage(r.coverage ?? []); })
      .catch(() => {
        // Any failure (404/501 absent registry, or other error) → leave watchCoverage undefined.
        // Only a successful read with no checked entry adds "· nothing checked".
      });
  }, [id, isTerminal]);
  const noEvidenceSummary = coverageSummary(
    watchCoverage,
    isTerminal,
    endedMs,
    (e) => e.replace(/[-_]+/g, ' '),
  );
  const gate = useGateStore((s) => s.gates[id]);
  const action = useGateActionStore((s) => s.byGate[id] ?? IDLE_GATE_ACTION);
  // WT-U2: "checked" comes only from the acceptance read (crew's per-step check state); the chips'
  // moments from the walkthrough the artifact below reads; the deliver card's line is crew's summary.
  const acceptance = useRunAcceptance(view, planChain, gate);
  const checks = acceptance?.walkthrough?.steps ?? null;
  const chain = useMemo(() => applyCheckState(planChain, checks), [planChain, checks]);
  const recording = useRecordingsStore((s) => s.byRun[id]);
  const momentOf = useMemo(() => momentOfRecording(recording), [recording]);
  const proposalKind = proposalKindOf(id, gate, view.units);
  // Rule 5: store-based receipt survives remount; no useRef.
  const effectiveKind = gate !== undefined ? proposalKind
    : action.receipt?.kind === 'plan' || action.receipt?.kind === 'deliver' ? action.receipt.kind : null;
  // S16a-1a (studio#583 / #587): a finished run opened fresh — no gate, no receipt here — still
  // answers its hand-over in the thread, off the daemon's delivery verdict: the receipt (PR link or
  // branch) for a hand-over, the "Deliver — open a PR" door for a stranded run.
  const finished = effectiveKind === null ? finishedDeliveryArm(view, gate) : null;
  // S16a-1c: the Watchtower's "Jump in" lands here with `?jump=ord:attempt:at` — read on arrival.
  const [jump] = useState(() => (typeof window === 'undefined' ? null : parseJump(window.location.search)));
  return (
    <section data-testid="session-run" data-run-id={id} data-state={state} {...(acceptance !== null ? { 'data-acceptance': 'read' } : {})} className="wk-session-run">
      <p className="wk-session-run-head">
        <span aria-hidden className={`wk-desk-dot wk-desk-dot--${state}`} />
        <span className="wk-session-run-title">{humanTitle(view.session.problem || id)}</span>
        <span className="wk-session-run-state">{badge > 0 ? 'Needs you' : STATE_WORD[state]}</span>
        {/* S15d (Amendment 5 item 1): the run stays in the thread — its depth (every step and what it did,
            the changes, the evidence) is the look-underneath sheet of THIS run (its own `run:` session,
            not the chat's: a chat's sheet would show its newest run), never a page of its own. */}
        <button type="button" data-testid="session-run-look" aria-label="Look underneath this run: its steps, changes and evidence" title="Steps, changes, evidence" onClick={() => openSheet({ kind: 'session', sessionId: `run:${id}` }, 'steps')} className="wk-sheet-open wk-sheet-open--run">⋯</button>
      </p>
      {/* S6b: the run's ONE status sentence, then its proposal (the plan, the hand-over). */}
      <p data-testid="session-status-sentence" role="status" className="wk-session-status-sentence">{statusSentence(view, chain, gate, action)}</p>
      <OrphanedRow view={view} />
      {/* S16a-1c: the run's record lines — why it stopped, the amended acceptance list, a short
          council, the Watchtower's lines (and "You jumped in" when the address carries ?jump=). */}
      <RunRecordLines view={view} jumped={jump !== null} {...(navigate === undefined ? {} : { navigate })} />
      {/* S15e: plan and deliver go through ProposalCard; every other gate kind is answered in the thread. */}
      {effectiveKind === 'plan' || effectiveKind === 'deliver'
        ? <ProposalCard view={view} chain={chain} acceptance={acceptance?.summary ?? null} />
        : finished === 'handed'
          ? <ProposalCard view={view} chain={chain} acceptance={acceptance?.summary ?? null} handedOver />
          : finished === 'stranded'
            ? <StrandedCard view={view} />
            : <GateRow view={view} gate={gate} />}
      <PlanStepLines runId={id} />
      <ChainLine chain={chain} runId={id} units={view.units} teamError={teamError} onRetry={retry} checks={checks} momentOf={momentOf} onOpenAt={(sec) => requestWalkthroughSeek(id, sec)} nothingChecked={noEvidenceSummary !== null} jumpOrd={jump?.ord ?? null} />
      {/* S8: the page the run is producing — a live preview that morphs inline → pane → full. */}
      <RunArtifacts view={view} composerKey={sessionId} chain={chain} />
      <RunHelpers view={view} />
    </section>
  );
}

/**
 * studio#545: a run the daemon restart orphaned says so — the engine's `runOrphaned` report is the
 * newest dispatch-or-orphan frame of its trail (`board/sessionModel.orphanedOf`) — and offers the one
 * move that fixes it: Resume (`POST /runs/:id/resume`). The trail is read once here when nothing else
 * on the page has (a late join); a failed read is no verdict, so a bare run never claims an orphan.
 */
function OrphanedRow({ view }: { view: RunView }): React.ReactElement | null {
  const id = view.session.id;
  const status = view.session.status;
  // studio#558: the session page's one run-event read (a failed read is no verdict: frames stay unread).
  const frames = useRunEvents(id, status === 'executing').events ?? undefined;
  const [sent, setSent] = useState<'idle' | 'sending' | 'asked' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSent('idle'); setError(null); }, [id]);
  const orphan = orphanedOf(status, frames);
  if (orphan === null) return null;
  const resume = (): void => {
    setSent('sending');
    api.resumeRun(id)
      .then(() => api.getRunEvents(id))
      .then(({ events }) => { useRunEventStore.getState().hydrate(id, events); setSent('asked'); })
      .catch((e: unknown) => { setSent('failed'); setError(e instanceof Error ? e.message : String(e)); });
  };
  return (
    <p data-testid="session-orphaned" role="status" {...(orphan.ord !== null ? { 'data-ord': String(orphan.ord) } : {})} className="wk-session-grey wk-session-orphaned">
      {ORPHANED_LINE}{' '}
      {sent === 'asked'
        ? <span data-testid="session-orphaned-asked">Resume asked — waiting for the step to start again.</span>
        : <button type="button" data-testid="session-orphaned-resume" disabled={sent === 'sending'} onClick={resume} className="wk-since-toggle">{sent === 'sending' ? 'Resuming…' : 'Resume'}</button>}
      {sent === 'failed' && <span data-testid="session-orphaned-error"> Resume failed: {error}</span>}
    </p>
  );
}

/**
 * S7: the steps a `/` command added mid-run, in the run's own block — "Adding Test · Undo" while the
 * 10 s window is open, then "Added Test" with no Undo (a running plan only grows).
 */
function PlanStepLines({ runId }: { runId: string }): React.ReactElement | null {
  const queued = usePlanDrafts((s) => s.queued[runId]);
  const added = usePlanDrafts((s) => s.added[runId]);
  if ((queued?.length ?? 0) === 0 && (added?.length ?? 0) === 0) return null;
  return (
    <div className="wk-session-steps">
      {(added ?? []).map((c, i) => (
        <p key={`a${i}`} data-testid="session-step-added" data-catalog={c} className="wk-session-grey">Added {wordOf(c)} — it stays: a running plan only grows.</p>
      ))}
      {(queued ?? []).map((q) => (
        <p key={`q${q.id}`} data-testid="session-step-queued" data-catalog={q.catalog} className="wk-session-grey">
          Adding {wordOf(q.catalog)} ·{' '}
          <button type="button" data-testid="session-step-undo" onClick={() => undoDecision(q.id)} className="wk-since-toggle">Undo</button>
        </p>
      ))}
    </div>
  );
}

/** S11: the helpers working on a run, each a way into its sheet (terminal, what it did, sign-in). */
function RunHelpers({ view }: { view: RunView }): React.ReactElement | null {
  const clis = [...new Set(view.units.map((u) => u.assigned_cli).filter((c): c is string => typeof c === 'string' && c !== ''))];
  if (clis.length === 0) return null;
  return (
    <p data-testid="session-run-helpers" className="wk-session-grey">
      Helpers:{' '}
      {clis.map((cli, i) => (
        <span key={cli}>
          {i > 0 && ' · '}
          <button
            type="button"
            data-testid="session-run-helper"
            data-cli={cli}
            data-object={`helper:${view.session.id}:${cli}`}
            onClick={() => openSheet({ kind: 'helper', runId: view.session.id, cli })}
            className="wk-since-toggle"
          >
            {cli}
          </button>
        </span>
      ))}
    </p>
  );
}
