import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatOpened, chatOpenFailed } from '../store/chatFlow.js';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import type { ChatOpenBody, ChatScope, RepoEntry, RosterSeat, SessionView } from '../api/types.js';
import { needsYouRows } from '../board/needsYou.js';
import { useFailureClocks } from '../store/failureClocks.js';
import { forgetAskSession, readAskSession, writeAskSession, type AskSession } from '../store/askSession.js';
import { useGateStore } from '../store/gates.js';
import { useLiveChatsStore } from '../store/liveChats.js';
import { useMembershipStore } from '../store/membership.js';
import { useProjectsStore } from '../store/projects.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { getCachedRoster, setCachedRoster } from '../store/rosterCache.js';
import { chosenSeats, useComposerSeats } from '../store/composerSeats.js';
import { useRoster } from '../hooks/useRoster.js';
import {
  buildContextPack,
  PACK_JOIN,
  type DiagnosticsState,
} from './askContext.js';
import { AssistDock, type AssistVerbs } from './AssistDock.js';
import { CaptureDrop } from './CaptureDrop.js';
import { describeResolvedScope } from './ChatScopeSelect.js';
import { defaultSelection, describeChatOpenRefusal } from '../board/chatOpen.js';
import { ApiError, apiStatus, apiWire } from '../api/errors.js';
import { ambientProjectId } from '../hooks/ambientProject.js';
import { peekTypedSeed, takeTypedSeed } from '../hooks/useTypeToComposer.js';
import { useAskThreadStore } from '../store/askThread.js';
import { useCapabilities } from '../store/capabilities.js';
import { isReviewerOnly } from '../board/seatNames.js';
import { addChip, chipsOpenFields, chipsScoped, chipsSignature, chosenChips, clickChip, defaultScopeChips, type ScopeChip } from '../board/chatScopes.js';
import { cliOptions, defaultChatCli, saveChatCli } from '../board/chatCli.js';
import { cliName, pageContext, pagePlaceholder, pagePrompts } from '../board/pagePrompts.js';
import { jobTitle } from '../board/deskWords.js';
import { reopenSystemChat, systemChatEpoch } from '../store/askDock.js';
import { useChatWindow } from '../store/chatWindow.js';
import { useDocsCache } from '../store/docsCache.js';
import { useChatChrome } from './chat/ChatWindow.js';
import { ChatCliPicker } from './chat/ChatCliPicker.js';
import { ChatScopeChips, type ScopeCandidate } from './chat/ChatScopeChips.js';
import { ChatHistoryRail } from './chat/ChatHistoryRail.js';
import { History } from 'lucide-react';
import { CHAT_ATTACHMENT_LIMITS, type ChatAttachmentError, type ChatStartedOn } from '../api/chatHistory-wire.js';

/**
 * ASK — the app-wide binding of the ASSIST DOCK (DES-ASSIST-DOCK §5: "the dock becomes
 * 'ask for work from anywhere'"), opened from the rail's Ask button or Ctrl/⌘+Shift+A.
 *
 * A question launches a governed CHAT SESSION over the retired chat page's seat machinery
 * (`POST /chats` warms the chat-capable roster, `POST /chats/:id/messages` fans the
 * question out) — the seats carry the estate/garden tooling that can actually look at
 * the databases, the code graph, and the run record. The FIRST message rides with the
 * context pack (`buildContextPack`): the current route/section, counts from the runs
 * fold the app already holds, and `GET /api/v1/diagnostics` CITED when the daemon
 * serves it — when it does not (older crews), the pack says so honestly.
 *
 * Opening the dock fires READS only (diagnostics + the session repo/project caches, to
 * seed honest quick prompts). NOTHING launches until the user sends — the quick-prompt
 * chips prefill the composer, never submit it.
 *
 * ASK-S1 (DES-ASK-TEAM-CHAT-001 §5.1): under `capabilities.askPath` the same two calls start a
 * TEAM PATH — `POST /chats` records the eligible seats (no seat is warmed), the first message
 * launches the run and later ones continue it; the 202 names the turn and the run. The dock
 * deposits each turn in the ask-thread store so the session thread shows the question at once,
 * passes the one seat the operator named (`primary`) when they named one, and says in plain words
 * when the PA is still answering (409 `turn_in_flight`) or the chat's repositories changed since
 * it started (409 `chat_scope_changed`, crew#1020) — the draft is kept.
 */

/** The persisted scope rides only when the daemon stated one (a missing key reads as not stated). */
function scopeField(scope: ChatScope | null): { scope?: ChatScope } {
  return scope !== null ? { scope } : {};
}

