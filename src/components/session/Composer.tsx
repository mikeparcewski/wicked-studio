import type { ShapeGuess } from 'wicked-crew-api-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import { artifactOfChips, chipText, messageWithAbout, projectChip, type AboutChip } from '../../board/aboutChips.js';
import { inViewFor } from '../../store/artifactInView.js';
import { composerSendRefusal, SIGN_ONE_IN } from '../../board/launchModel.js';
import { isHelperSeat } from '../../board/responder.js';
import { AGENTS_PATH } from '../../hooks/useRoute.js';
import { parseWorkflowCommand, WORKFLOWS_FAILED_LINE, WORKFLOWS_LOADING_LINE } from '../../board/workflowCommand.js';
import { allCommandRows, catalogRows, commandList, notOfferedLine, parseCommandLine, takesRepo, workflowEntry, type CatalogRow, type CommandRow } from '../../board/slashCatalog.js';
import { contentWords } from '../../board/commandSearch.js';
import { commandsOn, LOOKS_DEBOUNCE_MS, looksLike, useCatalogV2 } from '../../store/catalogV2.js';
import { entryOffered, entryWords, jobCatalogView, startsInline, type CatalogEntry } from '../../board/workflowCatalog.js';
import { jobChipFor, postJob, setStartNote, useStartNotes, workflowChipFor } from '../../store/inlineStart.js';
import { InlineStart, type InlineStartHandle } from './InlineStart.js';
import { catalogProjectOf, useWorkflowCatalog } from '../../store/workflowCatalog.js';
import { startCatalogEntry } from '../../store/startCatalogEntry.js';
import { goToPath } from '../QeRefusalWarning.js';
import {
  draftTarget, dropToken, menuToken, slashItems, wordOf, type DraftRunState, type DraftTarget, type SlashItem,
} from '../../board/planDraft.js';
import { gateInstance } from '../../board/proposalCard.js';
import { useRoster } from '../../hooks/useRoster.js';
import { seatLabel, userSeats } from '../../board/seatNames.js';
import { seatStanding } from '../gateVerdictModel.js';
import { defaultSelection } from '../../board/chatOpen.js';
import { chosenSeats, NO_SEAT_PICKED, seatOff, useComposerSeats, useLaunchSeats } from '../../store/composerSeats.js';
import { loadCatalog, loadPresets, usePlanCatalog } from '../../store/planCatalog.js';
import { usePlanGate } from '../../store/planGates.js';
import { addGateDraftStep, queueMidRunStep } from '../../store/planDrafts.js';
import { useGateStore } from '../../store/gates.js';
import { useProjectsStore } from '../../store/projects.js';
import { useWorkflowDefs } from '../../store/workflowCache.js';
import {
  addAboutChip, backspaceAboutChip, chipsOf, clearAboutChips, removeAboutChip, useComposerChips,
} from '../../store/composerChips.js';
import { humanTitle } from '../runIdentity.js';
import { useCapabilities } from '../../store/capabilities.js';
import { takeComposerSeed, useComposerSeed } from '../../store/composerSeed.js';
import { SlashMenu, type AtItem } from './SlashMenu.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { usePhone } from '../../hooks/usePhone.js';
import { VoiceMicButton } from '../voice/VoiceMicButton.js';

let cmdSeq = 0;
/** Each composer's typed-command draft key, kept as long as its draft (the module's life, as `sessionDrafts`): a retry
 *  after a remount is the same request (codex r2); a posted command renews it, so the next is its own (codex r1). */
const cmdKeys = new Map<string, string>();
function cmdKeyOf(composerKey: string): string {
  let k = cmdKeys.get(composerKey);
  if (k === undefined) { k = renewCmdKey(composerKey); }
  return k;
}
function renewCmdKey(composerKey: string): string {
  cmdSeq += 1;
  const k = `cmd:${composerKey}:${Date.now().toString(36)}:${cmdSeq}`;
  cmdKeys.set(composerKey, k);
  return k;
}

