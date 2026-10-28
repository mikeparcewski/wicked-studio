import { useSilentStep } from '../../hooks/useSilentStep.js';
import { silentWords } from '../../board/silentStep.js';
import { beginChatOpen, chatOpened, useChatFlow } from '../../store/chatFlow.js';
import { useProjectsStore } from '../../store/projects.js';
import { Fragment, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError, api } from '../../api/client.js';
import type { ChatPathView, SessionView as RunView } from '../../api/types.js';
import { needsByRun } from '../../board/deskModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import { CLOSED_LINE, MESSAGE_STEP_LABEL, composerScopeNote, conversationOf, parseSessionId, runChatIdOf, sessionPath, runState, sessionTitle, type Conversation, type SessionState } from '../../board/sessionModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useSessionDrafts } from '../../store/sessionDrafts.js';
import { isChatScopeProblem, plainRunTitle } from '../../board/deskWords.js';
import type { ChatCitations } from '../../api/chat-wire.js';
import { useGateStore } from '../../store/gates.js';
import { useRunChain } from './ChainLine.js';
import { ProposalCard } from './ProposalCard.js';
import { ArtifactAddressProvider, useArtifactMissing } from './ArtifactAddress.js';
import { chatPromotePrefill } from '../../board/chatPromote.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { ChatQuestions } from './ThreadQuestions.js';
import { SourceChips } from './SourceChips.js';
import { NeedsBanner } from './NeedsBanner.js';
import { arrival, atEnd, headerBadge, jumpLabel, newEntries, QUESTION_KINDS, readDetailsOpen, waitingItems, writeDetailsOpen, type WaitingItem } from '../../board/runHeader.js';
import { Composer, type ComposerSend, type ComposerSuggestion } from './Composer.js';
import { quoteLabel } from '../../board/aboutChips.js';
import { addAboutChip } from '../../store/composerChips.js';
import { claimSessionSheet, openSheet, stopRun, useSheets } from '../../store/sheets.js';
import { stepLabelOf } from '../../board/chainModel.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';

/** The working step in the chain's own word (`walkthrough_review#2` → its step word: a repeat's `#n` is the unit
 *  key's, never the step's name). */