/** ASK-S1: the 202's turn (and, on a path, its run and answer step) lands in the ask-thread store, so
 *  the session thread shows the operator's words at once — what they typed, never the context pack. */
function deposit(chatId: string, typed: string, res: { turnId?: string; runId?: string; stepId?: string }): void {
  useAskThreadStore.getState().sent(chatId, {
    turnId: res.turnId ?? `local:${Date.now()}`, text: typed,
    ...(res.runId !== undefined ? { runId: res.runId } : {}),
    ...(res.stepId !== undefined ? { stepId: res.stepId } : {}),
  });
}

/** §8 F6, crew#1020: a 409 `turn_in_flight` (the PA is still answering) or `chat_scope_changed`
 *  (the chat's repositories changed since it started) is said in plain words; the dock keeps the
 *  draft. Anything else is rethrown as it came. */
function plainSendRefusal(chatId: string): (e: unknown) => never {
  return (e: unknown) => {
    if (apiStatus(e) === 409) {
      const wire = apiWire(e) ?? '';
      const body = e instanceof ApiError && typeof e.body === 'object' && e.body !== null
        ? (e.body as { code?: unknown; error?: unknown })
        : null;
      if (body?.code === 'chat_scope_changed' || /repositories changed since it started/i.test(wire)) {
        const sentence = typeof body?.error === 'string' && body.error !== '' ? body.error : wire;
        throw new Error(sentence);
      }
      if (/turn_in_flight|in flight|still answering/i.test(wire)) {
        const pa = useAskThreadStore.getState().paByChat[chatId] ?? 'The helper';
        throw new Error(`${pa} is still answering — wait for the reply; your message was not sent.`);
      }
    }
    throw e;
  };
}

/** The seats an Ask's first send may open its chat with in this scope mode: the daemon's admitted
 *  seats (studio#713: never a reviewer-only one). The drawer's helpers row lists exactly these. */
function askEligible(roster: readonly RosterSeat[], scoped: boolean): string[] {
  return defaultSelection(roster.filter((s) => !isReviewerOnly(s)), scoped);
}

/** A run's state in + Add's list, in plain words. */
const RUN_WORDS: Record<string, string> = {
  planning: 'starting', distributing: 'starting', executing: 'working', awaiting_human: 'waiting on you',
  completed: 'done', cancelled: 'stopped', failed: 'failed',
};

/** The one line an older crew gets in place of past chats and uploads (DES-SYSTEM-CHAT §9). */
export const OLDER_CREW_NOTE = 'Past chats and file uploads need a newer wicked-crew.';

/** Refuse an upload crew would refuse, before anything is opened: too many, too big, or a type the
 *  seat cannot read (images, UTF-8 text and pdfs). The daemon still decides. */
export function checkUpload(files: readonly File[], limits = CHAT_ATTACHMENT_LIMITS): void {
  if (files.length > limits.maxFiles) throw new Error(`Attach at most ${limits.maxFiles} files to one message (${files.length} attached).`);
  const mb = (n: number): string => `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  const big = files.find((f) => f.size > limits.maxFileBytes);
  if (big !== undefined) throw new Error(`${big.name} is ${mb(big.size)}; one file can be at most ${mb(limits.maxFileBytes)}.`);
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > limits.maxMessageBytes) throw new Error(`These files come to ${mb(total)}; one message can carry at most ${mb(limits.maxMessageBytes)}.`);
  const readable = (t: string): boolean => /^image\/(png|jpeg|gif|webp)$/.test(t) || t.startsWith('text/') || t === 'application/pdf';
  const odd = files.find((f) => f.type !== '' && !readable(f.type));
  if (odd !== undefined) throw new Error(`${odd.name} can't be read by the chat: attach an image, a text file or a pdf.`);
}

/** Upload a message's files to its chat; their ids ride the send. A refusal reads in crew's words. */
async function upload(chatId: string, files: readonly File[]): Promise<string[] | undefined> {
  if (files.length === 0) return undefined;
  const res = await api.uploadChatAttachments(chatId, files).catch((e: unknown) => {
    const body = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? (e.body as Partial<ChatAttachmentError>) : null;
    throw new Error(typeof body?.error === 'string' && body.error !== '' ? `The upload was refused — ${body.error}` : `The upload failed — ${e instanceof Error ? e.message : String(e)}`);
  });
  return res.attachments.map((a) => a.id);
}