/** Where a send goes besides the words: the project an `@project` chip named, and whether it opens a fresh session. */
export interface ComposerSend {
  /** The `@project` chip's project: the chat is scoped to it. */
  projectId?: string;
  /** True when the message must open a NEW session (an `@project` after this session's first send). */
  fresh?: boolean;
  /** ASK-S1: the helper an `@helper` chip named before the session's first send — under
   *  `capabilities.askPath` it is the one who answers (the path's `primary`). */
  primary?: string;
  /** S16a-4e: the live chat this composer stands in (a chat's own session page) — the send is a
   *  reply INTO that chat, never into the Ask dock's own stored chat. */
  chatId?: string;
  /** The chat flow (2026-10-16): a FRESH chat's page — the send opens the chat on the daemon under
   *  this id (the page's own), so the conversation stays on the page it started on. */
  openChatId?: string;
  /** crew#1157: the read-only workflow the new chat runs (Understand's Ask: `analyze`), and the
   *  repositories it reads. Sent only when `capabilities.chatWorkflows` names the workflow. */
  workflow?: string;
  repos?: Array<{ id: string; name: string }>;
  /** DES-CHAT-ARTIFACTS-001 §5.1: the artifact the message is about (its chip, else the one this composer's surface
   *  shows) and the parts selected in it. The chat names its version at send time, after the editor's writes settle. */
  artifact?: { ref: string; anchors: string[]; composerKey: string };
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function plannedRun(v: SessionView): boolean {
  const id = (v.session as unknown as { run_identity?: { kind?: unknown } }).run_identity;
  return typeof id === 'object' && id !== null && (id.kind === 'preset' || id.kind === 'user_plan');
}

/**
 * Where a `/` command lands for these runs (the session's, oldest first): the newest live run, read
 * with its open gate's kind. One `usePlanGate` read, for that run only.
 */
function useDraftTarget(runs: readonly SessionView[]): { target: DraftTarget; gateKey: string | null; title: string } {
  const live = [...runs].reverse().find((v) => !TERMINAL.has(v.session.status)) ?? null;
  const liveId = live?.session.id ?? null;
  const waiting = live?.session.status === 'awaiting_human';
  const planGate = usePlanGate(liveId, waiting);
  const gate = useGateStore((s) => (liveId === null ? undefined : s.gates[liveId]));
  const states: DraftRunState[] = runs.map((v) => ({
    runId: v.session.id,
    status: v.session.status,
    planned: plannedRun(v),
    // S10 codex r2: seeded only from a view read for THIS gate instance; until it lands, reading.
    planGate: v.session.id === liveId && planGate.isPlanGate && planGate.view !== null && planGate.fresh ? { seed: planGate.view.editSeed } : null,
    gatePending: v.session.id === liveId && (planGate.pending || planGate.reading),
  }));
  return {
    target: draftTarget(states),
    gateKey: gateInstance(gate),
    title: live === null ? '' : humanTitle(live.session.problem || live.session.id),
  };
}

/**
 * THE COMPOSER (DES-STUDIO-REBUILD-001 §5.5, slice S7) — the Desk's and a session's one place to ask
 * (DESIGN-interaction rule 2):
 *
 *  - about-chips: what the next message is about ("about: “the Pay button”"), from a selection in
 *    the thread, `@helper`, and (S8) an element on a page. × removes one; Backspace in an empty box
 *    removes the last. The chips lead the message the helpers get.
 *  - `@`: a project (where the message goes: before this composer's first send it scopes the chat,
 *    after it the message starts a new session there) or a helper (a subject).
 *  - `/`: adds a step to the session's chain — a plan draft (§5.7): on the plan gate's card while
 *    one is open (nothing is sent here), else queued 10 s with Undo and then one plan POST.
 *    A command the engine cannot take is refused in the menu with the reason.
 *  - `/` as the FIRST token (S19a; slash-catalog): New job's catalog, the same entries, titles and
 *    categories, "Your top" first. A workflow or Apps pick starts HERE (ux-tonight): the card goes on the
 *    composer, the row under it asks for what it still needs, and Enter starts it into this chat
 *    (`InlineStart`). A document opens New document, chat a new chat, Add a repository its form; Demo
 *    video and Draft epics still open New job on their card. `/workflow-<key>` typed whole still names a
 *    workflow entry; the rest of the line is the intent.
 *  - studio#315: when the roster says no helper can take the message, Send is refused and says why.
 *
 * Typing never answers a question and never reshapes the chain: only a picked `/` command does.
 */
/** Whether `text` fits the box on one line, as rendered (a one-row box clips a wrapped placeholder's second line, and
 *  Chrome draws no ellipsis on a textarea's placeholder). True when it cannot be measured. */
export function placeholderFits(el: HTMLTextAreaElement, text: string): boolean {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext?.('2d') ?? null;
  if (ctx === null) return true;
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const room = el.clientWidth - (Number.parseFloat(cs.paddingLeft) || 0) - (Number.parseFloat(cs.paddingRight) || 0);
  return room <= 0 || ctx.measureText(text).width <= room;
}

/** A phone's one-row placeholder: the first clause (before a comma or dash), at most ~18 characters
 *  on a word boundary, with an ellipsis when anything was cut. */
export function shortPlaceholder(text: string, max = 18): string {
  const whole = text.trim();
  let first = whole.split(/,|\s—\s|\s-\s/)[0]?.trim() ?? whole;
  if (first.length > max) {
    const words = first.split(/\s+/);
    first = '';
    for (const w of words) {
      if ((first === '' ? w : `${first} ${w}`).length > max) break;
      first = first === '' ? w : `${first} ${w}`;
    }
  }
  return first.length < whole.length ? `${first}…` : whole;
}

/** One turn suggestion under the conversation: a label and what a click does. */
export interface ComposerSuggestion { id: string; label: string; title?: string; onPick: () => void }

export function Composer({
  composerKey, text, setText, onSend, runs = [], started = false, placeholder, ariaLabel, variant, className = '',
  inputRef, hint = false, footer = null, suggestions = [], navigate, contextProjectId = null, answerOnly = false, jobChatId = null,
}: {
  /** DES-CATALOG-002 §4.6 (Lane E2): the chat this composer stands in, live on the daemon. A job picked here is posted
   *  into it (`POST /chats/:id/proposals`); with none (the Desk, a fresh chat's page) it seeds a new chat. */
  jobChatId?: string | null;
  /** The box answers one thing (a job's bound reply, DES-CATALOG-002 §2.4): Send hands over the typed words alone —
   *  no workflow chip, `/` command or about-chip context starts or decorates anything. */
  answerOnly?: boolean;
  /** `desk`, or the session id. */
  composerKey: string;
  text: string;
  setText: (t: string) => void;
  onSend: (message: string, opts: ComposerSend) => void;
  /** The session's runs, oldest first (a `/` command acts on the newest live one). */
  runs?: readonly SessionView[];
  /** This composer's conversation already had its first send (a session with turns or runs). */
  started?: boolean;
  placeholder: string;
  ariaLabel: string;
  /** Which composer: the input and send keep their ids (`desk-composer-*`, `session-composer-*`). */
  variant: 'desk' | 'session';
  className?: string;
  inputRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  /** App-level route navigation (App.tsx's useRoute().navigate): a launched run opens its session. */
  navigate?: (path: string) => void;
  /** S19b: the quiet "Type / for workflows" line under the box (the Desk's) — hidden while the menu
   *  is open or a chip is present. */
  hint?: boolean;
  /** S19b: what sits beside the hint under the box (the Desk's Capture). */
  footer?: React.ReactNode;
  /** Turn suggestions: what this conversation could ask next ("Make a demo video of this"), one click each. Shown
   *  while the box is empty and no menu is open. */
  suggestions?: readonly ComposerSuggestion[];
  /** The project this composer's chat started in (a fresh chat's), used when no `@project` chip names one. */
  contextProjectId?: string | null;
}): React.ReactElement {
  const chips = useComposerChips((s) => chipsOf(s, composerKey));
  const roster = useRoster();
  const projects = useProjectsStore((s) => s.projects);
  const catalogState = usePlanCatalog((s) => s.catalog);
  const entries = usePlanCatalog((s) => s.entries);
  const catalog = useMemo(() => (catalogState === 'ready' ? entries.map((e) => e.id) : null), [catalogState, entries]);
  const { target, gateKey, title } = useDraftTarget(runs);
  const defs = useWorkflowDefs();
  const project = projectChip(chips);
  const presetsState = usePlanCatalog((s) => s.presets[project?.projectId ?? '']);
  const presets = Array.isArray(presetsState) ? presetsState : null;
  // A bound box (answerOnly) suspends any workflow it was about to start: its chip, blockers and Start are not in play.
  const wfChip = answerOnly ? null : (chips.find((c) => c.kind === 'workflow') as Extract<AboutChip, { kind: 'workflow' }> | undefined) ?? null;
  // Lane E2: a pick from the v2 `/` list is a job chip; Enter posts the person-made proposal, never a launch.
  const jobChip = wfChip !== null && wfChip.job === true ? wfChip : null;
  const cmdsOn = useCapabilities((s) => commandsOn(s));
  const startNote = useStartNotes((s) => s.notes[composerKey] ?? null);
  const askPathOn = useCapabilities((s) => s.askPath);
  const own = useRef<HTMLTextAreaElement | null>(null);
  // A one-row box on a phone shows only the placeholder's first clause, ended by an ellipsis —
  // never a sentence cut mid-word with no mark (UX audit row 32, the 390 px gate).
  const phone = usePhone();
  const box = inputRef ?? own;
  // Any width: when the whole placeholder does not fit on the one row (a run page with its panel open on a laptop),
  // the same first clause and ellipsis stand in, never a second line cut off (operator 2026-11-01).
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    let live = true;
    const check = (): void => { if (live) setRoomy(placeholderFits(el, placeholder)); };
    check();
    void document.fonts?.ready.then(check);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { live = false; ro.disconnect(); };
  }, [box, placeholder]);
  const [caret, setCaret] = useState(0);
  const [cursor, setCursor] = useState(0);
  /** The row the arrows moved to, by identity: a refresh that reorders the rows keeps it active (codex r1). */
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Lane E2: on a daemon with the v2 catalog, a line that starts with `/` is the command list's (the whole line filters
  // it; a command typed whole and followed by words closes it, and Enter posts the job).
  const v2Project = catalogProjectOf(project?.projectId ?? contextProjectId);
  const v2Load = useCatalogV2(v2Project, cmdsOn, text.trimStart().startsWith('/') || wfChip !== null);
  const v2View = v2Load.state === 'ready' ? v2Load.view : null;
  // The line as typed, less any leading blanks: ` /bug` is the same command line (pi r1 P1: a leading space must never fall
  // back to the v1 list and its launch on a capable daemon).
  const line = text.trimStart();
  const v2Line = cmdsOn && !answerOnly && wfChip === null && line.startsWith('/');
  // Which list a `/` opens is the daemon's to say: until its capabilities are read, neither list is offered (codex r1:
  // a v1 pick made before discovery would keep its launch path on a capable daemon).
  const capsLoaded = useCapabilities((s) => s.loaded);
  useEffect(() => {
    if (!capsLoaded && line.startsWith('/')) void useCapabilities.getState().load();
  }, [capsLoaded, line]);
  const [looks, setLooks] = useState<{ text: string; guess: ShapeGuess | null } | null>(null);
  const v2State = useMemo(
    () => (v2Line && v2View !== null ? commandList(v2View, line, null) : null),
    [v2Line, v2View, line],
  );
  const freeWords = v2State !== null && v2State.open ? v2State.freeWords : null;
  // The Looks like row: crew's words layer over free words (4 or more content words), words only, never a seat; the
  // rows are listed without waiting for it.
  useEffect(() => {
    if (freeWords === null || contentWords(freeWords) < 4) return undefined;
    let live = true;
    const t = setTimeout(() => {
      void looksLike(freeWords, v2Project).then((guess) => { if (live) setLooks({ text: freeWords, guess }); });
    }, LOOKS_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [freeWords, v2Project]);
  const cmdRows: CommandRow[] = useMemo(() => {
    if (!v2Line || v2View === null) return [];
    const st = commandList(v2View, line, looks !== null && looks.text === freeWords ? looks.guess : null);
    return st.open ? st.rows : [];
  }, [v2Line, v2View, line, looks, freeWords]);
  const v2Open = v2Line && (v2View === null || v2State?.open === true);
  const firstWord = line.slice(1).split(/\s/u)[0] ?? '';
  // The "Add a step" rows match a single word only: a line of words lists no step (`\u0000` matches none).
  const token = v2Line ? (v2Open ? { trigger: '/' as const, query: /\s/u.test(line) ? '\u0000' : firstWord, start: 0 } : null) : menuToken(text, caret);
  // A bound box takes `/` and `@` as the answer's own words: no command or helper menu opens, so none dispatches.
  const menuOpen = !answerOnly && token !== null && closedAt !== `${token.trigger}${token.start}`;
  useEffect(() => {
    if (menuOpen && token?.trigger === '/') loadCatalog();
  }, [menuOpen, token?.trigger]);
  useEffect(() => {
    if (menuOpen && token?.trigger === '/') loadPresets(project?.projectId ?? null);
  }, [menuOpen, token?.trigger, project?.projectId]);
  useEffect(() => {
    if (menuOpen && token?.trigger === '@' && useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load();
  }, [menuOpen, token?.trigger]);

  // UX audit row 24: a job started from a session defaults to the repository its work names.
  const sessionRepo = useMemo(
    () => [...runs].reverse().map((v) => v.session.repo_ref).find((r): r is string => typeof r === 'string' && r !== '') ?? null,
    [runs],
  );

  // `/workflow-<key>` rows lead the `/` menu only as a FIRST token (a named work), and only while no
  // workflow is already named (a second pick replaces the chip).
  const startCommands = token?.trigger === '/' && token.start === 0 && wfChip === null;
  // slash-catalog: the rows are New job's catalog for this box's project, read each time a `/` line starts.
  const catalogLoad = useWorkflowCatalog(catalogProjectOf(project?.projectId ?? contextProjectId), text.trimStart().startsWith('/') || wfChip !== null);
  const catalogView = useMemo(() => jobCatalogView(catalogLoad, defs, presets), [catalogLoad, defs, presets]);
  // An older daemon's list is today's workflows: still being read until they land.
  const wfCatalogState: 'loading' | 'error' | 'ready' = catalogLoad.state === 'error' ? 'error'
    : catalogLoad.state === 'loading' || (catalogLoad.state === 'unavailable' && defs === null) ? 'loading' : 'ready';
  const wfStateV2: 'loading' | 'error' | 'ready' = v2Load.state;
  const wf = useMemo(
    // On a capable daemon the v1 list is never offered: a `/` line is the command list's, or no list (pi r1 P1).
    () => (capsLoaded && !cmdsOn && startCommands && token !== null ? catalogRows(catalogView, token.query, Date.now()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startCommands, token?.query, catalogView, capsLoaded, cmdsOn],
  );
  const anyWorkflows = useMemo(() => (cmdsOn ? v2View !== null && allCommandRows(v2View).length > 0 : catalogRows(catalogView, '', Date.now()).length > 0), [catalogView, cmdsOn, v2View]);
  // ux-tonight: the card on this composer (its next Enter starts it here), read off the same catalog.
  const chipEntry = useMemo(() => {
    if (wfChip === null || wfChip.job === true || catalogView === null) return null;
    const byCard = wfChip.entryId === undefined ? undefined : catalogView.entries.find((e) => e.id === wfChip.entryId);
    const found = byCard ?? (wfChip.entryId === undefined ? workflowEntry(catalogView, wfChip.workflowId) : null);
    // A card a refresh retargeted (another workflow, another kind) is not the card picked: pick it again (codex r1).
    return found !== null && found.launchId === wfChip.workflowId && startsInline(found) ? found : null;
  }, [wfChip, catalogView]);
  const inline = useRef<InlineStartHandle | null>(null);
  const textNow = useRef(text);
  textNow.current = text;
  const [startBlocker, setStartBlocker] = useState<string | null>(null);
  const wordsOptional = chipEntry !== null && entryWords(chipEntry).optional;

  const slash: SlashItem[] = useMemo(
    () => (token?.trigger === '/' ? slashItems(token.query, target, catalog) : []),
    [token?.trigger, token?.query, target, catalog],
  );
  // B-P7: a running job whose steps are all crew's / estate's own tools needs no helper, so the
  // no-helper line is noise under its composer — an index + annotate run fine with nobody signed in.
  const liveRun = useMemo(() => [...runs].reverse().find((v) => !TERMINAL.has(v.session.status)) ?? null, [runs]);
  const jobHelperFree = useMemo(() => {
    if (liveRun === null) return false;
    const assigned = liveRun.units.map((u) => u.assigned_cli).filter((c): c is string => typeof c === 'string' && c !== '');
    return assigned.length > 0 && assigned.every((c) => !isHelperSeat(c));
  }, [liveRun]);
  // P7 (review r2): every send still needs a helper (a question about this job opens an Ask, which needs one), so the
  // refusal always gates Send. Under a helper-free job it says so plainly: the job itself is fine.
  const baseRefusal = composerSendRefusal(roster, project !== null);
  const refusal = baseRefusal !== null && jobHelperFree && project === null && wfChip === null
    ? { ...baseRefusal, line: 'This job runs without a helper. Asking about it needs one.' }
    : baseRefusal;
  // studio#631: which seats THIS send uses — the launch form's rule (every eligible seat, minus the
  // ones you turned off), shown and editable here. A workflow launch convenes the council seats; an
  // Ask's first send opens a chat with the seats the daemon would admit to it. A reply into a started
  // chat keeps that chat's seats, so the row is not offered there.
  // studio#840: a job keeps New job's own helper choice (the launch store), never the Ask row's: with a card on the
  // composer the row reads and writes that choice (ux-tonight), so what it shows is what the job launches with.
  const askDropped = useComposerSeats((s) => s.dropped);
  const askPicked = useComposerSeats((s) => s.picked);
  const askToggle = useComposerSeats((s) => s.toggle);
  const jobDropped = useLaunchSeats((s) => s.dropped);
  const jobPicked = useLaunchSeats((s) => s.picked);
  const jobToggle = useLaunchSeats((s) => s.toggle);
  const dropped = wfChip !== null ? jobDropped : askDropped;
  const picked = wfChip !== null ? jobPicked : askPicked;
  const toggleSeat = wfChip !== null ? jobToggle : askToggle;
  const eligibleSeats = useMemo(() => {
    if (roster === null) return [];
    // A handed-over Ask always opens SCOPED (the dock remounts per handoff, and its default scope is
    // the route's project or everything — only a manual `system` pick is unscoped), so the row reads
    // the scoped admission AskDock sends with (codex r1 on #631).
    // studio#686 (UX audit row 12): only seats a user may address — never the judge seat or a
    // non-CLI helper — so the helpers row and the `@` menu offer the same list under one name each.
    const addressable = new Set(userSeats(roster).map((s) => s.key));
    const keys = wfChip !== null ? roster.filter((s) => s.enabled_for_council).map((s) => s.key) : defaultSelection(roster, true);
    return keys.filter((k) => addressable.has(k));
  }, [roster, wfChip]);
  const ats: AtItem[] = useMemo(() => {
    if (token?.trigger !== '@') return [];
    const q = token.query.toLowerCase();
    // A project row carries its own description (when it has one); the group header says what a pick does.
    const p: AtItem[] = (projects ?? []).map((x) => ({ kind: 'project', id: x.id, label: x.name, line: (x.description ?? '').trim() }));
    // The helpers this send can use (the helpers row's list, in roster order), named by `seatLabel`.
    const h: AtItem[] = eligibleSeats.flatMap((key) => {
      const seat = (roster ?? []).find((s) => s.key === key);
      return seat === undefined ? [] : [{ kind: 'helper' as const, id: seat.key, label: seatLabel(seat), line: '' }];
    });
    return [...p, ...h].filter((x) => x.label.toLowerCase().startsWith(q) || x.id.toLowerCase().startsWith(q)).slice(0, 8);
  }, [token?.trigger, token?.query, projects, roster, eligibleSeats]);
  const lead = cmdsOn ? cmdRows.length : wf.length;
  const count = token?.trigger === '/' ? lead + slash.length : ats.length;
  const rowKeys = token?.trigger === '/'
    ? [...(cmdsOn ? cmdRows.map((r) => r.key) : wf.map((r) => `e:${r.entry.id}`)), ...slash.map((it) => `s:${it.command.cmd}`)]
    : ats.map((it) => `a:${it.kind}:${it.id}`);
  const keyedAt = cursorKey === null ? -1 : rowKeys.indexOf(cursorKey);
  const active = count === 0 ? 0 : keyedAt >= 0 ? keyedAt : Math.min(cursor, count - 1);
  const moveCursor = (i: number): void => { setCursor(i); setCursorKey(rowKeys[i] ?? null); };
  // Shown while a send is being composed (words typed, or a workflow named) — an idle Desk keeps its
  // fold (the desk_home fit), and the row is there whenever there is something to send.
  // A send opens a chat before the first send, and after it whenever an `@project` chip starts a
  // fresh session there (`fresh: started` below) — both take the row's seats (codex r2 on #631).
  const opensChat = !started || project !== null;
  // While the `@` menu is open it already lists these helpers: the row steps aside, so one list shows
  // and the menu sits on the box (S3 UX gate, codex r2).
  const atMenuOpen = menuOpen && token?.trigger === '@';
  // Whether the seat rules apply to this send — independent of whether the row is on screen, so an
  // open `@` menu never lets a send past the refusals below (codex r2 on S3).
  // A new app is made by crew's own helpers (the app's turn): no helpers row for it.
  // A command typed whole on a capable daemon is a job, like a picked one (pi r2): no seat row, no seat refusal.
  const commandLine = v2Line && v2View !== null && parseCommandLine(v2View, line) !== null;
  const seatsApply = !answerOnly && jobChip === null && !commandLine && eligibleSeats.length > 0 && ((wfChip !== null && chipEntry?.launchKind !== 'app') || (wfChip === null && opensChat && text.trim() !== ''));
  // The command list stands in the same place: while it is open over a `/` line the row steps aside (one list shows).
  const showSeats = seatsApply && !atMenuOpen && !v2Line;
  // A job's helpers (New job's J4 rule, codex r1 on #982): one that cannot take work now (signed out, benched) is off
  // unless turned on by hand, and the row shows exactly what the launch sends.
  const unusable = useMemo(() => new Set(wfChip === null ? [] : (roster ?? []).flatMap((s) => {
    const st = seatStanding(s);
    return st.state === 'ready' || st.state === 'unknown' ? [] : [s.key];
  })), [wfChip, roster]);
  const isOffSeat = (key: string): boolean => (unusable.has(key) ? !picked.includes(key) : seatOff(key, dropped, picked));
  const sendSeats = wfChip === null ? chosenSeats(eligibleSeats, dropped, picked) : eligibleSeats.filter((k) => !isOffSeat(k));
  // An `@helper` named to answer (ASK-S1) but turned off in the row would be silently dropped as the
  // chat's primary — refused instead, by name (codex r1 on #631).
  const namedHelper = wfChip === null && opensChat && askPathOn
    ? chips.find((c) => c.kind === 'about' && c.key.startsWith('h:'))
    : undefined;
  const namedDropped = namedHelper !== undefined && seatOff(namedHelper.key.slice(2), dropped, picked);
  // B-C6b: when NO helper can be turned on (the roster refusal already stands), never tell the person
  // to "turn one on in the helpers row" — the one line + Sign-one-in link says it. NO_SEAT_PICKED is only
  // for when a helper COULD be turned on but every one was dropped.
  const seatRefusal = !seatsApply || refusal !== null ? null
    : sendSeats.length === 0 ? NO_SEAT_PICKED
      : namedDropped ? `${namedHelper?.label ?? 'The helper you named'} is named to answer but is left out of the helpers row — turn it on, or remove the chip.`
        : null;
  const [jobBusy, setJobBusy] = useState(false);
  const jobBusyRef = useRef(false);

  const canSend = answerOnly ? text.trim() !== ''
    // A job's proposal is not a message to a seat: the seat refusals do not gate it (crew's proposal names its seats).
    : jobChip !== null || commandLine ? !jobBusy
      : (text.trim() !== '' || (wfChip !== null && wordsOptional)) && refusal === null && seatRefusal === null
        && (wfChip === null || startBlocker === null);

  const syncCaret = (el: HTMLTextAreaElement): void => setCaret(el.selectionStart ?? el.value.length);
  const focusEnd = (value: string): void => {
    requestAnimationFrame(() => {
      const el = box.current;
      if (el === null) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
      setCaret(value.length);
    });
  };

  // S19b: a seed a command left for THIS composer (⌘K "New Build" → `/workflow-`) is taken once —
  // the words land, the box is focused with the caret at the end, so a `/` seed opens the menu.
  const seeded = useComposerSeed((s) => s.seed !== null && s.seed.composerKey === composerKey);
  useEffect(() => {
    if (!seeded) return;
    const words = takeComposerSeed(composerKey);
    if (words === null) return;
    setText(words);
    setClosedAt(null);
    setCursor(0);
    setCursorKey(null);
    setNote(null);
    focusEnd(words);
    // focusEnd/setText are this render's closures; the seed is read at its edge only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded, composerKey]);

  const pickSlash = (item: SlashItem): void => {
    if (token === null) return;
    if (item.refused !== null) { setNote(item.refused); return; }
    const next = dropToken(text, token.start, caret);
    setText(next);
    focusEnd(next);
    const catalogId = item.command.catalog;
    if (catalogId === null) return;
    const word = wordOf(catalogId);
    if (target.kind === 'gate-amend' && gateKey !== null) {
      addGateDraftStep(target.runId, gateKey, target.seed, catalogId);
      setNote(`${word} is on the plan’s card: approve it there to send it. Nothing has been sent.`);
    } else if (target.kind === 'mid-run') {
      queueMidRunStep(target.runId, catalogId, title);
      setNote(`Adding ${word} — Undo within 10 s. After that it stays: a running plan only grows.`);
    }
  };
  const pickAt = (item: AtItem): void => {
    if (token === null) return;
    const next = dropToken(text, token.start, caret);
    setText(next);
    focusEnd(next);
    const chip: AboutChip = item.kind === 'project'
      ? { kind: 'project', key: `p:${item.id}`, label: item.label, projectId: item.id }
      : { kind: 'about', key: `h:${item.id}`, label: item.label };
    addAboutChip(composerKey, chip);
    // UX audit row 72: the chip already says where the message goes ("in: <project>"), so the note
    // speaks only when it adds something — a fresh session, or who answers.
    setNote(item.kind === 'project'
      ? (started ? `Your next message starts a new session in ${item.label}.` : null)
      : (!started && useCapabilities.getState().askPath ? `${item.label} will answer this conversation.` : null));
  };
  // A pick starts what New job's card starts (slash-catalog): a workflow, Demo video or Draft epics opens
  // the one modal on that card, prefilled with what this composer knows — the words so far, its project
  // chip, the session's repository; a document opens New document with the words as its brief; chat
  // opens a new chat with them. Nothing is sent from here.
  const startEntry = (entry: CatalogEntry, words: string): void => {
    const intent = words.trim();
    const projectId = project?.projectId ?? contextProjectId;
    // ux-tonight (operator 2026-11-04: "clicking on a workflow opens a modal rather than starting an inline chat"):
    // a workflow or a new app starts HERE. The card goes on this composer, the words stay in the box, and the row
    // under it asks for what the start still needs; Enter starts it into this chat. Nothing is sent on the pick.
    if (entryOffered(entry) && startsInline(entry)) {
      addAboutChip(composerKey, workflowChipFor(entry));
      setText(intent);
      setNote(null);
      setClosedAt(null);
      focusEnd(intent);
      return;
    }
    startCatalogEntry(entry, {
      projectId, intent, navigate: navigate ?? goToPath,
      shape: (e) => openLaunchWizard({ workflowId: e.launchId, catalogEntryId: e.id, intent, projectId, composerKey, contextRepo: sessionRepo }),
    });
    setText('');
    setNote(null);
  };
  const pickWorkflow = (item: CatalogRow): void => {
    if (token === null) return;
    // Shown as New job shows it (coming soon, not available), never started.
    if (!item.offered) { setNote(notOfferedLine(item.entry)); return; }
    startEntry(item.entry, dropToken(text, token.start, caret));
  };
  // Lane E2: a v2 row goes on the composer as the job chip, exactly as picked (card, option, depth); free words typed
  // in the line stay as the job's words. Nothing is sent until Enter. A Yours row starts by its workflow (ux-tonight).
  const pickCommand = (row: CommandRow): void => {
    if (row.kind === 'yours') {
      const known = workflowEntry(catalogView, row.launchId);
      if (known === null || !entryOffered(known)) { setNote(known === null ? `${row.title} is not listed now.` : notOfferedLine(known)); return; }
      startEntry(known, freeWords ?? '');
      return;
    }
    const words = freeWords ?? '';
    addAboutChip(composerKey, jobChipFor({
      card: row.card, wireCard: row.kind === 'alias' && row.command !== null ? row.command : row.card,
      option: row.option, depth: row.depth, title: row.title, launchId: row.launchId,
    }));
    setStartNote(composerKey, null);
    setText(words);
    setNote(null);
    setClosedAt(null);
    focusEnd(words);
  };
  const pick = (i: number): void => {
    if (token?.trigger === '/') {
      if (i < lead) { if (cmdsOn) { const r = cmdRows[i]; if (r !== undefined) pickCommand(r); } else { const it = wf[i]; if (it !== undefined) pickWorkflow(it); } }
      else { const it = slash[i - lead]; if (it !== undefined) pickSlash(it); }
    } else { const it = ats[i]; if (it !== undefined) pickAt(it); }
  };


  const send = (): void => {
    if (answerOnly) {
      if (text.trim() === '') return;
      onSend(text, {});
      return;
    }
    // Lane E2 (§4.6, §8.4): a job chip, or a command typed whole, posts the person-made proposal: into this chat, or as
    // a new chat's seed. Never a launch route.
    if (jobChip !== null) {
      void sendJob({ card: jobChip.card ?? jobChip.entryId ?? '', option: jobChip.option ?? null, depth: jobChip.depth ?? null, words: text, source: 'pick', pickKey: jobChip.key, chipKey: jobChip.key });
      return;
    }
    // A `/` line before the daemon's capabilities are read is held: which list and which path is the daemon's to say.
    if (!capsLoaded && line.startsWith('/')) { setNote(WORKFLOWS_LOADING_LINE); return; }
    if (cmdsOn && line.startsWith('/')) {
      // A command line is held until the catalog can read it (codex r1): never sent as a chat message meanwhile.
      if (v2View === null) { setNote(v2Load.state === 'error' ? WORKFLOWS_FAILED_LINE : WORKFLOWS_LOADING_LINE); return; }
      const hit = parseCommandLine(v2View, line);
      if (hit !== null) {
        if (hit.refused !== null) { setNote(hit.refused); return; }
        void sendJob({ card: hit.wireCard, option: hit.option, depth: hit.depth, words: hit.words, source: 'command', pickKey: cmdKeyOf(composerKey), chipKey: null, renewCmd: true });
        return;
      }
      const old = parseWorkflowCommand(line);
      if (old !== null) { setNote(`This daemon lists no job with the command /workflow-${old.key}. Nothing was sent.`); return; }
    }
    // A `/workflow-<key>` line typed whole (menu closed, a paste): Enter NAMES it — the options row
    // then asks for the repository. Nothing is sent until the next Enter.
    const typed = cmdsOn ? null : parseWorkflowCommand(text);
    if (typed !== null && refusal === null) {
      // Only a workflow the catalog lists is started — studio keeps no list and never invents a name.
      const known = workflowEntry(catalogView, typed.key);
      if (known === null) {
        setNote(wfCatalogState === 'loading' ? WORKFLOWS_LOADING_LINE : wfCatalogState === 'error' ? WORKFLOWS_FAILED_LINE
          : `This daemon lists no workflow named ${typed.key} — nothing was sent.`);
        return;
      }
      if (!entryOffered(known)) { setNote(notOfferedLine(known)); return; }
      startEntry(known, typed.rest);
      return;
    }
    if (wfChip !== null) {
      if (refusal !== null || seatRefusal !== null) return;
      const words = text;
      // Only the words that were started leave the box: anything typed since stays (codex r2).
      void inline.current?.start(words).then((ok) => { if (ok && textNow.current === words) { setText(''); setNote(null); } });
      return;
    }
    if (!canSend) return;
    // ASK-S1: a helper named with `@` before the first send answers this conversation. studio#631: the
    // chip picks WHO answers — it no longer prefixes the question with "About <helper>:", which
    // re-framed it as a question about the helper (and titled the session that way).
    const helper = opensChat && askPathOn ? chips.find((c) => c.kind === 'about' && c.key.startsWith('h:')) : undefined;
    const message = messageWithAbout(text, helper === undefined ? chips : chips.filter((c) => c !== helper));
    // The artifact the message is about: a chip names it, else the one this composer's surface shows (full screen,
    // its pane, its newest card).
    const shown = inViewFor(composerKey);
    const artifact = artifactOfChips(chips) ?? (shown !== null ? { ref: shown.ref, anchors: [] } : null);
    onSend(message, {
      ...(project === null ? {} : { projectId: project.projectId, fresh: started }),
      ...(helper !== undefined ? { primary: helper.key.slice(2) } : {}),
      ...(artifact !== null ? { artifact: { ...artifact, composerKey } } : {}),
    });
    clearAboutChips(composerKey);
    setText('');
    setNote(null);
  };

  const sendJob = async (j: { card: string; option: string | null; depth: 'quick' | 'standard' | 'deep' | null; words: string; source: 'pick' | 'command'; pickKey: string; chipKey: string | null; renewCmd?: boolean }): Promise<void> => {
    // A ref, not the render's state: two Enters before a re-render post once (pi r1).
    if (jobBusyRef.current) return;
    jobBusyRef.current = true;
    setJobBusy(true);
    setNote(null);
    setStartNote(composerKey, null);
    const sentWords = text;
    try {
      const out = await postJob({
        card: j.card, option: j.option, depth: j.depth, words: j.words, source: j.source,
        // An `@project` chip names where the job goes: a new chat in that project, never this chat (codex r1).
        chatId: project !== null ? null : jobChatId,
        projectId: project?.projectId ?? contextProjectId, repoRef: project !== null ? null : sessionRepo, pickKey: j.pickKey,
        // F41: a new chat's job that takes a repository opens on the one its words name.
        repoFromWords: takesRepo(v2View, j.card, j.option),
      });
      // Not posted (the person went elsewhere first): the draft, its chip and its request stay for a retry (codex r7).
      if (out === null) return;
      // The draft this post came from still owns the box only if its pick (or its command key) is still the one there
      // and its words are unchanged: a replacement pick with the same words is not cleared (codex r2).
      const owned = j.chipKey !== null
        ? chipsOf(useComposerChips.getState(), composerKey).some((c) => c.key === j.chipKey)
        : cmdKeys.get(composerKey) === j.pickKey && !chipsOf(useComposerChips.getState(), composerKey).some((c) => c.kind === 'workflow');
      // A typed command posted is spent: the next one is its own request (codex r1).
      if (j.renewCmd === true && cmdKeys.get(composerKey) === j.pickKey) renewCmdKey(composerKey);
      if (j.chipKey !== null) removeAboutChip(composerKey, j.chipKey);
      if (owned && textNow.current === sentWords) setText('');
    } catch (e) {
      setStartNote(composerKey, `Nothing was started: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      jobBusyRef.current = false;
      setJobBusy(false);
    }
  };

  return (
    <div className={`wk-composer ${className}`} data-testid="composer" data-composer={composerKey}>
      {menuOpen && token !== null && (
        <SlashMenu
          menuKey={composerKey}
          trigger={token.trigger}
          startCommands={startCommands}
          catalogState={!capsLoaded ? 'loading' : cmdsOn ? wfStateV2 : wfCatalogState}
          anyWorkflows={anyWorkflows}
          wf={wf}
          {...(cmdsOn ? { cmds: cmdRows, onPickCommand: pickCommand } : {})}
          slash={slash}
          ats={ats}
          {...(!started && askPathOn ? { helpersHead: 'Helpers · the one you pick answers' } : {})}
          atLoading={token.trigger === '@' && roster === null && (projects ?? []).length === 0}
          active={active}
          onPickWorkflow={pickWorkflow}
          onPickSlash={pickSlash}
          onPickAt={pickAt}
        />
      )}
      {(chips.length > 0 || note !== null || refusal !== null || startNote !== null) && (
        <div className="wk-composer-chips">
          {chips.map((c) => (
            <span key={c.key} data-testid="composer-chip" data-kind={c.kind} data-key={c.key} className="wk-composer-chip" title={c.kind === 'project' ? 'Where your next message goes' : c.kind === 'workflow' ? (c.job === true ? 'The job Enter puts in the chat' : 'The workflow this starts') : 'Your next message is about this'}>
              {chipText(c)}
              <button type="button" data-testid="composer-chip-remove" aria-label={`Remove ${chipText(c)}`} onClick={() => { removeAboutChip(composerKey, c.key); box.current?.focus(); }} className="wk-composer-chip-x">×</button>
            </span>
          ))}
          {refusal !== null && (
            <span data-testid="composer-refused" role="status" className="wk-composer-note wk-composer-note--bad">
              {refusal.line}
              {refusal.signIn && (
                <>
                  {' '}
                  <a
                    href={AGENTS_PATH}
                    data-testid="composer-refused-signin"
                    className="wk-link"
                    onClick={(e) => {
                      if (navigate === undefined || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      navigate(AGENTS_PATH);
                    }}
                  >
                    {SIGN_ONE_IN}
                  </a>
                </>
              )}
              {refusal.reasons.length > 0 && (
                <details data-testid="composer-refused-why" className="wk-composer-why">
                  <summary>Details</summary>
                  {refusal.reasons.map((r) => <span key={r} className="wk-composer-why-row">{r}</span>)}
                </details>
              )}
            </span>
          )}
          {/* A command's own answer shows even beside a seat refusal: it is the reason that applies (pi r2). */}
          {note !== null && (refusal === null || commandLine || jobChip !== null) && <span data-testid="composer-note" role="status" className="wk-composer-note">{note}</span>}
          {jobChip !== null && refusal === null && (
            <span data-testid="composer-job-line" role="status" className="wk-composer-note">
              {jobBusy ? 'Putting the job in the chat…' : 'Enter puts this job in the chat for you to look over. Nothing runs until you press Start.'}
            </span>
          )}
          {startNote !== null && <span data-testid="composer-start-note" role="alert" className="wk-composer-note wk-composer-note--bad">{startNote}</span>}
        </div>
      )}
      {showSeats && (
        <div data-testid="composer-seats" role="group" aria-label="Helpers this send uses" className="wk-composer-chips">
          <span className="wk-composer-note">Helpers</span>
          {eligibleSeats.map((key) => {
            const on = !isOffSeat(key);
            const seat = (roster ?? []).find((s) => s.key === key);
            const name = seat === undefined ? seatLabel({ key }) : seatLabel(seat);
            return (
              <button
                key={key}
                type="button"
                data-testid="composer-seat"
                data-key={key}
                aria-pressed={on}
                title={on ? `${name} takes part — click to leave it out` : `${name} is left out — click to include it`}
                onClick={() => toggleSeat(key, unusable.has(key))}
                className={`wk-composer-chip wk-composer-seat${on ? '' : ' wk-composer-seat--off'}`}
              >
                {name}
              </button>
            );
          })}
          {seatRefusal !== null && <span data-testid="composer-seats-refused" role="status" className="wk-composer-note wk-composer-note--bad">{seatRefusal}</span>}
        </div>
      )}
      {wfChip !== null && jobChip === null && (
        <InlineStart
          composerKey={composerKey}
          entry={chipEntry}
          catalogState={wfCatalogState}
          sessionRepo={sessionRepo}
          projectId={project?.projectId ?? contextProjectId}
          seatKeys={sendSeats}
          words={text}
          navigate={navigate ?? goToPath}
          handle={inline}
          onBlocker={setStartBlocker}
        />
      )}
      {suggestions.length > 0 && text === '' && !menuOpen && wfChip === null && (
        <div data-testid="composer-suggestions" role="group" aria-label="Suggestions" className="wk-composer-chips">
          {suggestions.map((sg) => (
            <button key={sg.id} type="button" data-testid="composer-suggestion" data-id={sg.id} title={sg.title}
              onClick={sg.onPick} className="wk-composer-chip wk-composer-suggestion">{sg.label}</button>
          ))}
        </div>
      )}
      <form className="wk-desk-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={box}
          data-testid={variant === 'desk' ? 'desk-composer-input' : 'session-composer-input'}
          data-type-target="page"
          aria-label={ariaLabel}
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? `composer-menu-list-${composerKey}` : undefined}
          aria-activedescendant={menuOpen && count > 0 ? `composer-menu-option-${composerKey}-${active}` : undefined}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value); syncCaret(e.target); setCursor(0); setCursorKey(null); if (note !== null && e.target.value !== '') setNote(null);
            // studio#623 (#620's launch-form rule): an Escape closes THIS token's menu; once that token
            // is gone (or the caret is in another one), a new `/` or `@` opens the menu again.
            // A v2 command line is one token (the whole line): an Escape keeps it closed while the line is a `/` line.
            const tok = cmdsOn && wfChip === null && e.target.value.startsWith('/') ? { trigger: '/' as const, start: 0 } : menuToken(e.target.value, e.target.selectionStart ?? e.target.value.length);
            if (tok === null || `${tok.trigger}${tok.start}` !== closedAt) setClosedAt(null);
          }}
          onSelect={(e) => syncCaret(e.currentTarget)}
          onKeyDown={(e) => {
            // An IME confirming its composition with Enter picks nothing and sends nothing (codex on S7).
            if (e.nativeEvent.isComposing) return;
            if (menuOpen && count > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor((active + 1) % count); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor((active - 1 + count) % count); return; }
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pick(active); return; }
            }
            if (menuOpen && e.key === 'Escape' && token !== null) { e.preventDefault(); e.stopPropagation(); setClosedAt(`${token.trigger}${token.start}`); return; }
            if (e.key === 'Backspace' && text === '' && backspaceAboutChip(composerKey, text)) { e.preventDefault(); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={jobChip !== null ? 'Add words for the job, or press Enter' : wfChip !== null ? (chipEntry !== null ? entryWords(chipEntry).label : 'Describe the work to start') : phone || !roomy ? shortPlaceholder(placeholder) : placeholder}
          className="wk-desk-input"
        />
        <VoiceMicButton size="xs" testId={variant === 'desk' ? 'desk-composer-voice' : 'session-composer-voice'} focus={variant === 'session' ? runs[runs.length - 1]?.session.id ?? null : null} />
        <button type="submit" data-testid={variant === 'desk' ? 'desk-composer-send' : 'session-composer-send'} aria-label={jobChip !== null ? 'Put the job in the chat' : wfChip !== null ? 'Start' : 'Send'} disabled={!canSend} className="wk-desk-send">↑</button>
      </form>
      {(hint || footer !== null) && (
        <div className="wk-composer-foot">
          {hint && !menuOpen && chips.length === 0 && (
            <p data-testid="composer-hint" className="wk-composer-hint">Type <kbd>/</kbd> for workflows</p>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