function workingStepWord(key: string): string {
  return stepLabelOf(key.replace(/#\d+$/, ''));
}
import type { DecisionView } from '../../api/decisions.js';
import { turnKey, useDecisionsStore } from '../../store/decisions.js';
import { DecisionLine } from '../decisions/DecisionLine.js';
import { TurnConsidered } from '../decisions/ConsideredLine.js';
import { collapseArtifacts, paneOpen, useArtifactSizes } from '../../store/artifactSizes.js';
import { demoVideoProjectOf, useRunDocs } from './RunArtifacts.js';
import { DEMO_VIDEO_ID, openLaunchWizard } from '../../store/launchWizard.js';
import { OperatorMessage } from '../OperatorMessage.js';
import { Markdown } from '../Markdown.js';
import { CitationStrip, citationLabel, citationMarks } from '../citations.js';
import { askAnswerOrds, askCompletedAt, askLines, askPathOf, askProposal, askShapeFooter, askThinking, isAskTurnGate, type AskLine, type AskProposal } from '../../board/askThread.js';
import { useAskAnswers } from '../../hooks/useAskAnswers.js';
import { useAskThreadStore } from '../../store/askThread.js';
import { useTeamFold } from '../../hooks/useTeamFold.js';
import { AskLineView, AskTyping } from './AskThread.js';
import { Skeleton, StateBanner, TechDetails } from '../ui/index.js';
import { readErrorKind } from '../../api/errors.js';
import { splitToolFailures } from '../../board/askThread.js';
import { useRoster } from '../../hooks/useRoster.js';
import { isHeldRun } from '../../board/heldRuns.js';
import { executingOrd } from '../../api/run-state.js';
import { phaseLabel } from '../gateVerdictModel.js';
import { CREW, responderKey, turnResponder, type Responder } from '../../board/responder.js';
import { TurnWho } from './TurnWho.js';
import { RunRibbon, RunTab } from './RunTab.js';
import { useRunHostValue } from './RunHost.js';
import { HostPanel, useNarrow } from '../editorHost/HostPanel.js';
import { RUN_TAB, useHostPanel } from '../../editors/hostApi.js';
import { panelPlaceOf } from '../../board/runPanelModel.js';
import { useRunPanel } from '../../store/runPanel.js';
import { RunHostProvider } from '../editorHost/RunHostContext.js';
import { RunBlock } from './RunConversation.js';
import { DecisionDockFrame, type DockItem, type DockReply } from './DecisionDock.js';
import { switchWords, useReplyRoute } from '../../board/replyRoute.js';
import { useDraftRouter } from '../../hooks/useDraftRouter.js';
import { useElicitationStore } from '../../store/elicitations.js';
import { useSystemStore } from '../../store/systemSnapshot.js';
import { askingResponder, builderResponder } from '../../board/responder.js';
import { plainGateQuestion } from '../../board/deskWords.js';
import { needTone } from '../../board/needTone.js';

/** S16a-2c: the hash that lands a run's session on its sheet's Governance tab. */
export const GOVERNANCE_HASH = '#governance';

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
 *  - The header is the title and one state badge, with Stop (a destructive control) while work is live. What waits on
 *    the operator is a banner directly below it (operator 2026-10-18), and a thread scrolled up from its newest
 *    message offers a jump back to it.
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
  | { kind: 'turn'; key: string; at: number; who: 'you' | string; text: string; ok: boolean; citations?: ChatCitations; turnId: string | null; pending?: boolean; kickoff?: boolean }
  | { kind: 'run'; key: string; at: number; view: RunView }
  | { kind: 'line'; key: string; at: number; line: AskLine }
  | { kind: 'typing'; key: string; at: number; who: string }
  /** A run's step is executing: the helper on it is working now (studio: the thread shows it). */
  | { kind: 'working'; key: string; at: number; who: string; runId: string; ord: number; step: string }
  | { kind: 'proposal'; key: string; at: number; view: RunView; ask: AskProposal };


/** How long a just-decided proposal keeps the run's block away while the daemon's status catches up. */
const JUST_DECIDED_MS = 15_000;
/** How long an open proposal with NO cached gate keeps the block away (the reconcile reads the gate back). */
const OPEN_GRACE_MS = 60_000;


/** studio#663: a kickoff longer than this shows its first lines with Show all (DES-CHAT-NATIVE-RUN: a chat bubble
 *  holds the rest of a goal in full — `.wk-session-turn--kickoff` clamps at 8 lines, about this many characters). */
const KICKOFF_LONG = 600;

function launchedMs(v: RunView): number {
  const c = (v.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0;
}

/** studio#834: how long after the operator's own input (a wheel, a touch, a key) a scroll is still theirs. */
const OPERATOR_SCROLL_MS = 1000;
/** How long a jump's smooth scroll is the thread's own (its scroll events are not the operator's). */
const GLIDE_MS = 700;
/** DES-CHAT-NATIVE-RUN: the message inside a run's conversation that asks the operator something. */
const ASKING_SELECTOR = '[data-testid="chat-plan"][data-open="true"], [data-testid="chat-gate"], [data-testid="chat-final"][data-kind="deliver"], [data-testid="decision-marker"]';

export function SessionPage({ sessionId, runs, runsLoaded, runsError = null, onRetryRuns, needRows, navigate, onAsk, artifactKey = null, artifactSize = 'pane', artifactVersion = null }: {
  /** The runs read's failure (App's `useRuns`): said with Retry, never an endless skeleton. */
  runsError?: string | null;
  onRetryRuns?: () => void;
  sessionId: string;
  /** S16a-4a: the artifact the address grows (`/s/:id/a/:key`) and its size (`?size=`). */
  artifactKey?: string | null;
  artifactSize?: 'pane' | 'full';
  /** S16a-4b: `?v=N` — the version picked to look at. */
  artifactVersion?: number | null;
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
    // The address's search and hash ride along (a Watchtower `?jump=`, a `#gate`), so the moment the
    // operator was sent to survives the move onto the chat's thread.
    if (chat === null) return;
    // A jump names a moment of THIS run: on the chat's thread (many runs) it is pinned to the run.
    const q = new URLSearchParams(window.location.search);
    if (q.has('jump')) q.set('jumpRun', ref.runId);
    const search = q.toString();
    // S16a-4a: a grown artifact's segment rides along too (`/a/<key>`).
    const grownAt = artifactKey !== null ? `/a/${encodeURIComponent(artifactKey)}` : '';
    navigate(`${sessionPath(chat)}${grownAt}${search !== '' ? `?${search}` : ''}${window.location.hash}`, { replace: true });
  }, [ref, runChatId, runs, navigate, artifactKey]);
  // studio#675: a run: address the live index lacks (crew#265 leaves archived runs out of GET /runs) is
  // read through GET /runs/:id. The read belongs to its address; while the index holds the run there is
  // no read, so a run that later leaves the index (archived) is read afresh.
  const runInIndex = ref.kind === 'run' && runs.some((v) => v.session.id === ref.runId);
  const [detail, setDetail] = useState<{ id: string; run: RunView | null; error: string | null } | null>(null);
  const [detailTry, setDetailTry] = useState(0);
  const detailOwn = detail !== null && ref.kind === 'run' && detail.id === ref.runId ? detail : null;
  const detailRun = detailOwn?.run ?? null;
  const detailError = detailOwn?.error ?? null;

  const mine = useMemo(() => {
    const fromIndex = ref.kind === 'run'
      ? runs.filter((v) => v.session.id === ref.runId)
      : runChatId ? runs.filter((v) => runChatIdOf(v) === ref.chatId) : [];
    // Only this address's own detail read: a late answer for the previous address never shows here.
    const base = fromIndex.length === 0 && detailRun !== null ? [detailRun]
      : fromIndex;
    return [...base].sort((a, b) => launchedMs(a) - launchedMs(b));
  }, [ref, runs, runChatId, detailRun]);

  // The chat's transcript (and whether the daemon still holds it). Crew answers an unknown or
  // reclaimed chat with 200 `scope: null, messages: []`, so only that answer means "closed"; a
  // failed read says it failed (with a retry) and claims nothing about the conversation.
  // `at`: the read's try, so a page waiting for the read after its chat opened knows which answer is new.
  const [chat, setChat] = useState<
    { id: string; at: number; detail: ChatDetail } | { id: string; at: number; error: string } | null
  >(null);
  const [chatTry, setChatTry] = useState(0);
  useEffect(() => {
    if (ref.kind !== 'chat') return;
    let cancelled = false;
    api.getChat(ref.chatId)
      .then((d) => { if (!cancelled) setChat({ id: ref.chatId, at: chatTry, detail: d as unknown as ChatDetail }); })
      .catch((e: unknown) => {
        if (!cancelled) setChat({ id: ref.chatId, at: chatTry, error: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [ref, chatTry]);
  const mineChat = ref.kind === 'chat' && chat?.id === ref.chatId ? chat : null;
  const chatDetail = mineChat !== null && 'detail' in mineChat ? mineChat.detail : null;
  const chatError = mineChat !== null && 'error' in mineChat ? mineChat.error : null;
  const chatLoaded = ref.kind !== 'chat' || mineChat !== null;
  // The chat flow (2026-10-16): a chat `openChatFlow` started and nothing has been sent yet — its page is
  // "New chat" with its composer; the first Send opens it on the daemon under this id.
  const fresh = useChatFlow((s) => (ref.kind === 'chat' ? s.fresh[ref.chatId] ?? null : null));
  const freshProjectName = useProjectsStore((s) => (fresh?.projectId == null ? null : s.projects.find((p) => p.id === fresh.projectId)?.name ?? null));
  const freshOpening = useChatFlow((s) => (ref.kind === 'chat' && s.opening[ref.chatId] === true));
  // Opened on the daemon: read the chat again, and until THAT read answers the page stays the new chat
  // (codex r1: the read from before the open said "closed", which is not what the page now is).
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  // studio#663: a kickoff line longer than its one line opens in full on a click / Enter (the run's
  // goal and instructions are one step away, not only on hover).
  const [kickoffOpen, setKickoffOpen] = useState<string | null>(null);
  const wasFresh = useRef(fresh !== null);
  const chatTryRef = useRef(chatTry);
  chatTryRef.current = chatTry;
  useEffect(() => {
    if (wasFresh.current && fresh === null) {
      const next = chatTryRef.current + 1;
      setOpenedAt(next);
      setChatTry(next);
    }
    wasFresh.current = fresh !== null;
  }, [fresh]);
  useEffect(() => { setOpenedAt(null); }, [sessionId]);
  const awaitingOpenRead = openedAt !== null && (mineChat === null || mineChat.at < openedAt);
  // codex r1: a fresh mark another tab (or a lost answer) left behind never outranks the daemon — a read
  // that finds the chat held retires it, and the page is that conversation.
  const readLive = ref.kind === 'chat' && chatDetail !== null && conversationOf(ref, chatDetail) === 'live';
  useEffect(() => { if (fresh !== null && readLive && ref.kind === 'chat') chatOpened(ref.chatId); }, [fresh, readLive, ref]);
  const conversation: Conversation | 'pending' | 'unreadable' | 'fresh' = ref.kind === 'run' ? 'none'
    : (fresh !== null && !readLive) || awaitingOpenRead ? 'fresh'
    : chatError !== null ? 'unreadable'
      : chatDetail === null ? 'pending' : conversationOf(ref, chatDetail);
  const messages = useMemo(() => chatDetail?.messages ?? [], [chatDetail]);
  // studio#606 (4): on a live chat's own session the text replies into that chat; anywhere else a
  // live run here is NOT what Send reaches (it starts a separate Ask), and the composer says so.
  const scopeNote = composerScopeNote(mine, ref.kind === 'chat' && conversation === 'live');

  // ── ASK-S1: the ask path behind this chat ──────────────────────────────────────────────────
  const askPathOn = useCapabilities((s) => s.askPath);
  const chatId = ref.kind === 'chat' ? ref.chatId : null;
  const liveTurns = useAskThreadStore((s) => (chatId === null ? undefined : s.turns[chatId]));
  // A chat whose transcript has not been read back yet (just opened from its fresh page) is titled by
  // the operator's first live words; a fresh chat with nothing said is "New chat".
  const firstLiveWords = messages.length === 0 && mine.length === 0 ? liveTurns?.find((t) => t.who === 'you' && t.text.trim() !== '')?.text ?? null : null;
  const title = firstLiveWords !== null ? plainRunTitle(firstLiveWords) : fresh !== null && messages.length === 0 && mine.length === 0 ? 'New chat' : sessionTitle(messages, mine);
  const replySeq = useAskThreadStore((s) => (chatId === null ? 0 : s.replySeq[chatId] ?? 0));
  const linkedRun = useAskThreadStore((s) => (chatId === null ? undefined : s.runByChat[chatId]));
  const askRunsKnown = useAskThreadStore((s) => s.runs);
  const creatorAcceptedKnown = useAskThreadStore((s) => s.creatorAccepted);
  const answerOrdsKnown = useAskThreadStore((s) => s.answerOrds);
  const chatClosedKnown = useAskThreadStore((s) => s.chatClosed);
  const askKnow = useMemo(() => ({ runs: askRunsKnown, creatorAccepted: creatorAcceptedKnown, answerOrds: answerOrdsKnown, chatClosed: chatClosedKnown }), [askRunsKnown, creatorAcceptedKnown, answerOrdsKnown, chatClosedKnown]);
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
  // studio#631: the session knows its own runs. On a first turn the chat's record has no `path` yet
  // (crew learns it from `path.started`, after the first read) and nothing re-reads the chat until a
  // reply lands — a PA that never answers left the thread with no ask lines at all, its takeover
  // included. The same rule the runs poller applies (`learnRuns`) links the chat's ask run from here.
  useEffect(() => {
    if (askPathOn && chatId !== null && mine.length > 0) useAskThreadStore.getState().learnRuns(mine);
  }, [askPathOn, chatId, mine]);
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
  // Run clarity: a CLOSED conversation's composer starts a separate ask — it can no longer answer the
  // path's turn gate. The run is marked (a fact, like creatorAccepted) so its turn gate is a gate like
  // any other: kept in the gate store, drawn on the run's block and answered there — never a "Waiting on
  // you" header with nothing on the page to answer. The gate itself comes from the runs list's own gate
  // read (asked for here, once): no cached question is replayed, so nothing spent is ever drawn (codex r5).
  useEffect(() => {
    if (!askPathOn || askRunId === null || conversation !== 'closed') return;
    const ask = useAskThreadStore.getState();
    if (ask.chatClosed[askRunId] === true) return;
    ask.markChatClosed(askRunId);
    if (askView?.session.status === 'awaiting_human') onRetryRuns?.();
  }, [askPathOn, askRunId, askView?.session.status, conversation, onRetryRuns]);
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
  // studio#816: a closed chat's answers, read back from its runs (the transcript holds none).
  const askAnswers = useAskAnswers(mine, askPathOn && conversation === 'closed');
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

  // H3: who responded, per thread entry (the roster names the seats).
  const roster = useRoster();
  const whoOfEntry = (e: ThreadEntry): Responder => (e.kind === 'turn' || e.kind === 'typing' || e.kind === 'working' ? turnResponder(e.who, roster)
    : e.kind === 'proposal' ? turnResponder(e.ask.by, roster) : CREW);
  // The closed line above the entries is crew's: the first crew entry under it needs no second label.
  const leadWho: Responder | null = conversation === 'closed' && mine.length > 0 ? CREW : null;
  const badges = useMemo(() => needsByRun(needRows), [needRows]);
  const state: SessionState = mine.some((v) => runState(v) === 'waiting') ? 'waiting'
    : mine.some((v) => runState(v) === 'working') ? 'working'
      : mine.length > 0 ? runState(mine[mine.length - 1]!) : 'quiet';
  // (J4 0.16.6) A step silent past crew's quiet mark is not "Working": the header says how long it has said nothing.
  const silent = useSilentStep(mine.length > 0 ? mine[mine.length - 1] : undefined);
  const silentRunId = silent !== null ? mine[mine.length - 1]!.session.id : null;
  const badge = mine.length > 0 ? (state === 'working' && silent !== null ? { word: silentWords(silent), tone: 'gate' as const } : headerBadge(mine, state)) : null;
  // The banner below the header: each thing here that waits on the operator (the Needs-you rows about these runs).
  const gates = useGateStore((s) => s.gates);
  const waiting = useMemo(() => waitingItems(needRows, mine, gates, Date.now()), [needRows, mine, gates]);
  useEffect(() => {
    if (ref.kind !== 'run' || !runsLoaded || runInIndex) { setDetail(null); return; }
    const id = ref.runId;
    let cancelled = false;
    api.getRun(id)
      .then(({ run }) => { if (!cancelled) setDetail({ id, run, error: null }); })
      .catch((e: unknown) => {
        if (cancelled) return;
        // A 404: the daemon does not serve this id, and the pending line says so. Any other failure is a
        // failed read, said with a retry.
        const gone = e instanceof ApiError && e.status === 404;
        setDetail({ id, run: null, error: gone ? null : e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [ref, runsLoaded, runInIndex, detailTry]);

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
    // studio#816: a CLOSED chat's transcript is gone (crew drops it on close and at boot), but each
    // answer is still its run's answer step output — read back (`useAskAnswers`) and shown as the
    // reply it was, unless this client still holds that reply live.
    // Placed when its step completed (the team row); else right after the question this client
    // still holds for that step; else in step order after the run's launch (codex r1 on #818). Its
    // unit ord rides along, so a finding attaches under ITS reply, not by position.
    const liveReplied = new Set(liveOrd.values());
    const completedAt = askCompletedAt(askRows);
    for (const a of askAnswers) {
      if (liveReplied.has(a.ord)) continue;
      const run = mine.find((v) => v.session.id === a.runId);
      const asked = (liveTurns ?? []).find((t) => t.who === 'you' && t.runId === a.runId && t.stepId === a.key);
      const at = (a.runId === askRunId ? completedAt.get(a.ord) : undefined)
        ?? (asked !== undefined ? asked.at + 1 : undefined)
        ?? (run !== undefined ? launchedMs(run) + a.ord : a.ord);
      const key = `answer:${a.runId}:${a.ord}`;
      liveOrd.set(key, a.ord);
      out.push({ kind: 'turn', key, at, who: a.by ?? 'helper', text: a.text, ok: true, turnId: null });
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
    // What started each run, as the operator's own bubble: a run launched from New job (or a step
    // added) has no chat, so no message of yours, and the thread opened on a status card. A chat's
    // transcript is where your words are — but a CLOSED chat (crew reclaimed it: no scope, no
    // messages) has none left, so its runs' own words stand in and the thread never opens on a card
    // alone. A live chat's empty transcript is left as it is.
    // "None of yours" is judged on the MERGED thread (codex chat-r1): a question just sent is a live
    // turn before the transcript records it, and must not gain a second bubble. An Ask run's problem
    // is crew's scope briefing, never your words (askTitle; crew#823), so it never stands in.
    const transcriptLacksYou = conversation === 'closed' && !out.some((e) => e.kind === 'turn' && e.who === 'you');
    for (const v of mine) {
      const problem = (v.session.problem ?? '').trim();
      if (problem !== '' && !isChatScopeProblem(problem) && (runChatIdOf(v) === null || transcriptLacksYou)) {
        out.push({ kind: 'turn', key: `kick:${v.session.id}`, at: launchedMs(v) - 1, who: 'you', text: problem, ok: true, turnId: null, kickoff: true });
      }
      if (askBlockHidden && v.session.id === askRunId) {
        if (proposal !== null) out.push({ kind: 'proposal', key: `p:${proposal.proposalId}`, at: proposal.at, view: v, ask: proposal });
        continue;
      }
      out.push({ kind: 'run', key: `r:${v.session.id}`, at: launchedMs(v), view: v });
    }
    // Something visible while a helper works: a step executing (and not held by Needs you) gets a
    // live line at the thread's foot, so nobody types again or clicks because nothing seems to move.
    // A chat's own "thinking" line already says it for the answering step.
    if (!out.some((e) => e.kind === 'typing')) {
      for (const v of mine) {
        if (isHeldRun(v.session)) continue;
        const ord = executingOrd(v.session, v.units);
        if (ord === null) continue;
        const unit = v.units.find((u) => u.ord === ord);
        out.push({
          kind: 'working', key: `working:${v.session.id}`, at: Number.MAX_SAFE_INTEGER,
          who: unit?.assigned_cli ?? 'helper', runId: v.session.id, ord, step: phaseLabel(v.session.id, v.units, ord),
        });
      }
    }
    return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);
  }, [messages, conversation, mine, liveTurns, lines, thinking, askBlockHidden, askRunId, askRows, askPathOn, proposal, askAnswers]);

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
  const clearScroll = useSessionDrafts((s) => s.clearScroll);
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
  // Where the thread's OWN last scroll put it: a scroll event landing there is the thread's, not the operator's.
  // A position, not a flag — a first visit scrolls more than once before the events arrive (to the newest message,
  // then to an open gate's run), and a browser may fold several assignments into one event.
  const programmatic = useRef<number | null>(null);
  const restore = useRef<{ top: number; pending: boolean }>({ top: 0, pending: false });
  // studio#834: a scroll is the operator's only when their own input made it — a wheel, a touch, a key, or the
  // pointer held on the thread (its scrollbar). The browser scrolls the thread on its own too, as the run's words
  // fill in (scroll anchoring keeps a line in place, a shrinking block clamps the position), and reading those as
  // "they scrolled up to read" stopped the follow on a first visit (a finished run opened 753 px above its summary)
  // and saved that spot as their place (every later open came back 269 px short).
  const operatorUntil = useRef(0);
  const pointerHeld = useRef(false);
  // Jump to latest (operator 2026-10-18): away from the newest message the thread offers a way back, counting what
  // arrived meanwhile. A jump glides there (no glide under reduced motion); while it glides the thread's own scroll
  // events are not read as the operator's, and the operator's own input ends the glide's hold at once.
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const glideUntil = useRef(0);
  const glideSettle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Called from layout effects that run on every thread change: it sets state only when the answer changed, so it can
  // never feed a render loop.
  const awayNow = useRef(false);
  const unseenNow = useRef(0);
  awayNow.current = away;
  unseenNow.current = unseen;
  const syncEnd = (el: HTMLDivElement): void => {
    const end = atEnd(el);
    if (awayNow.current === end) { awayNow.current = !end; setAway(!end); }
    if (end && unseenNow.current !== 0) { unseenNow.current = 0; setUnseen(0); }
  };
  const operatorInput = (): void => { operatorUntil.current = Date.now() + OPERATOR_SCROLL_MS; glideUntil.current = 0; };
  useEffect(() => {
    const release = (): void => {
      if (!pointerHeld.current) return;
      pointerHeld.current = false;
      operatorInput();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); };
  }, []);
  const scrollThread = (el: HTMLDivElement, top: number): void => {
    const before = el.scrollTop;
    el.scrollTop = top;
    if (el.scrollTop !== before) programmatic.current = el.scrollTop;
  };
  const glide = (el: HTMLDivElement, top: number): void => {
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof el.scrollTo !== 'function') { scrollThread(el, top); return; }
    glideUntil.current = Date.now() + GLIDE_MS;
    el.scrollTo({ top, behavior: 'smooth' });
  };
  useEffect(() => () => { if (glideSettle.current !== null) clearTimeout(glideSettle.current); }, []);
  const jumpToLatest = (): void => {
    const el = scroller.current;
    if (el === null) return;
    // Back at the newest message the thread follows again, and a later visit opens there (no saved place).
    nearBottom.current = true;
    restore.current.pending = false;
    setUnseen(0);
    clearScroll(sessionId);
    glide(el, el.scrollHeight);
    if (glideSettle.current !== null) clearTimeout(glideSettle.current);
    // Words that landed while it glided: the end is wherever the thread ends now.
    glideSettle.current = setTimeout(() => {
      glideSettle.current = null;
      if (nearBottom.current && scroller.current !== null) { scrollThread(scroller.current, scroller.current.scrollHeight); syncEnd(scroller.current); }
    }, GLIDE_MS + 20);
  };
  // The banner's "Go to it": the waiting run's question (its plan card, a step's question, the hand-over) comes into
  // view and takes the focus, and the thread stops following — the operator is reading there now.
  const jumpToItem = (item: WaitingItem): void => {
    const el = scroller.current;
    if (el === null) return;
    const block = [...el.querySelectorAll<HTMLElement>('[data-testid="session-run"], [data-testid="session-ask-proposal"]')].find((b) => b.dataset['runId'] === item.runId);
    if (block === undefined) return;
    // A step's question (or a stalled step handed to you) is answered in the run's question card, not its plan or final.
    const question = QUESTION_KINDS.has(item.kind) ? block.querySelector<HTMLElement>('[data-testid="session-run-questions"]') : null;
    const target = question ?? block.querySelector<HTMLElement>(ASKING_SELECTOR) ?? block.querySelector<HTMLElement>('[data-testid="chat-final"]') ?? block;
    nearBottom.current = false;
    restore.current.pending = false;
    const top = Math.max(0, el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 8);
    setScroll(sessionId, top);
    glide(el, top);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!ready) return;
    const el = scroller.current;
    const saved = useSessionDrafts.getState().scroll[sessionId];
    // DES-CHAT-NATIVE-RUN: a first visit opens where a chat app opens — at the newest message, following the thread
    // as it fills (a step's words land after the page). A SAVED place — the top included — means they were reading
    // there: nothing follows until they scroll again (r3 #5). The scroller is reused across sessions (Copilot).
    const top = saved ?? 0;
    restore.current = { top, pending: top > 0 };
    if (el !== null) {
      scrollThread(el, saved === undefined ? el.scrollHeight : top);
      nearBottom.current = saved === undefined;
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
    // Growth below a thread that is not following fires no scroll event: the jump button is decided here too.
    syncEnd(el);
  }, [entries, ready]);
  // DES-CHAT-NATIVE-RUN: a run's messages fill in after their entry lands (each step's words are read on demand),
  // so growth INSIDE an entry follows too while the operator is at the newest message.
  useEffect(() => {
    const el = scroller.current;
    if (!ready || el === null || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(() => {
      if (el.scrollHeight === lastHeight.current) return;
      lastHeight.current = el.scrollHeight;
      // A returning visitor's place is finished here too: it may need words that land after the entries (codex r1 #4).
      if (restore.current.pending) {
        const max = el.scrollHeight - el.clientHeight;
        if (max >= restore.current.top) { scrollThread(el, restore.current.top); restore.current.pending = false; }
        else scrollThread(el, max);
        return;
      }
      if (nearBottom.current) scrollThread(el, el.scrollHeight);
      syncEnd(el);
    });
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [entries, ready]);
  // What arrived while the operator reads above the newest message: the jump button counts it (a typing or working
  // line is not a message).
  // History that lands after the page is ready (the transcript, the team rows, a restored place's thread) is not new:
  // only entries dated after this session was opened count.
  const seenKeys = useRef<{ session: string; opened: number; keys: Set<string> } | null>(null);
  useEffect(() => {
    const now = entries.filter((e) => e.kind !== 'typing' && e.kind !== 'working').map(arrival);
    const prev = seenKeys.current;
    const opened = prev !== null && prev.session === sessionId ? prev.opened : Date.now();
    seenKeys.current = { session: sessionId, opened, keys: new Set(now.map((e) => e.key)) };
    if (!ready || prev === null || prev.session !== sessionId || nearBottom.current || restore.current.pending) return;
    const n = newEntries(prev.keys, now, opened);
    if (n > 0) setUnseen((u) => u + n);
  }, [entries, ready, sessionId]);
  useEffect(() => { awayNow.current = false; unseenNow.current = 0; setUnseen(0); setAway(false); }, [sessionId]);

  // Run clarity: the action first. On a first visit (no saved place — a saved place means they were
  // reading there) a run of this session with an open gate brings its block — the card leads it — into
  // view once, and the thread stops following: a block that grows below (a plan pane, the step list)
  // never pulls the question off screen. The thread's own scroll, so it is never saved as their place.
  const gatedRunId = useGateStore((s) => mine.find((v) => s.gates[v.session.id] !== undefined)?.session.id ?? null);
  const shownGate = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!ready || gatedRunId === null || el === null) return;
    const key = `${sessionId}:${gatedRunId}`;
    if (shownGate.current === key || useSessionDrafts.getState().scroll[sessionId] !== undefined) return;
    const block = [...el.querySelectorAll<HTMLElement>('[data-testid="session-run"]')].find((b) => b.dataset['runId'] === gatedRunId);
    if (block === undefined) return;
    shownGate.current = key;
    nearBottom.current = false;
    restore.current.pending = false;
    // DES-CHAT-NATIVE-RUN: the question is a message inside the run's conversation (the plan, a step's question,
    // the hand-over) — that message is what comes into view, not the run's first message.
    const asking = block.querySelector<HTMLElement>(ASKING_SELECTOR) ?? block;
    const view = el.getBoundingClientRect();
    const at = asking.getBoundingClientRect().top;
    if (at < view.top || at > view.bottom - 160) scrollThread(el, Math.max(0, el.scrollTop + at - view.top - 8));
    syncEnd(el);
  }, [ready, gatedRunId, sessionId, entries]);

  // Where a source's passage can be read from: the session's runs with a worktree, newest first.
  const readers = useMemo(() => [...mine].reverse().map((v) => ({
    id: v.session.id, workdir: typeof v.session.workdir === 'string' ? v.session.workdir : null,
  })).filter((r) => r.workdir !== null), [mine]);
  const missing = ready && mine.length === 0 && (conversation === 'closed' || conversation === 'none');
  // studio#631 (2): a chat's thread has its own Stop — the same 10 s-undo stop ⌘K offers ("Stop this
  // session"), on every run of the chat still going. Hidden when nothing in it is running.
  const liveRuns = useMemo(() => mine.filter((v) => !['completed', 'cancelled', 'failed'].includes(v.session.status)).map((v) => v.session.id), [mine]);
  const stopping = useSheets((s) => liveRuns.length > 0 && liveRuns.every((id) => s.stopping[id] !== undefined));
  const [confirmStop, setConfirmStop] = useState(false);
  const stopWords = liveRuns.length > 1 ? `Stop ${liveRuns.length} runs` : 'Stop run';
  useEffect(() => { setConfirmStop(false); }, [sessionId]);
  // A runs read still pending after 15 s (host load) is said, with Retry — never a silent skeleton.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (runsLoaded) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(t);
  }, [runsLoaded, sessionId]);
  // S8: an artifact open as a pane sits beside the thread; the thread and composer make room.
  // Leaving the session (or switching to another) folds them back: a remembered pane from
  // another session must not narrow this one.
  const pane = useArtifactSizes(paneOpen);
  const artifactMissing = useArtifactMissing(artifactKey, ready && mine.length > 0);
  useEffect(() => () => collapseArtifacts(), [sessionId]);
  // Leaving the session leaves no Options group behind for the next page (codex h4-fix r1 P2: a Made-list card
  // would read it as its own).
  useEffect(() => () => { useHostPanel.getState().closeGroup(); }, [sessionId]);
  // Open is the panel beside the chat (wide) or over it (below 1200 px).
  const panelNarrow = useNarrow();
  // Operator 2026-10-18: the details panel is open by default beside the chat; its own close folds it to a handle at
  // the right edge, and this browser remembers which the operator left it. Below 1200 px it would cover the chat, so
  // there it starts closed behind the handle (the overlay is HostPanel's, closed on every mount).
  useEffect(() => {
    if (useHostPanel.getState().group === null) useHostPanel.getState().setFolded(!readDetailsOpen());
  }, []);
  // The run panel IS this session's look-underneath (src/board/runPanelModel.ts): while this page is up, a session
  // sheet asked for it or one of its runs (⌘K, a sign-in line, `#governance`) opens the panel at the same content.
  const claim = useRef({ mine, narrow: panelNarrow });
  claim.current = { mine, narrow: panelNarrow };
  useEffect(() => claimSessionSheet({
    // A session with no run here has no panel to hold it: its sheet opens as before.
    owns: (id) => claim.current.mine.length > 0 && (id === sessionId || claim.current.mine.some((v) => `run:${v.session.id}` === id)),
    open: (id, tab) => {
      const place = panelPlaceOf(tab);
      const rp = useRunPanel.getState();
      if (id.startsWith('run:') && claim.current.mine.length > 1) rp.pick(sessionId, id.slice(4));
      rp.focusOn(place.section, place.item);
      const hp = useHostPanel.getState();
      hp.setTab(RUN_TAB);
      if (claim.current.narrow) hp.setOverlay(true); else hp.setFolded(false);
    },
  }), [sessionId]);
  // S16a-2c: a run address with `#governance` (the MCP usage page's link) opens that run's Governance on arrival — in
  // the run panel, after its closed default above, once the run is here to hold it (until then it is the sheet's).
  const governed = useRef<string | null>(null);
  const runHere = ref.kind === 'run' && mine.some((v) => v.session.id === ref.runId);
  useEffect(() => {
    if (ref.kind !== 'run' || window.location.hash !== GOVERNANCE_HASH || governed.current === ref.runId) return;
    if (!runHere && !runsLoaded) return;
    governed.current = ref.runId;
    openSheet({ kind: 'session', sessionId: `run:${ref.runId}` }, 'governance');
  }, [ref, runHere, runsLoaded]);

  // DES §7.4: the retired "Demo video" header button is an ordinary turn suggestion — a run here that made a deck or a
  // document offers "Make a demo video of this", which opens the New job form's demo video in its project.
  const newest = mine.length > 0 ? mine[mine.length - 1] : null;
  const madeDocs = useRunDocs(newest);
  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    const projectId = demoVideoProjectOf(newest, madeDocs);
    if (projectId === null) return [];
    return [{ id: 'demo-video', label: 'Make a demo video of this', title: 'A demo video of the running app, as a new job',
      onPick: () => openLaunchWizard({ workflowId: DEMO_VIDEO_ID, projectId, composerKey: sessionId }) }];
  }, [madeDocs, newest, sessionId]);

  // The decision dock (mockup ui-v2-gate + addendum): the session's open decisions, in the thread's order — a run's
  // gate (not an ask turn's, which the composer answers), a run's question, the chat's own gate or question.
  const elicitations = useElicitationStore((s) => s.elicitations);
  const attention = useSystemStore((s) => (s.snapshot?.ranked === true ? s.snapshot.attention : null));
  const dockItems = useMemo<DockItem[]>(() => {
    const out: DockItem[] = [];
    // The rail's red follows the one dot rule (board/needTone): red when the item blocks other work.
    const blocking = (id: string): boolean => (attention ?? []).some((a) => (a.runId === id || (a.blockedRunIds ?? []).includes(id)) && needTone(a) === 'fail');
    for (const v of mine) {
      const id = v.session.id;
      if (['completed', 'cancelled', 'failed'].includes(v.session.status)) continue;
      if (askBlockHidden && id === askRunId) continue;
      const g = gates[id];
      const el = elicitations[id];
      if (g !== undefined) {
        // The builder the job waits with (the newest creator step), never a hand-over's script.
        // A plan question is crew's own (nothing is built yet): "the job is waiting".
        const who = g.gateKind === 'plan_approval' ? null : builderResponder(v, g.ord, roster);
        out.push({ key: id, who: who?.name ?? null, since: g.receivedAt ?? null, question: plainGateQuestion(g.prompt, g.gateKind), tone: blocking(id) ? 'blocking' : 'waiting' });
      } else if (el !== undefined) {
        const who = askingResponder(v, roster, el);
        out.push({ key: id, who: who.role === 'seat' ? who.name : null, since: null, question: el.message, tone: blocking(id) ? 'blocking' : 'waiting' });
      }
    }
    if (ref.kind === 'chat') {
      const g = gates[ref.chatId];
      const el = elicitations[ref.chatId];
      if (g !== undefined || el !== undefined) out.push({ key: ref.chatId, who: null, since: g?.receivedAt ?? null, question: g !== undefined ? plainGateQuestion(g.prompt, g.gateKind) : el!.message, tone: 'waiting' });
    }
    return out;
  }, [mine, gates, elicitations, roster, attention, askBlockHidden, askRunId, ref]);
  const dockWho = dockItems[0]?.who ?? null;

  // H3: the composer's props, shared by the thread's composer and the full-screen chat drawer's (one draft).
  const composerProps = {
    suggestions,
    composerKey: sessionId,
    // studio#606 (4): while a run here is live, Send starts a separate Ask — say so before Send.
    footer: scopeNote !== null ? <p data-testid="session-composer-scope" role="note" className="wk-composer-hint">{scopeNote}</p> : null,
    text: draft,
    setText: (t: string) => setDraft(sessionId, t),
    // S16a-4e: on a live chat's own session the composer replies into THAT chat.
    // The chat flow: a fresh chat's first Send opens it under this page's id, in the project it started in.
    // codex r1: one open per fresh chat — a Send while it is opening waits (the page says so); once it is
    // open (even before its read lands) a Send replies into it.
    onSend: (text: string, opts: ComposerSend) => {
      if (ref.kind === 'chat' && fresh !== null && conversation === 'fresh') {
        if (!beginChatOpen(ref.chatId)) return;
        onAsk(text, { ...opts, fresh: true, openChatId: ref.chatId, ...(opts.projectId === undefined && fresh.projectId !== null ? { projectId: fresh.projectId } : {}) });
        return;
      }
      onAsk(text, ref.kind === 'chat' && (conversation === 'live' || awaitingOpenRead) && opts.fresh !== true && opts.projectId === undefined ? { ...opts, chatId: ref.chatId } : opts);
    },
    runs: mine,
    started: entries.length > 0,
    navigate,
    ariaLabel: 'Ask or tell studio what to do next',
    placeholder: 'Ask about this, or tell studio what to do next — / adds a step, @ names a project or a helper',
    variant: 'session' as const,
  };
  // H3 (HOST-API §6): full screen's chat drawer is this run's own thread, compact — its conversation turns,
  // each with who responded, and the same composer (the run's cards stay in the thread behind it).
  const drawerTurns = entries.filter((e): e is Extract<ThreadEntry, { kind: 'turn' }> => e.kind === 'turn').slice(-12);
  const renderChat = (): React.ReactNode => (
    <div data-testid="run-chat-drawer" className="wk-run-chat">
      <div className="wk-run-chat-thread">
        {drawerTurns.length === 0 && <p className="wk-session-grey">Nothing has been said in this run yet.</p>}
        {drawerTurns.map((e) => (
          <div key={e.key} data-testid="run-chat-turn" className="wk-run-chat-turn">
            <TurnWho who={turnResponder(e.who, roster)} />
            <p className="wk-session-text">{e.text}</p>
          </div>
        ))}
      </div>
      {/* The SAME composer key: the "about:" chip a plugin's selection puts on the run's composer, and a
          typed character it forwards, land here while the drawer is the composer in view (DES §7.3). */}
      <Composer {...composerProps} className="wk-run-chat-composer" />
    </div>
  );
  const runHost = useRunHostValue(mine, renderChat);

  return (
    <ArtifactAddressProvider sessionId={sessionId} routeKey={artifactKey} routeSize={artifactSize} routeVersion={artifactVersion} navigate={navigate}>
    <RunHostProvider value={runHost}>
    {/* H3 (run page option B): the thread and, beside it, the ONE host panel — the run's details as its
        Run tab, a plugin's Options tabs added on demand; below 1200 px a one-line ribbon. */}
    <div data-testid="session-frame" className="wk-session-frame">
    <div data-testid="session" data-object={`session:${sessionId}`} data-session-id={sessionId} data-conversation={conversation} data-state={state} data-pane={pane} className={`wk-session${pane ? ' wk-session--pane' : ''}`}>
      {/* Operator 2026-10-18: the header is the title and one state badge — Stop is its only action while work is live. */}
      <header className="wk-session-head wk-measure wk-measure--thread">
        <div className="wk-session-head-body">
          {/* Audit row 62: until the session's reads settle, the title is a skeleton and no state word
              is said — never the placeholder "A session · Quiet · Loading…". */}
          {ready || mine.length > 0 || conversation === 'fresh'
            ? <h1 data-testid="session-title" className="wk-session-title">{title}</h1>
            : <div data-testid="session-title-loading" className="wk-session-title-skeleton"><Skeleton rows={1} variant="line" /></div>}
          {/* UI-CONTRACT §5: the one status vocabulary (never "Quiet" for a cancelled run); a failed, stopped or cancelled
              run reads red. "Waiting on you" is the banner's, below. */}
          {badge !== null && (
            <span data-testid="session-status" data-tone={badge.tone} className={`wk-state-badge wk-state-badge--${badge.tone}`}>
              {badge.word}
            </span>
          )}
          {conversation === 'fresh' && mine.length === 0 && (
            <span data-testid="session-status" data-tone="quiet" className="wk-state-badge wk-state-badge--quiet">
              <span data-testid="session-fresh-status">{freshOpening || awaitingOpenRead || (fresh === null) ? 'Starting the chat…'
                : fresh.projectId !== null ? `New · in ${freshProjectName ?? 'a project'}` : 'New · not in a project'}</span>
            </span>
          )}
        </div>
        {/* S16a-4e: a chat off the ask path promotes into Build from its own session (the retired chat page's door). */}
        {ref.kind === 'chat' && !askPathOn && conversation === 'live' && messages.some((m) => m.kind === 'user') && (
          <button type="button" data-testid="session-chat-promote" title="Open the Build composer prefilled with this conversation as context — editable before launch" onClick={() => { setRetryPrefill(chatPromotePrefill(ref.chatId, messages, mine[0] !== undefined && typeof mine[0].session.project_id === 'string' ? mine[0].session.project_id : null)); navigate('/runs/new'); }} className="wk-prop-btn wk-prop-btn--ghost">Continue in Build</button>
        )}
        {/* studio#631 (2) + rig 863167a2: ANY session with live work has its Stop — a run's session as
            well as a chat's — the same 10 s-undo stop ⌘K offers, behind one confirm step. A destructive control:
            red, and it says what it stops. */}
        {liveRuns.length > 0 && !confirmStop && (
          <button
            type="button"
            data-testid="session-stop"
            disabled={stopping}
            title={stopping ? 'Stopping — Undo is on the notice' : 'Stop this work — you confirm first, then 10 s to undo; what it did so far is kept'}
            onClick={() => setConfirmStop(true)}
            className="wk-btn wk-btn--sm wk-stop-btn"
          >
            {stopping ? 'Stopping…' : stopWords}
          </button>
        )}
        {liveRuns.length > 0 && confirmStop && (
          <span data-testid="session-stop-confirm-row" role="group" aria-label={`${stopWords}?`} className="wk-session-stop-confirm">
            <span className="wk-session-grey">{`${stopWords}?`}</span>
            <button type="button" data-testid="session-stop-confirm" autoFocus onClick={() => { setConfirmStop(false); stopRun(liveRuns, `“${title}”`); }} className="wk-btn wk-btn--sm wk-stop-btn wk-stop-btn--confirm">{stopWords}</button>
            <button type="button" data-testid="session-stop-keep" onClick={() => setConfirmStop(false)} className="wk-btn wk-btn--quiet wk-btn--sm">Keep going</button>
          </span>
        )}
      </header>
      {/* Operator 2026-10-18: what waits on you is a banner below the header, in the page's flow (the thread reflows). */}
      {/* What the dock already holds is not said again above the thread. */}
      {ready && <NeedsBanner items={waiting.filter((w) => !dockItems.some((d) => d.key === w.runId))} onJump={jumpToItem} />}

      <DecisionDockFrame items={dockItems} composer={(reply, docked) => (
        // The measure sits on a wrapper: the composer's own box (its `/` and `@` menus anchor to it) stays the input's width.
        <div className="wk-session-composer-wrap wk-measure wk-measure--thread"><DockedComposer reply={reply} docked={docked} composerProps={composerProps} who={dockWho} /></div>
      )}>
      <div className="wk-session-body">
        {/* S16a-4a: an address naming an artifact this session does not hold grows nothing and says so. */}
        {artifactMissing && <p data-testid="session-artifact-missing" className="wk-session-grey">That artifact is not in this session any more.</p>}
        <div
          ref={scroller}
          data-testid="session-thread"
          className="wk-session-thread wk-measure wk-measure--thread"
          onScroll={(e) => {
            const el = e.currentTarget;
            syncEnd(el);
            // A jump gliding to its place: the thread's own scroll, until it lands (or the operator takes over).
            if (Date.now() < glideUntil.current) return;
            // The thread's own scroll (a restore, a follow) is not the operator's place.
            if (programmatic.current !== null && Math.abs(el.scrollTop - programmatic.current) < 2) return;
            // studio#834: a scroll the operator did not make is not their place; a thread that is following
            // its newest message goes back to it.
            if (!pointerHeld.current && Date.now() > operatorUntil.current) {
              if (nearBottom.current && !restore.current.pending) scrollThread(el, el.scrollHeight);
              return;
            }
            programmatic.current = null;
            restore.current.pending = false;
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            setScroll(sessionId, el.scrollTop);
          }}
          // DESIGN-interaction rule 2: selecting a sentence in the work makes it the subject of the
          // next message — an "about: “…”" chip on the composer (never a button row).
          onWheel={operatorInput}
          onTouchMove={operatorInput}
          onKeyDown={operatorInput}
          onPointerDown={() => { pointerHeld.current = true; operatorInput(); }}
          onMouseUp={(e) => {
            const sel = window.getSelection();
            const node = sel?.anchorNode ?? null;
            if (sel === null || node === null || !e.currentTarget.contains(node)) return;
            const label = quoteLabel(sel.toString());
            if (label !== null) addAboutChip(sessionId, { kind: 'about', key: `q:${label}`, label });
          }}
        >
          {conversation === 'fresh' && liveTurns === undefined && mine.length === 0 && (
            <p data-testid="session-fresh" className="wk-session-grey wk-session-fresh">Ask anything, or say what you want done. Your first message starts this chat; a job starts only when you choose one.</p>
          )}
          {conversation === 'closed' && mine.length > 0 && (
            // DES-CHAT-NATIVE-RUN: a quiet divider, not a speaker — what follows is rebuilt from the work itself.
            <p data-testid="session-closed-line" role="note" className="wk-chat-divider">{CLOSED_LINE}</p>
          )}
          {chatError !== null && (
            <StateBanner data-testid="session-chat-error" kind={readErrorKind(chatError)} what="this conversation" error={chatError}
              onRetry={() => { setChat(null); setChatTry((n) => n + 1); }} />
          )}
          {/* S16a-2d: a run address the index has not resolved (a just-launched run, landed on from the
              launch form or a moved /runs/:id) says so honestly — the run page's pending view. */}
          {missing && ref.kind === 'run' && (
            <p data-testid="session-run-pending" data-run-id={ref.runId} className="wk-session-grey">
              {detailError !== null ? 'This run couldn’t be opened.' : 'This run isn’t on Studio’s service yet. A run that just started shows up here in a few seconds.'}
            </p>
          )}
          {missing && ref.kind === 'run' && detailError !== null && (
            <StateBanner data-testid="session-run-detail-error" kind={readErrorKind(detailError)} what="this run" error={detailError}
              onRetry={() => setDetailTry((n) => n + 1)} />
          )}
          {missing && ref.kind !== 'run' && (
            <p data-testid="session-missing" className="wk-session-grey">
              {ref.kind === 'chat' && !runChatId
                ? 'Studio’s service can’t link runs to this conversation, so there are no runs to show.'
                : 'Nothing in this session is on Studio’s service any more.'}
            </p>
          )}
          {!runsLoaded && runsError !== null && (
            <StateBanner data-testid="session-runs-error" kind={readErrorKind(runsError)} what="this session" error={runsError} {...(onRetryRuns !== undefined ? { onRetry: onRetryRuns } : {})} />
          )}
          {!runsLoaded && runsError === null && slow && (
            <div data-testid="session-runs-slow" role="status" className="wk-session-slow">
              <p className="wk-session-grey">This session is taking longer than usual to load.</p>
              {onRetryRuns !== undefined && <button type="button" data-testid="session-runs-slow-retry" onClick={onRetryRuns} className="wk-btn wk-btn--secondary wk-btn--sm">Retry</button>}
            </div>
          )}
          {!ready && !(runsError !== null && !runsLoaded) && <div data-testid="session-loading"><Skeleton rows={3} variant="card" /></div>}
          {/* §8 F13: an older daemon has no team path — every helper answers at once; said once, in grey. */}
          {ready && ref.kind === 'chat' && !askPathOn && conversation === 'live' && messages.length > 0 && (
            <p data-testid="session-ask-older" className="wk-session-grey">Every helper answers at once in this conversation: this version of Studio’s service has no reviewer or help requests.</p>
          )}
          {entries.map((e, i) => {
            // H3: who responded. A turn says it in its own bubble; any other entry gets the line when the
            // responder changes (consecutive crew lines share one), so the thread reads as a conversation.
            const who = whoOfEntry(e);
            const prev = i === 0 ? leadWho : whoOfEntry(entries[i - 1]!);
            // DES-CHAT-NATIVE-RUN: a run's messages carry their own speakers, and the working line names its helper.
            const label = e.kind !== 'turn' && e.kind !== 'run' && e.kind !== 'working' && (prev === null || responderKey(prev) !== responderKey(who))
              ? <TurnWho who={who} runId={e.kind === 'proposal' ? e.view.session.id : askRunId} {...(e.kind === 'typing' ? { suffix: 'thinking' } : {})} />
              : null;
            const node = (e.kind === 'line'
            ? <AskLineView key={e.key} line={e.line} onSignIn={() => openSheet({ kind: 'session', sessionId }, 'signins')} onRetry={askTeamRetry} />
            : e.kind === 'typing'
              ? <AskTyping key={e.key} who={e.who} />
              : e.kind === 'working'
              ? (
                <div key={e.key} data-testid="session-working" data-run-id={e.runId} data-object={`step:${e.runId}:${e.ord}`} className="wk-chat-working">
                  <span aria-hidden className="wk-chat-working-dots"><i /><i /><i /></span>
                  {/* rig 0.15.8: the step in the chain's own word ("Check", never "Verify" beside it). */}
                  <span data-testid="session-working-text" data-silent={e.runId === silentRunId ? 'true' : 'false'} aria-live="polite"><span className="wk-chat-working-who">{who.role === 'crew' ? 'studio' : who.name}</span> {e.runId === silentRunId && silent !== null ? `${silentWords(silent).replace(/^No/, 'no')} on ${workingStepWord(e.step)}` : `Working on ${workingStepWord(e.step)}…`}</span>
                  {/* rig 0.15.8: the composer says "message a working step from its ⋯" — this is that ⋯. */}
                  <OverflowMenu label={`More for ${workingStepWord(e.step)}`} data-testid="session-working-menu"
                    items={[{ id: 'message', label: MESSAGE_STEP_LABEL, onSelect: () => openSheet({ kind: 'step', runId: e.runId, ord: e.ord }, undefined, { compose: true }) }]} />
                </div>
              )
              : e.kind === 'proposal'
                ? <AskProposalBlock key={e.key} view={e.view} ask={e.ask} onBringBack={() => setDraft(sessionId, 'Go ahead with the plan you proposed.')} />
                : e.kind === 'turn'
            ? (
              <div key={e.key} data-testid="session-turn" data-who={e.who === 'you' ? 'you' : 'helper'} {...(e.pending ? { 'data-pending': 'true' } : {})}
                {...(e.kickoff ? { 'data-kickoff': 'true', title: e.text } : {})}
                className={`wk-session-turn wk-session-turn--${e.who === 'you' ? 'you' : 'helper'}${e.pending ? ' wk-session-turn--pending' : ''}${e.kickoff ? ' wk-session-turn--kickoff' : ''}${e.kickoff && kickoffOpen === e.key ? ' wk-session-turn--kickoff-open' : ''}`}>
                {/* DES-CHAT-NATIVE-RUN: what started the run is your first message, a bubble like any other; a very long
                    one shows its first lines with Show all (studio#663). */}
                <TurnWho who={who} runId={askRunId} {...(e.pending ? { suffix: 'answering' } : {})} />
                {e.who === 'you'
                  ? <>
                    <p id={e.kickoff ? `kickoff-${e.key}` : undefined} className={`wk-session-text${e.ok ? '' : ' wk-session-grey'}`}><OperatorMessage text={e.text} /></p>
                    {/* studio#663 (codex r1): its own button, so selecting the words or using a link in them never toggles it. */}
                    {e.kickoff && e.text.length > KICKOFF_LONG && (
                      <button type="button" data-testid="session-kickoff-toggle" className="wk-btn wk-btn--quiet wk-btn--sm wk-session-kickoff-toggle"
                        aria-expanded={kickoffOpen === e.key} aria-controls={`kickoff-${e.key}`}
                        onClick={() => setKickoffOpen((k) => (k === e.key ? null : e.key))}>
                        {kickoffOpen === e.key ? 'Show less' : 'Show all'}
                      </button>
                    )}
                  </>
                  : (
                    // S16a-4e (crew#561): a helper's reply on the session wears the daemon's verdicts where
                    // it cited — the marks and the strip the retired chat page's thread had — so a fabricated SHA is
                    // never read as a confirmed one here either. Mark, never edit.
                    <HelperReply who={e.who} text={e.text} ok={e.ok} citations={e.citations} />
                  )}
                {e.who !== 'you' && <SourceChips citations={e.citations} runs={readers} />}
                {/* DC-S8: the rules the turn's seats were given — considered · set aside · cited (unchecked). */}
                {e.who !== 'you' && ref.kind === 'chat' && e.turnId !== null && replies.last.get(e.turnId) === e.key && (
                  <TurnConsidered chatId={ref.chatId} turnId={e.turnId} replies={replies.count.get(e.turnId) ?? 0} navigate={navigate} />
                )}
                {/* DC-S6: what crew made of the operator's words — remembered, offered, or nothing. */}
                {e.who === 'you' && ref.kind === 'chat' && e.turnId !== null && <TurnDecisions chatId={ref.chatId} turnId={e.turnId} navigate={navigate} />}
              </div>
            )
            : <RunBlock key={e.key} view={e.view} badge={badges[e.view.session.id] ?? 0} sessionId={sessionId} navigate={navigate} solo={mine.length === 1 ? title : null} />);
            return <Fragment key={e.key}>{label}{node}</Fragment>;
          })}
          {/* S16a-4g: the chat's own question and gate (keyed by the chat id) at the thread's foot. */}
          {ref.kind === 'chat' && <ChatQuestions chatId={ref.chatId} />}
        </div>
        {/* Jump to latest: away from the newest message, a way back (with what arrived meanwhile). */}
        {ready && away && entries.length > 0 && (
          <button type="button" data-testid="session-jump-latest" data-unseen={unseen} aria-label={jumpLabel(unseen)} title={jumpLabel(unseen)}
            onClick={jumpToLatest} className="wk-jump-latest">
            <span aria-hidden>↓</span>
            {unseen > 0 && <span data-testid="session-jump-unseen" aria-hidden className="wk-jump-latest-count">{unseen > 99 ? '99+' : unseen}</span>}
          </button>
        )}
      </div>
      {/* Rule 3: while the thread is the chain, the shape line names the path's steps for the operator. */}
      {askBlockHidden && askPath.shape.length > 0 && (
        <p data-testid="session-ask-shape" className="wk-session-grey wk-session-shape wk-measure wk-measure--thread">{askShapeFooter(askPath)}</p>
      )}

      </DecisionDockFrame>
    </div>
    <HostPanel edgeHandle="Show the run’s details" onToggle={writeDetailsOpen} runTab={<RunTab runs={mine} allRuns={runs} sessionId={sessionId} title={title} navigate={navigate} />} ribbon={<RunRibbon runs={mine} />} />
    </div>
    </RunHostProvider>
    </ArtifactAddressProvider>
  );
}

/**
 * A helper's reply in the thread. Studio#682 row 6: a reply that is only a failed tool call ("[tool
 * call failed] grep: The user has specified a rule … [{"permission":…}]") is one plain line — who
 * could not do what — with the raw text (rulesets, home and temp paths) behind Technical details.
 */
function HelperReply({ who, text, ok, citations }: { who: string; text: string; ok: boolean; citations: ChatCitations | undefined }): React.ReactElement {
  const split = useMemo(() => splitToolFailures(text), [text]);
  const failed = split.failures.length > 0 ? (
    <div data-testid="session-tool-failure" className="wk-session-tool-failures">
      {/* One line per distinct fact (two identical refusals read once). */}
      {[...new Set(split.failures.map((f) => `${who} couldn’t ${f.verb}: ${f.why}.`))].map((line) => (
        <p key={line} className="wk-session-grey wk-session-tool-failure">{line}</p>
      ))}
      <TechDetails data-testid="session-tool-failure-detail" text={split.failures.map((f) => f.raw)} />
    </div>
  ) : null;
  return (
    <div className={`wk-session-text${ok ? '' : ' wk-session-grey'}`}>
      {split.text !== '' && <Markdown marks={citationMarks(citations)}>{split.text}</Markdown>}
      {failed}
      {/* The daemon's citation verdicts: one quiet count line; the flagged list opens under it (the
          marks on the text above stay where they sit). */}
      {citations !== undefined && citations.items.length > 0 && (
        <details data-testid="seat-citations-details" className="wk-tech-details wk-session-citations">
          <summary data-testid="seat-citations-toggle" className="wk-tech-details-summary">Citations: {citationLabel(citations)}</summary>
          <CitationStrip citations={citations} />
        </details>
      )}
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

/** The run's block in the thread is its conversation (DES-CHAT-NATIVE-RUN): see RunConversation. */
export { RunBlock };

/**
 * The session composer while a decision is docked (operator 2026-10-27): the reply box answers the decision through
 * its note choice, or asks a separate question — the draft's intent picks which (the platform's prompt routing; none
 * on today's crew, so it replies, and says so), and one click on the switch overrides it for that draft.
 */
function DockedComposer({ reply, docked, composerProps, who }: {
  reply: DockReply | null;
  /** A decision is docked: with no note choice to reply through, the box says plainly that Send asks separately. */
  docked: boolean;
  composerProps: React.ComponentProps<typeof Composer>;
  who: string | null;
}): React.ReactElement {
  const router = useDraftRouter();
  const { route, flip } = useReplyRoute(reply === null ? '' : composerProps.text ?? '', router);
  if (reply === null && docked) {
    // The docked decision takes no note (a hand-over, a plan, a question from a run): Send asks a separate question.
    return (
      <Composer {...composerProps} placeholder="Ask a separate question about this job…"
        footer={<p data-testid="session-reply-switch" data-to="ask" data-why="no-note" role="note" className="wk-composer-hint wk-reply-switch"><span data-testid="session-reply-dest">Send asks a separate question</span></p>}
        className="wk-session-composer" />
    );
  }
  if (reply === null) return <Composer {...composerProps} className="wk-session-composer" />;
  const words = switchWords(route, reply.label);
  const footer = (
    <p data-testid="session-reply-switch" data-to={route.to} data-why={route.why} role="note" className="wk-composer-hint wk-reply-switch">
      <span data-testid="session-reply-dest">{words.dest}</span>
      {words.why !== null && <span className="wk-reply-why"> · {words.why}</span>}
      {' · '}
      <button type="button" data-testid="session-reply-flip" onClick={flip} className="wk-reply-flip">{words.flip}</button>
    </p>
  );
  return (
    <Composer
      {...composerProps}
      placeholder={`Or tell ${who ?? 'the job'} what to do…`}
      footer={footer}
      onSend={(text, opts) => { if (route.to === 'reply') reply.send(text); else composerProps.onSend(text, opts); }}
      className="wk-session-composer"
    />
  );
}