/** The footer under a landed answer: who answered and how many chosen sources it could see. */
export function answerFooterWords(cli: string, sources: number): string {
  return `Answered by ${cli} · saw ${sources} source${sources === 1 ? '' : 's'}`;
}

export function AskDock({ runs, pathname, onClose, navigate, sendText, onHandoffTaken, sendProjectId, sendFresh = false, sendPrimary, sendChatId, sendOpenChatId, startProjectId, startText, startFresh = false }: {
  runs: SessionView[];
  pathname: string;
  /** Collapsing the dock closes Ask entirely — the launcher bubble/shortcut reopen it. */
  onClose: () => void;
  /** The promote door (studio#323 R3): "Open in full chat" routes to `/chat/:id`. */
  navigate?: (path: string) => void;
  /** A message the operator already SENT from another composer (the Desk's, skin `desk`): the
   *  dock opens with it and sends it as the operator's own question. Absent ⇒ nothing is sent. */
  sendText?: string;
  /** Called once the dock has taken `sendText` (it is in the dock's own state and being sent):
   *  the caller drops it, so nothing can hand it over a second time. */
  onHandoffTaken?: () => void;
  /** S7: the project an `@project` chip named — the handed-over message's chat is scoped to it. */
  sendProjectId?: string;
  /** S7: the handed-over message starts a NEW session (an `@project` after the first send), never
   *  the one this dock would resume. */
  sendFresh?: boolean;
  /** ASK-S1: the helper the operator named with `@` to answer — the path's `primary` (chosen) when
   *  this send opens a new chat on a daemon with `capabilities.askPath`. */
  sendPrimary?: string;
  /** S16a-4e: the handoff is a reply into THIS chat (the chat session on screen): the dock resumes
   *  it (and stores it as its session) instead of its own stored chat. */
  sendChatId?: string;
  /** The chat flow (2026-10-16): the handoff is the FIRST message of a fresh chat whose page is on
   *  screen (`openChatFlow` minted its id): the chat opens under THIS id, so its page becomes it. */
  sendOpenChatId?: string;
  /** Concept A (`openAskDock`): open a FRESH chat scoped to this project, nothing sent. */
  startProjectId?: string;
  /** Words placed in the box when the dock opens, never sent (⌘K "New demo"). */
  startText?: string;
  /** Open a FRESH chat (the Desk's Chat): the stored chat is not resumed. */
  startFresh?: boolean;
}): React.ReactElement {
  // The letters that opened the dock (type-to-composer, §5.6 rule 4): read on mount, cleared
  // in an effect (a StrictMode double initializer must not read an already-emptied seed).
  const [typedSeed] = useState(peekTypedSeed);
  useEffect(() => { takeTypedSeed(); }, []);
  // A Desk handoff is read once, at mount, like the seed: later props never re-send it.
  const [handoff] = useState(() => sendText);
  const tookRef = useRef(onHandoffTaken);
  useEffect(() => { if (handoff !== undefined) tookRef.current?.(); }, [handoff]);
  const [diag, setDiag] = useState<DiagnosticsState>({ kind: 'loading' });
  const [repos, setRepos] = useState<RepoEntry[]>(() => getCachedRepos() ?? []);
  const projects = useProjectsStore((s) => s.projects);
  const liveChats = useLiveChatsStore((s) => s.sessions);
  // The needs-you fold's inputs, from the stores the app already holds (all
  // written elsewhere — the gate stream, the board model's mirrors): zero
  // requests ride on reading them here.
  const gates = useGateStore((s) => s.gates);
  const failedAt = useFailureClocks((s) => s.failedAtByRun);
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const projectIds = useMembershipStore((s) => s.projectIdByRun);
  const docsByProject = useDocsCache((s) => s.byProject);
  // DES-SYSTEM-CHAT §9: past chats and uploads need crew's chat list and attachments.
  const chatList = useCapabilities((s) => s.chatList);
  const chatAttachments = useCapabilities((s) => s.chatAttachments);
  const capsLoaded = useCapabilities((s) => s.loaded);
  // The floating window's chrome (drag handle, minimize / full size / close) — absent in a bare render.
  const chrome = useChatChrome();
  // A send that settles after Close ended this chat must not re-persist it.
  const [epoch] = useState(systemChatEpoch);
  const ended = (): boolean => systemChatEpoch() !== epoch;

  // The diagnostics read — presence-gated: absence is an ANSWER (older crew), never an error.
  useEffect(() => {
    let cancelled = false;
    getDiagnostics()
      .then((d) => {
        if (!cancelled) setDiag({ kind: 'present', diagnostics: d });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isDiagnosticsUnsupported(e)) setDiag({ kind: 'unsupported' });
        else setDiag({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Prompt seeds: the session repo cache (one GET per session, shared with the palette/rail)
  // and the projects store (loaded here only if nothing has loaded it yet). Opening Ask is
  // the user gesture that pays for these reads.
  useEffect(() => {
    fetchReposCached()
      .then((rs) => setRepos([...rs].sort((a, b) => b.registered_at - a.registered_at)))
      .catch(() => {
        /* prompt seed only — the chip is omitted, never fabricated */
      });
    if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load();
  }, []);

  // DES-SYSTEM-CHAT §7: the page the chat is seeing — its words, its project and repo (the chips'
  // defaults) and the run on screen.
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const ctx = useMemo(
    () => pageContext({ pathname, search, runs, projects, repos }),
    [pathname, search, runs, projects, repos],
  );

  // The send verb closes over LIVE state via refs — the pack is assembled AT SEND TIME,
  // so it cites what the app knows at that moment (not at mount).
  const packInputs = useRef({ pathname, runs, liveChatCount: 0, diagnostics: diag as DiagnosticsState, pageLabel: ctx.label });
  packInputs.current = {
    pathname,
    runs,
    liveChatCount: Object.keys(liveChats).length,
    diagnostics: diag,
    pageLabel: ctx.label,
  };

  /** The session this dock RESUMES (studio#323 R3): the dock unmounts on close, so the
   *  id lives in sessionStorage — reopening Ask rejoins it instead of minting a second
   *  session and orphaning the first. Read once per mount. */
  // A fresh handoff (S7) forgets the stored session first, so its message opens a new one. A
  // handoff naming a project is always fresh: an open chat's scope cannot change, so the project
  // is honoured by a chat opened in it (before the composer's first send that IS its chat).
  const [resumed] = useState(() => {
    if ((sendText !== undefined && (sendFresh || sendProjectId !== undefined)) || (sendText === undefined && (startProjectId !== undefined || startFresh))) {
      forgetAskSession();
      return null;
    }
    if (sendText !== undefined && sendChatId !== undefined) {
      const stored = readAskSession();
      if (stored !== null && stored.chatId === sendChatId) return stored;
      // The chat on screen, opened elsewhere: its context pack rode its own first send.
      const session: AskSession = { chatId: sendChatId, title: '', seeded: true, scope: null };
      writeAskSession(session);
      return session;
    }
    return readAskSession();
  });
  /** The live chat session this dock opened — later sends reuse its warm seats. */
  const chatIdRef = useRef<string | null>(resumed?.chatId ?? null);
  /** A fresh chat page's own id (the chat flow), used once: the first open takes it. */
  const openIdRef = useRef<string | null>(sendText !== undefined && sendFresh ? sendOpenChatId ?? null : null);
  /** True once the context pack LANDED with a message — it seeds the first successful
   *  send only. A resumed session carries its persisted flag: a first send that failed
   *  leaves it unseeded, so the pack still rides the next question. */
  const seededRef = useRef(resumed?.seeded === true);
  /** The session's first question — its /chats handle, re-persisted with the flag. */
  const titleRef = useRef(resumed?.title ?? '');

  // DES-SYSTEM-CHAT §6 — "What the chat can see": the scope chips. Untouched, they follow the page on
  // screen (Ask stays mounted across navigation); a click makes them the user's, and they survive
  // navigation. Once the chat opens they are frozen with it (its read roots cannot change) and
  // persisted with the session, so a reopened chat shows what it was opened with.
  // A chat started in the project on screen (the rail's Chat) simply follows the page; one started in a
  // project from elsewhere (⌘K "Chat in this project") is held to that project, with the page's repo.
  const startProject = sendProjectId ?? startProjectId;
  const [chipEdits, setChipEdits] = useState<ScopeChip[] | null>(() => {
    if (resumed?.chips !== undefined && resumed.chips.length > 0) return resumed.chips;
    if (startProject === undefined || startProject === ctx.project?.id) return null;
    const name = useProjectsStore.getState().projects.find((p) => p.id === startProject)?.name ?? startProject;
    return defaultScopeChips({ project: { id: startProject, name }, repo: ctx.repo });
  });
  const chips = useMemo(() => chipEdits ?? defaultScopeChips(ctx), [chipEdits, ctx]);
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  /** `undefined` = no chat open yet (the chips are a choice); `null` = open, scope not stated. */
  const [openedScope, setOpenedScope] = useState<ChatScope | null | undefined>(() =>
    resumed === null ? undefined : (resumed.scope ?? null));
  const scopeRef = useRef<ChatScope | null>(resumed?.scope ?? null);
  /** What the last message's pack carried (the chips that were on, and the page): a later message
   *  carries a pack again only when that changed. */
  // A resumed chat restores what its last delivered pack carried; unknown (an older session) means the
  // next message carries a fresh one — never a page the chat was not told about.
  const lastPackRef = useRef<string | null>(resumed?.packSig ?? null);
  /** The diagnostics ride the first pack that carries This page — not merely the first message. */
  const diagSentRef = useRef(resumed?.diagSent === true || (resumed?.seeded === true && resumed.packSig === undefined));

  // DES-SYSTEM-CHAT §5 — the ONE answering CLI: the user's pick, else the default rule. Fixed once
  // the chat is open (a resumed chat keeps the CLI it was opened with).
  const roster = useRoster();
  const scoped = chipsScoped(chips);
  const clis = useMemo(() => cliOptions(roster, scoped), [roster, scoped]);
  const [cliPick, setCliPick] = useState<string | null>(() => sendPrimary ?? resumed?.cli ?? null);
  const cli = openedScope !== undefined
    ? cliPick
    : cliPick !== null && clis.some((o) => o.key === cliPick && o.ok) ? cliPick : defaultChatCli(clis);
  const cliRef = useRef(cli);
  cliRef.current = cli;
  const cliLabel = cli === null ? null : cliName(cli, roster);
  useEffect(() => { useChatWindow.getState().setCli(cliLabel); }, [cliLabel]);

  // ASK-S1 (Amendment 6 decision 5: studio renders ONE thread): on the chat's own session page the
  // session thread shows every turn as it happens, so once a send is accepted the dock steps aside
  // instead of showing the conversation a second time beside it. Anywhere else (the Desk, a page with
  // no thread) the dock stays — it is where the reply shows.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stepAside = useCallback((chatId: string) => {
    if (!useCapabilities.getState().askPath) return;
    const m = /^\/s\/([^/]+)/.exec(pathnameRef.current);
    if (m !== null && decodeURIComponent(m[1]!) === chatId) onCloseRef.current();
  }, []);

  /** How many chosen sources the latest message was sent with (a resumed chat: the chips it shows). */
  const sentSourcesRef = useRef(chosenChips(chips).length);

  /** Persist the open chat: its current chips (the user's choices now) apart from the signature of
   *  the last pack that LANDED (what the chat has actually been told). Never after Close ended it. */
  const persist = useCallback((id: string) => {
    if (ended()) return;
    writeAskSession({
      chatId: id, title: titleRef.current, seeded: seededRef.current, ...scopeField(scopeRef.current),
      chips: chipsRef.current,
      ...(cliRef.current !== null ? { cli: cliRef.current } : {}),
      ...(lastPackRef.current !== null ? { packSig: lastPackRef.current } : {}),
      ...(diagSentRef.current ? { diagSent: true } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ended` reads the module epoch
  }, []);

  /** The message as sent: what was typed, plus the pack when it is owed — the full one (diagnostics
   *  included) on the first message, a fresh one later only when the chips or the page changed. The
   *  chips and page are SNAPSHOT here, so the acknowledgement records exactly what this message carried
   *  (a chip changed while it is in flight is still owed to the next one). */
  const withPack = useCallback((text: string): { message: string; sig: string; diag: boolean } => {
    const chipsNow = chipsRef.current;
    // What this turn's answer will say it saw: the chips on when it was sent.
    sentSourcesRef.current = chosenChips(chipsNow).length;
    const sig = `${chipsSignature(chipsNow)}@${packInputs.current.pathname}`;
    if (seededRef.current && lastPackRef.current === sig) return { message: text, sig, diag: false };
    const diag = !diagSentRef.current && chipsNow.some((c) => c.kind === 'page' && c.on);
    const pack = buildContextPack({ ...packInputs.current, chips: chipsNow, omitDiagnostics: !diag });
    return { message: `${text}${PACK_JOIN}${pack}`, sig, diag };
  }, []);
  /** A message landed: the pack it carried is what the chat has seen. */
  const packLanded = useCallback((id: string, out: { sig: string; diag: boolean }) => {
    lastPackRef.current = out.sig;
    if (out.diag) diagSentRef.current = true;
    seededRef.current = true;
    persist(id);
  }, [persist]);

  // The user's chip choices for an OPEN chat are persisted as they change, so a resumed chat shows (and
  // its next pack carries) what the user chose last — not what it was opened with.
  useEffect(() => {
    if (openedScope === undefined || chatIdRef.current === null) return;
    persist(chatIdRef.current);
  }, [chips, openedScope, persist]);

  const verbs: AssistVerbs = useMemo(
    () => ({
      send: async (text, _documents, files = []) => {
        // Uploads (DES-SYSTEM-CHAT §8) are checked against crew's caps before anything is opened.
        if (files.length > 0) checkUpload(files);
        let id = chatIdRef.current;
        if (id !== null && resumed !== null && id === resumed.chatId) {
          try {
            const out = withPack(text);
            const ids = await upload(id, files);
            deposit(id, text, await (ids === undefined ? api.sendChatMessage(id, out.message) : api.sendChatMessage(id, out.message, undefined, ids)).catch(plainSendRefusal(id)));
            packLanded(id, out);
            stepAside(id);
            return { chatId: id };
          } catch (sendErr) {
            // A failed send is NOT proof the session is gone — a 5xx or a network blip
            // against a still-warm chat must not orphan it. Ask the daemon, as the retired chat page's
            // rejoin does: ONLY an empty seat list (a 200) means reclaimed. Anything else —
            // warm seats, or a probe that itself fails ("do not know") — keeps the id and
            // surfaces the send's own error.
            const gone = await api
              .getChat(id)
              .then((detail) => detail.seats.length === 0)
              .catch(() => false);
            if (!gone) throw sendErr;
            // Reclaimed (idle reaper, pool cap, a daemon restart) — forget it and open a
            // fresh session for this question below.
            forgetAskSession(id);
            chatIdRef.current = null;
            seededRef.current = false;
            lastPackRef.current = null;
            diagSentRef.current = false;
            id = null;
            // The fresh session below opens with the scope chosen now (the one on record stands
            // for the reclaimed chat only).
          }
        }
        if (id === null) {
          // codex r1: a fresh chat page's open that fails anywhere here (no CLI, the roster, the
          // open itself, no helper able to answer) frees the page's Send; the panel says why.
          try {
            // The chat-capable roster (EC44's derivation, reused verbatim) — cached when any
            // surface already fetched it; one GET /roster otherwise.
            let roster = getCachedRoster();
            if (roster === null) {
              const { roster: fetched } = await api.getRoster();
              setCachedRoster(fetched);
              roster = fetched;
            }
            const chosen = chipsRef.current;
            const scoped = chipsScoped(chosen);
            // DES-SYSTEM-CHAT §5: ONE CLI answers — the picker's. A CLI that cannot answer is never
            // sent; when none can, the refusal says why (the daemon's own words per CLI).
            const options = cliOptions(roster, scoped);
            const pick = cliRef.current !== null && options.some((o) => o.key === cliRef.current && o.ok) ? cliRef.current : defaultChatCli(options);
            if (pick === null) {
              const why = options.filter((o) => !o.ok).map((o) => `${o.label} (${o.reason ?? 'unavailable'})`).join(', ');
              throw new Error(options.length === 0
                ? 'No CLI is set up to answer — add one on the Agents page.'
                : `No CLI can answer right now — ${why}. Sign one in on the Agents page.`);
            }
            // Under the team path the chat records the eligible seats (studio#631's composer choice) and
            // the picked CLI is its primary; without it every seat sent answers, so only the pick is sent.
            const askPath = useCapabilities.getState().askPath;
            const eligible = askEligible(roster, scoped);
            const { dropped, picked } = useComposerSeats.getState();
            const seats = askPath ? [pick, ...chosenSeats(eligible, dropped, picked).filter((k) => k !== pick)] : [pick];
            // A failed open keeps the page's id for the retry; only a chat the daemon opened spends it.
            id = openIdRef.current ?? crypto.randomUUID();
            const body: ChatOpenBody & { startedOn?: ChatStartedOn } = { chatId: id, ...chipsOpenFields(chosen, ambientProjectId(packInputs.current.pathname)), clis: seats };
            // The page it started on, for past chats (`chatList` only: an older crew's strict schema refuses it).
            if (useCapabilities.getState().chatList) body.startedOn = { route: packInputs.current.pathname, label: packInputs.current.pageLabel };
            if (askPath) body.primary = pick;
            // A refused open reads as the retired chat page's does (codex on #327): a pre-0.39.0 daemon's
            // "unknown field `scopeKind`" names the upgrade, never the raw wire.
            const { seats: warmed, scope } = await api.openChat(body).catch((e: unknown) => {
              throw new Error(describeChatOpenRefusal(apiStatus(e), apiWire(e), e instanceof Error ? e.message : String(e)));
            });
            const ready = warmed.filter((s) => s.ok).map((s) => s.cliKey);
            if (ready.length === 0) {
              const detail =
                warmed.length > 0
                  ? warmed.map((s) => `${s.cliKey}: ${s.error ?? 'failed'}`).join('; ')
                  : askPath ? 'no signed-in helper is eligible to answer' : 'the daemon warmed no seats';
              throw new Error(`${askPath ? 'No helper can answer' : 'No agent seat came up'} — ${detail}`);
            }
            chatIdRef.current = id;
            // The chat flow: a fresh chat page's chat is open on the daemon now — an ordinary chat from here.
            openIdRef.current = null;
            chatOpened(id);
            scopeRef.current = scope ?? null;
            setOpenedScope(scope ?? null);
            // The chips and the CLI are this chat's now: frozen, whatever the page does next.
            setChipEdits(chosen);
            setCliPick(pick);
            cliRef.current = pick;
            // Persist for the tab — a close/reopen (or reload) resumes THIS session.
            titleRef.current = text;
            if (!ended()) writeAskSession({ chatId: id, title: text, seeded: false, ...scopeField(scopeRef.current), chips: chosen, cli: pick });
            // The session is live — make it findable on the rail (the J4 live row) and on
            // /chats, labelled with where it came from and what was asked (studio#323 R2).
            useLiveChatsStore.getState().upsert(id, ready, { origin: 'ask', title: text });
          } catch (openErr) {
            if (openIdRef.current !== null) chatOpenFailed(openIdRef.current);
            throw openErr;
          }
        }
        const out = withPack(text);
        const ids = await upload(id, files);
        deposit(id, text, await (ids === undefined ? api.sendChatMessage(id, out.message) : api.sendChatMessage(id, out.message, undefined, ids)).catch(plainSendRefusal(id)));
        packLanded(id, out);
        stepAside(id);
        return { chatId: id };
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ended` reads the module epoch
    [resumed, stepAside, withPack, packLanded],
  );

  const needRows = useMemo(
    () =>
      // THE home-queue fold (needsYouRows — DES-HOME-COMMAND-CENTER §3), so the failed-run prompt
      // seeds the SAME newest failed run the queue shows (E1) — never a second recency derivation.
      needsYouRows({ runs, gates, failedAt, attachedAt, projectIds, chats: [], repos, campaigns: [], now: Date.now() }),
    [runs, gates, failedAt, attachedAt, projectIds, repos],
  );
  const prompts = useMemo(
    () => pagePrompts({ ctx, runs, needRows, gates, clis, roster, projects, repos }),
    [ctx, runs, needRows, gates, clis, roster, projects, repos],
  );

  // + Add's corpus: every repo, project, run and document the app already holds (no request per key).
  const candidates = useMemo<ScopeCandidate[]>(() => {
    const out: ScopeCandidate[] = [];
    for (const p of projects) if (p.id !== 'default') out.push({ key: `project:${p.id}`, kind: 'project', label: p.name, ref: p.id });
    for (const r of repos) out.push({ key: `repo:${r.id}`, kind: 'repo', label: r.name, ref: r.id });
    for (const v of runs.slice(0, 200)) out.push({ key: `run:${v.session.id}`, kind: 'run', label: jobTitle(v.session), ref: v.session.id, detail: RUN_WORDS[v.session.status] ?? v.session.status });
    for (const [pid, docs] of Object.entries(docsByProject)) {
      for (const d of docs) out.push({ key: `doc:${pid}/${d.name}`, kind: 'doc', label: d.name, ref: d.name, projectId: pid, detail: projects.find((p) => p.id === pid)?.name ?? pid });
    }
    return out;
  }, [projects, repos, runs, docsByProject]);

  const locked = openedScope !== undefined;
  // A replayed answer says who answered; how much it saw is not on record, so it is not claimed.
  const answerFooter = useCallback((key: string, replayed?: boolean) => (replayed === true
    ? `Answered by ${cliName(key, getCachedRoster())}`
    : answerFooterWords(cliName(key, getCachedRoster()), sentSourcesRef.current)), []);
  const onStatus = useCallback((s: 'ready' | 'thinking' | 'answered') => { useChatWindow.getState().setStatus(s); }, []);

  const resolvedScope = openedScope === undefined ? '' : describeResolvedScope(openedScope, { projects });
  const notice = !capsLoaded ? undefined
    : !chatList && !chatAttachments ? OLDER_CREW_NOTE
      : !chatList ? 'Past chats need a newer wicked-crew.'
        : !chatAttachments ? 'File uploads need a newer wicked-crew.' : undefined;
  const [historyOpen, setHistoryOpen] = useState(false);
  const loadHistory = useMemo(() => (chatList
    ? (id: string) => api.getChatMessages(id).then((r) => ({ records: r.messages, closed: r.chat.status === 'closed' }))
    : undefined), [chatList]);

  const picker = (
    <ChatCliPicker
      options={clis}
      value={cli}
      locked={locked}
      onChange={(k) => { setCliPick(k); saveChatCli(k); }}
      {...(navigate !== undefined ? { onSignIn: (path: string) => navigate(path) } : {})}
    />
  );

  return (
    <div data-testid="system-chat" className="wk-syschat">
      {chatList && historyOpen && (
        <ChatHistoryRail
          currentId={chatIdRef.current}
          onOpen={(entry) => { setHistoryOpen(false); reopenSystemChat(entry); }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      <AssistDock
        context={{
          surface: 'ask',
          title: 'Chat',
          contextLabel: resolvedScope === '' ? `Seeing: ${ctx.label}` : `Seeing: ${ctx.label} · ${resolvedScope}`,
          placeholder: pagePlaceholder(ctx),
          hint:
            'Ask about what you are looking at. The answer comes from your code, your jobs and studio’s own records, ' +
            'within what the chat can see. Nothing changes until you say so.',
          prompts,
          controls:
            openedScope === undefined ? (
              /* Behaviour 8: or drop notes / a photo instead — the proposals land in Home's Needs You. */
              <CaptureDrop
                runs={runs}
                pathname={pathname}
                inline
                onReview={navigate === undefined ? undefined : () => { navigate('/'); onClose(); }}
              />
            ) : undefined,
          composerControls: (
            <ChatScopeChips
              chips={chips}
              locked={locked}
              candidates={candidates}
              onSearchOpen={() => { void useDocsCache.getState().loadIndex(); }}
              onClick={(key) => setChipEdits(clickChip(chips, key))}
              onAdd={(c) => setChipEdits(addChip(chips, { key: c.key, kind: c.kind, label: c.label, ref: c.ref, ...(c.projectId !== undefined ? { projectId: c.projectId } : {}) }))}
            />
          ),
        }}
        verbs={verbs}
        resumeChatId={resumed?.chatId ?? null}
        onResumeGone={(chatId) => {
          // studio#328: the daemon reclaimed it — forget the stored id so no reopen
          // repeats the dead session, and the next send opens a fresh one.
          forgetAskSession(chatId);
          useLiveChatsStore.getState().remove(chatId);
          if (chatIdRef.current === chatId) {
            chatIdRef.current = null;
            seededRef.current = false;
            lastPackRef.current = null;
            diagSentRef.current = false;
            // No chat is open any more: the next send opens a fresh one, so the scope is a choice again.
            scopeRef.current = null;
            setOpenedScope(undefined);
          }
        }}
        fill
        typeTarget="ask"
        initialText={handoff ?? (typedSeed !== '' ? typedSeed : startText ?? '')}
        sendOnOpen={handoff !== undefined && handoff.trim() !== ''}
        onExpandChat={
          navigate === undefined
            ? undefined
            : (chatId) => {
                // ASK-S1 (codex #8): under the capability the chat IS a path and its thread is the session;
                // the legacy fan-out surface (`/chat/:id`) would draw a pending bubble per eligible seat.
                // S16a-4e: a chat is its session — the promote door is always `/s/<id>`.
                navigate(`/s/${encodeURIComponent(chatId)}`);
                onClose();
              }
        }
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        headerProps={chrome?.dragProps}
        headerExtra={picker}
        compactHeader
        headerEnd={chrome?.controls}
        onStatus={onStatus}
        // Uploads ride crew's attachments route; without it the paperclip stays away rather than attach a
        // file the send would drop.
        allowAttach={chatAttachments}
        fileMode={chatAttachments}
        loadHistory={loadHistory}
        headerStart={chatList ? (
          <button
            type="button"
            data-testid="chat-history-toggle"
            className="wk-chatwin-btn"
            aria-pressed={historyOpen}
            aria-label={historyOpen ? 'Hide past chats' : 'Past chats'}
            title={historyOpen ? 'Hide past chats' : 'Past chats'}
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <History size={15} aria-hidden />
          </button>
        ) : undefined}
        answerFooter={answerFooter}
        promptsSend
        notice={notice}
      />
    </div>
  );
}
