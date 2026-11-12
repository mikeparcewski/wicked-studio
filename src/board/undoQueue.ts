import { create } from 'zustand';
import type { GateDecision } from '../api/types.js';

/**
 * Preview, then commit, with an undo window (studio wave 2a, behaviour 5).
 *
 * A gate decision (approve, reject, batch) is not POSTed when the operator commits it: it
 * is QUEUED here for {@link UNDO_WINDOW_MS}, with an inline Undo, and the POST goes out only
 * when the window ends. Undo cancels it: nothing is sent and the gate stays open.
 *
 * The queue lives in page memory on purpose. Closing (or reloading) the tab inside the window
 * drops the timer with the page, so the decision is NOT sent and the gate stays open. No
 * `sendBeacon`, no `beforeunload` flush: a decision the operator could not see land must
 * not land. The inline block says so ({@link CLOSE_NOTE}).
 *
 * This module is the behaviour: the store, the timers, the copy, and which on-screen block shows
 * each decision. Components only render it (`InlineUndo`, in the block where the action was taken —
 * studio 0.16.4 removed the floating toast); callers (`decideGate`, `runBatchDecision`, `stopRun`…)
 * queue through it.
 *
 * KEYS say what a decision (and its result) is about, so a block shows only its own:
 * `gate:<run>` (a gate answer or reassign), `stop:<run>`, `plan:<run>` (a mid-run plan step),
 * `power:<run>`, `batch`, `memory-accept`. Every block that hosts a key registers while mounted
 * (`registerUndoHost`); ONE of them owns each decision — the block it was taken in, else the first
 * in document order — and the others show a quiet "waiting to send" line (one Undo per decision).
 */

export const UNDO_WINDOW_MS = 10_000;

/** `edit-plan`: a mid-run plan step from the composer's `/` (S7) — queued the same way, never a gate answer. */
export type DecisionVerb = 'approve' | 'reject' | 'request-changes' | 'edit-plan' | 'stop';

export interface PendingDecision {
  id: number;
  verb: DecisionVerb;
  /** What the decision is about (see the module note): the blocks that host one of these show it. */
  keys: string[];
  /** The kind of block it was taken in (`data-undo-host` at the moment it was queued); null = not in one. */
  origin: string | null;
  /** That block itself, so of several blocks of one kind (two approval groups) the one acted in shows it. */
  originEl?: Element;
  /** The runs this decision answers — one for a single gate, N for a batch. */
  runIds: string[];
  /** Which gate, in words: "the plan for “Fix the double charge”" (`gateLabel`); null for a batch. */
  label: string | null;
  /** The note riding the decision, if any — handed back on Undo so it is never lost. */
  amend: string | null;
  /** The "what will happen" line (see {@link decisionPreview}). */
  preview: string;
  /** Epoch ms at which the decision was committed. */
  queuedAt: number;
  /** Epoch ms at which the POST goes out. */
  dueAt: number;
  /** The page-close contract for this decision, when it is not a gate's ({@link CLOSE_NOTE}). */
  closeNote?: string;
}

/**
 * How a decision ENDED, kept briefly so the outcome is visible whichever surface is mounted: it
 * went out, it failed, or it was not sent (the gate was answered elsewhere, a new gate opened, or
 * the gate already had a decision). Never silent.
 */
export interface DecisionResult {
  id: number;
  kind: 'sent' | 'failed' | 'not-sent';
  text: string;
  at: number;
  /** The blocks that may show it (the decision's keys). */
  keys: string[];
  /** The block kind its decision was taken in, so it lands where the Undo was. */
  origin: string | null;
  originEl?: Element;
  /** When a block first showed it. A sent / not-sent result goes {@link RESULT_TTL_MS} after that; a failure
   *  stays until it is dismissed. Unset = nobody has seen it yet, so it waits for a block to mount. */
  shownAt?: number;
  /** The failure is crew's refusal because QE acceptance is required: the result links to the setting. */
  qe?: true;
}

/** How long a result stays on screen. */
export const RESULT_TTL_MS = 8_000;

interface UndoQueueStore {
  pending: PendingDecision[];
  results: DecisionResult[];
  /** Bumped when a hosting block mounts or unmounts, so the blocks re-decide which one owns a decision. */
  hostsRev: number;
  /** Notes handed back by an Undo, keyed by run id (or `batch`), until a surface re-seeds from them. */
  restoredNotes: Record<string, string>;
}

export const useUndoQueue = create<UndoQueueStore>(() => ({ pending: [], results: [], hostsRev: 0, restoredNotes: {} }));

let nextResultId = 1;

/** At most this many results nobody has seen are kept (the oldest go first), so results nobody comes back for stay
 *  bounded. Results a block has shown are not counted: a shown failure stays until it is dismissed. */
export const RESULT_CAP = 50;

/** The block the latest decision on each key was taken in — a result lands where its Undo was. */
const originByKey = new Map<string, Origin>();

/** Record an outcome. It shows inline on a block hosting one of `keys`; it is never on a timer until seen. */
export function reportDecision(
  kind: DecisionResult['kind'], text: string, opts: { keys: readonly string[]; qe?: boolean },
): void {
  const id = nextResultId++;
  const keys = [...opts.keys];
  const o = keys.map((k) => originByKey.get(k)).find((x) => x !== undefined) ?? NO_ORIGIN;
  const result: DecisionResult = {
    id, kind, text, at: Date.now(), keys, origin: o.name, ...(o.el !== undefined ? { originEl: o.el } : {}),
    ...(opts.qe === true ? { qe: true as const } : {}),
  };
  useUndoQueue.setState((s) => {
    // A sent outcome on a run settles that run's earlier failure (the person retried it and it went out). Only run keys
    // count: an unrelated batch or accept never clears another one's failure.
    // Settled means every run it was about went out now: a batch's failure is not settled by one member's success.
    const runKeys = kind === 'sent' ? keys.filter((k) => runOfKey(k) !== null) : [];
    const settles = (r: DecisionResult): boolean => {
      const its = r.keys.filter((k) => runOfKey(k) !== null);
      return its.length > 0 && its.every((k) => runKeys.includes(k));
    };
    let results = runKeys.length === 0 ? s.results : s.results.filter((r) => r.kind !== 'failed' || !settles(r));
    results = [...results, result];
    // Bounded: at most RESULT_CAP results nobody has seen yet (the oldest go first). A shown failure stays until it is
    // dismissed, whatever comes after it.
    const unseen = results.filter((r) => r.shownAt === undefined);
    if (unseen.length > RESULT_CAP) {
      const drop = new Set(unseen.slice(0, unseen.length - RESULT_CAP).map((r) => r.id));
      results = results.filter((r) => !drop.has(r.id));
    }
    return { results };
  });
}

/** A block showed a result: a sent / not-sent one goes after {@link RESULT_TTL_MS}; a failure stays until dismissed. */
export function markResultShown(id: number): void {
  const r = useUndoQueue.getState().results.find((x) => x.id === id);
  if (r === undefined || r.shownAt !== undefined) return;
  useUndoQueue.setState((s) => ({ results: s.results.map((x) => (x.id === id ? { ...x, shownAt: Date.now() } : x)) }));
  if (r.kind === 'failed') return;
  setTimeout(() => {
    // A result whose link has keyboard focus stays until focus leaves it (releaseResult).
    if (heldResults.has(id)) { expiredResults.add(id); return; }
    dropResult(id);
  }, RESULT_TTL_MS);
}

/** Dismiss a result (a failure's Dismiss button). */
export function dismissResult(id: number): void {
  heldResults.delete(id);
  expiredResults.delete(id);
  dropResult(id);
}

function dropResult(id: number): void {
  useUndoQueue.setState((s) => ({ results: s.results.filter((r) => r.id !== id) }));
  pruneOrigins();
}

/** Forget the origin block of every key no queued decision or kept result is about (no detached card kept alive). */
function pruneOrigins(): void {
  const s = useUndoQueue.getState();
  const live = new Set<string>();
  for (const x of [...s.pending, ...s.results]) for (const k of x.keys) live.add(k);
  for (const k of [...originByKey.keys()]) if (!live.has(k)) originByKey.delete(k);
}

const heldResults = new Set<number>();
const expiredResults = new Set<number>();

/** Focus entered a result (its Settings link): it is not taken away while focus is in it. */
export function holdResult(id: number): void {
  heldResults.add(id);
}

/** Focus left a result: one that outlived its time while held goes now. */
export function releaseResult(id: number): void {
  heldResults.delete(id);
  if (!expiredResults.delete(id)) return;
  dropResult(id);
}

/** Hand a note back after an Undo. */
export function restoreNote(key: string, text: string): void {
  if (text.trim() === '') return;
  useUndoQueue.setState((s) => ({ restoredNotes: { ...s.restoredNotes, [key]: text } }));
}

/** Take (and clear) a note handed back by an Undo — the surface re-seeds its input with it. */
export function takeRestoredNote(key: string): string {
  const text = useUndoQueue.getState().restoredNotes[key] ?? '';
  if (text !== '') {
    useUndoQueue.setState((s) => {
      const restoredNotes = { ...s.restoredNotes };
      delete restoredNotes[key];
      return { restoredNotes };
    });
  }
  return text;
}

interface Handle {
  timer: ReturnType<typeof setTimeout>;
  commit: () => Promise<void> | void;
  onUndo: (() => void) | undefined;
  onCancel: ((reason: string) => void) | undefined;
}

const handles = new Map<number, Handle>();
let nextId = 1;

function remove(id: number): void {
  handles.delete(id);
  useUndoQueue.setState((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
}

export interface QueueSpec {
  verb: DecisionVerb;
  runIds: string[];
  /** What it is about (see the module note); its results carry the same keys. */
  keys: readonly string[];
  preview: string;
  label?: string | null;
  amend?: string | null;
  /** The page-close line, when the decision is not a gate's (defaults to {@link CLOSE_NOTE}). */
  closeNote?: string;
  /** Sends the decision — runs exactly once, when the window ends, unless undone or cancelled. */
  commit: () => Promise<void> | void;
  /** Runs when the operator undoes the decision (release per-gate "queued" state). */
  onUndo?: () => void;
  /** Runs when the WORLD cancels it (the gate left or changed); defaults to `onUndo`. */
  onCancel?: (reason: string) => void;
}

let windowOverride: number | null = null;

/** Tests that exercise the SEND path (not the window) shorten it; null restores 10 s. */
export function setUndoWindowForTest(ms: number | null): void {
  windowOverride = ms;
}

/** Queue a decision; returns its id (the Undo handle). */
export function queueDecision(spec: QueueSpec): number {
  const id = nextId++;
  const windowMs = windowOverride ?? UNDO_WINDOW_MS;
  const keys = [...spec.keys];
  const origin = originHere();
  pruneOrigins(); // the keys nothing refers to any more (decisions undone, results gone) — before this one's are set
  for (const k of keys) originByKey.set(k, origin);
  const timer = setTimeout(() => {
    const h = handles.get(id);
    if (h === undefined) return; // undone in the same tick
    // Sent only once its countdown and Undo were on screen (a last look now, should the page have been too busy for
    // the earlier one). Without a shell (a bare test harness) there is nothing to look at.
    if (hostlessHandler !== null && !seenDecisions.has(id) && !shownNow(id)) { cancelDecision(id, NOT_SHOWN); return; }
    seenDecisions.delete(id);
    remove(id);
    void h.commit();
  }, windowMs);
  handles.set(id, { timer, commit: spec.commit, onUndo: spec.onUndo, onCancel: spec.onCancel });
  const queuedAt = Date.now();
  const entry: PendingDecision = {
    id, verb: spec.verb, keys, origin: origin.name, ...(origin.el !== undefined ? { originEl: origin.el } : {}), runIds: [...spec.runIds], preview: spec.preview,
    label: spec.label ?? null, amend: spec.amend ?? null, queuedAt, dueAt: queuedAt + windowMs,
    ...(spec.closeNote !== undefined ? { closeNote: spec.closeNote } : {}),
  };
  useUndoQueue.setState((s) => ({ pending: [...s.pending, entry] }));
  ensureSeen(id, keys);
  return id;
}

/** Undo: cancel the queued decision. Nothing is sent. No-op once it has gone out. */
export function undoDecision(id: number): void {
  const h = handles.get(id);
  if (h === undefined) return;
  clearTimeout(h.timer);
  seenDecisions.delete(id);
  remove(id);
  h.onUndo?.();
}

/**
 * The world moved under a queued decision (its gate was answered elsewhere, the run ended, or a
 * NEW gate opened): drop it unsent and say so — `reason` is the notice the operator reads.
 */
export function cancelDecision(id: number, reason: string): void {
  const h = handles.get(id);
  if (h === undefined) return;
  clearTimeout(h.timer);
  const p = useUndoQueue.getState().pending.find((x) => x.id === id);
  seenDecisions.delete(id);
  remove(id);
  (h.onCancel ?? h.onUndo)?.(reason);
  reportDecision('not-sent', reason, { keys: p?.keys ?? [] });
}

const testResets: Array<() => void> = [];

/** A decision-state owner (the gate-action store) registers how to wipe itself between tests. */
export function onDecisionTestReset(reset: () => void): void {
  testResets.push(reset);
}

/** Tests only: drop every queued decision (nothing sent) and every registered decision state. */
export function resetDecisionsForTest(): void {
  for (const h of handles.values()) clearTimeout(h.timer);
  handles.clear();
  useUndoQueue.setState({ pending: [], results: [], hostsRev: 0, restoredNotes: {} });
  originByKey.clear();
  seenDecisions.clear();
  lastPress = null;
  for (const reset of testResets) reset();
}

/** Send every queued decision now (tests, and nothing else). */
export async function flushDecisionsForTest(): Promise<void> {
  const ids = [...handles.keys()];
  for (const id of ids) {
    const h = handles.get(id);
    if (h === undefined) continue;
    clearTimeout(h.timer);
    remove(id);
    await h.commit();
  }
}

/** True while a queued decision covers `runId`. */
export function isQueued(runId: string): boolean {
  return useUndoQueue.getState().pending.some((p) => p.runIds.includes(runId));
}

// ── Which block shows a decision ─────────────────────────────────────────────────────────────────

interface UndoHost {
  /** The block kind (`gate-card`, `proposal-card`, `desk-row`, `batch-bar`, …). */
  host: string;
  keys: readonly string[];
  /** The block's InlineUndo wrapper, for document order. */
  el: Element;
  /** The block sits OVER the page (voice full screen): while it is up it shows what it hosts, whatever is under it. */
  over: boolean;
  /** The block shows what it hosts only when no other block for it is on screen: the place a gate's row or card
   *  WAS (the Needs list, the session under its header) once that row has gone — answered elsewhere, say. */
  fallback: boolean;
}

const hosts = new Map<number, UndoHost>();
let nextHostId = 1;

/** A block that shows decisions for `keys` mounted; returns its handle (pass it to `ownsDecision`) and the unregister. */
export function registerUndoHost(
  host: string, keys: readonly string[], el: Element, opts: { over?: boolean; fallback?: boolean } = {},
): { id: number; unregister: () => void } {
  const id = nextHostId++;
  hosts.set(id, { host, keys: [...keys], el, over: opts.over === true, fallback: opts.fallback === true });
  useUndoQueue.setState((s) => ({ hostsRev: s.hostsRev + 1 }));
  return {
    id,
    unregister: () => {
      hosts.delete(id);
      useUndoQueue.setState((s) => ({ hostsRev: s.hostsRev + 1 }));
    },
  };
}

/** A block a person can see: on the page, and not inside something hidden (display:none, a closed fold). jsdom
 *  has no layout (no `checkVisibility`), so there a connected block counts as seen. */
function visible(el: Element): boolean {
  if (!el.isConnected) return false;
  // The wrapper itself is hidden while empty: its hosting block is what has to be on screen. A `display: contents`
  // scope (`.wk-undo-scope`) has no box of its own, so the first ancestor with one stands for it.
  let block: Element = el.parentElement ?? el;
  while (block.parentElement !== null && typeof getComputedStyle === 'function' && getComputedStyle(block).display === 'contents') {
    block = block.parentElement;
  }
  return boxShown(block);
}

/** Rendered with a box (not display:none, not in a closed fold, not visibility:hidden). jsdom has no layout: there a
 *  connected element counts as shown. */
function boxShown(el: Element): boolean {
  if (!el.isConnected) return false;
  const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  return typeof check === 'function' ? check.call(el, { visibilityProperty: true }) : true;
}

/** How long a decision may wait for a block to show it, once the shell has been asked to bring one on screen (a cold
 *  run page reads its runs first); well inside the 10 s window, and the send itself checks again. */
export const SHOW_GRACE_MS = 4_000;

/** Said where the run's gate shows next (a result waits for a block to mount): the person learns it was not sent. */
export const NOT_SHOWN = 'Not sent: studio couldn’t show you its Undo, so nothing was sent. Decide again here.';

/** Decisions whose full countdown and Undo have been on screen. */
const seenDecisions = new Set<number>();

/** Whether a decision's full block (its countdown and Undo) is on screen now; if so it is recorded as seen, and
 *  scrolled into view when it is outside the viewport (a decision made by keyboard, the palette or voice). */
function shownNow(id: number): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector(`[data-testid="inline-undo"][data-undo-id="${id}"]`);
  if (el === null || !boxShown(el)) return false;
  seenDecisions.add(id);
  const r = el.getBoundingClientRect();
  if (r.height > 0 && (r.bottom > window.innerHeight || r.top < 0)) el.scrollIntoView?.({ block: 'nearest' });
  return true;
}

/**
 * No invisible decisions. After the commit that queued it (so a block the same action mounts has rendered), a
 * decision whose full countdown and Undo are on screen nowhere takes the person to its run's page; still shown
 * nowhere a moment later, it is not sent at all ("Not sent: … it could not be shown"), and the send itself checks
 * once more. Only with a shell to ask (`setHostlessHandler`): a bare test harness has none.
 */
function ensureSeen(id: number, keys: readonly string[]): void {
  setTimeout(() => {
    if (hostlessHandler === null || !handles.has(id) || shownNow(id)) return;
    hostlessHandler(keys);
    setTimeout(() => {
      if (hostlessHandler === null || !handles.has(id) || seenDecisions.has(id) || shownNow(id)) return;
      cancelDecision(id, NOT_SHOWN);
    }, SHOW_GRACE_MS);
  }, 0);
}

/**
 * The ONE block that shows a decision (or result) in full: the block kind it was taken in, else the first
 * hosting block in document order. Null when no hosting block is mounted.
 */
export function ownerOf(item: { keys: readonly string[]; origin: string | null; originEl?: Element }): number | null {
  const all = [...hosts.entries()].filter(([, h]) => visible(h.el) && h.keys.some((k) => item.keys.includes(k)));
  const regular = all.filter(([, h]) => !h.fallback);
  const on = regular.length > 0 ? regular : all;
  if (on.length === 0) return null;
  on.sort(([, a], [, b]) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const over = on.find(([, h]) => h.over);
  const inBlock = item.originEl?.isConnected === true ? on.find(([, h]) => item.originEl!.contains(h.el)) : undefined;
  const ofKind = item.origin === null ? undefined : on.find(([, h]) => h.host === item.origin);
  return (over ?? inBlock ?? ofKind ?? on[0]!)[0];
}

/** Focus the block that shows decisions for `keys` now (its first action, else its Undo block): where focus goes
 *  when the block it was in has left the page. */
export function focusHostFor(keys: readonly string[]): void {
  const item = useUndoQueue.getState().pending.find((p) => p.keys.some((k) => keys.includes(k)))
    ?? useUndoQueue.getState().results.find((r) => r.keys.some((k) => keys.includes(k)));
  const id = item !== undefined ? ownerOf(item) : null;
  const h = id !== null ? hosts.get(id) : [...hosts.values()].find((x) => visible(x.el) && x.keys.some((k) => keys.includes(k)));
  if (h === undefined) return;
  const target = (h.el.querySelector<HTMLElement>('button:not([disabled])') ?? h.el) as HTMLElement;
  target.focus({ preventScroll: true });
}

let lastPress: { el: Element; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element) lastPress = { el: e.target, at: Date.now() };
  }, true);
  // A key pressed after it means the person acts by keyboard now: where focus is, not where they last clicked.
  document.addEventListener('keydown', () => { lastPress = null; }, true);
}

interface Origin { name: string | null; el?: Element }
const NO_ORIGIN: Origin = { name: null };

/** The block the person is acting in right now: the press that just happened, else the focused element. */
function originHere(): Origin {
  if (typeof document === 'undefined') return NO_ORIGIN;
  // A press that just happened, on something still on the page (a press on a card that has since gone says nothing).
  const pressed = lastPress !== null && Date.now() - lastPress.at < 2_000 && lastPress.el.isConnected ? lastPress.el : null;
  for (const el of [pressed, document.activeElement]) {
    const block = el?.closest?.('[data-undo-host]');
    const name = block?.getAttribute('data-undo-host');
    if (block !== null && block !== undefined && name !== undefined && name !== null && name !== '') return { name, el: block };
  }
  return NO_ORIGIN;
}

let hostlessHandler: ((keys: readonly string[]) => void) | null = null;

/** The shell says how to bring a hostless decision on screen (it navigates to the run's page). */
export function setHostlessHandler(fn: ((keys: readonly string[]) => void) | null): void {
  hostlessHandler = fn;
}

/** Every key of one kind (`gate`) that a queued decision or a kept result is about, space-joined (a stable
 *  selector value) — what a fallback block hosts. */
export function keysOfKind(s: Pick<UndoQueueStore, 'pending' | 'results'>, kind: string): string {
  const all = new Set<string>();
  // `gate` matches `gate:<run>`; a bare key (`batch`, `memory-accept`) matches itself.
  for (const x of [...s.pending, ...s.results]) for (const k of x.keys) if (k === kind || k.startsWith(`${kind}:`)) all.add(k);
  return [...all].sort().join(' ');
}

/** The run a key is about (`gate:r1` → `r1`); null for `batch` / `memory-accept`. */
export function runOfKey(key: string): { kind: string; runId: string } | null {
  const at = key.indexOf(':');
  return at <= 0 ? null : { kind: key.slice(0, at), runId: key.slice(at + 1) };
}

/** Whole seconds left in the window, never below 0 — the countdown. A clock read
 *  before the decision was queued counts as the moment it was queued. */
export function secondsLeft(p: PendingDecision, now: number): number {
  return Math.max(0, Math.ceil((p.dueAt - Math.max(now, p.queuedAt)) / 1000));
}

const HEADLINE_VERB: Record<DecisionVerb, string> = {
  approve: 'Approving',
  reject: 'Rejecting',
  'request-changes': 'Requesting changes',
  'edit-plan': 'Adding',
  stop: 'Stopping',
};

/** "Approving the plan for “Fix the double charge” in 8 s" / "Rejecting 3 gates in 4 s". */
export function undoHeadline(p: PendingDecision, now: number): string {
  const verb = HEADLINE_VERB[p.verb];
  const what = p.runIds.length > 1 ? ` ${p.runIds.length} gates` : p.label !== null ? ` ${p.label}` : '';
  return `${verb}${what} in ${secondsLeft(p, now)} s`;
}

/** What the inline block's live region says ONCE when a decision is queued — no seconds, so the 1 s tick never
 *  re-announces it: "Approving the plan for “Fix it”. You can undo it until it sends." */
export function undoAnnouncement(p: PendingDecision): string {
  const verb = HEADLINE_VERB[p.verb];
  const what = p.runIds.length > 1 ? ` ${p.runIds.length} gates` : p.label !== null ? ` ${p.label}` : '';
  // No duration: a block that shows it late (another took over) would promise a fresh window it does not have.
  return `${verb}${what}. You can undo it until it sends.`;
}

/** The quiet line on every OTHER block that shows the same decision (one Undo per decision per page). */
export function waitingLine(p: PendingDecision, now: number): string {
  const left = secondsLeft(p, now);
  return left > 0 ? `Waiting to send · ${left} s` : 'Sending';
}

/**
 * The "what will happen" line, spelled once for every surface that previews a decision
 * (the inline Undo, the chip's title, the reject note, the batch bar). A reject with no choices
 * cancels the run (the daemon's `{approve:false}`), so the line says so.
 */
export function decisionPreview(verb: DecisionVerb, count: number, withNote = false): string {
  if (verb === 'approve') {
    return count > 1 ? `${count} runs resume past their gates.` : 'The run resumes past this gate.';
  }
  const note = withNote ? ', with your note on the gate record' : '';
  return count > 1 ? `${count} runs are cancelled at their gates${note}.` : `The run is cancelled at this gate${note}.`;
}

/**
 * What a DELIVER gate's approve sends off the machine (studio#368): the run branch it pushes and the
 * repository it opens the pull request on, when the host knows them. The push identity is not on
 * the wire (crew pushes with the GitHub account its host is signed in to), so the line names that
 * account by where it comes from rather than inventing a login.
 */
export interface DeliverTarget {
  branch: string | null;
  repo: string | null;
  /** The deliver unit's gate-card target sentence (`deliverTargetOf`) — what THIS push will do on
   *  this origin. When present the inline Undo says exactly that (R1/R3); without it `deliverPreview`
   *  states the push and makes the pull request a condition, `repo` naming whose origin. */
  card?: string | null;
}

/** The deliver approve's preview: the gate card's own sentence, else the push with the pull request
 *  stated as a condition. */
export function deliverPreview(t: DeliverTarget): string {
  const card = (t.card ?? '').trim();
  if (card !== '') return card;
  // No card (a def authored without one, a deliver-lift retry, the palette or triage keys): the
  // origin is not known here, so the pull request is the condition it is — never a promise, and
  // `repo` (a registry label) names whose origin, not where a PR opens (R3; Copilot on studio#400).
  const branch = t.branch !== null && t.branch !== '' ? `branch ${t.branch}` : 'the run branch';
  const to = t.repo !== null && t.repo !== '' ? ` to the origin of ${t.repo}` : '';
  return `Pushes ${branch}${to}, under the daemon's GitHub sign-in; a pull request opens only if that origin is a GitHub repository.`;
}

/**
 * Verb + "what will happen" for ANY gate decision the wire can carry — plain approve, approve
 * with a steer note, reject (with or without a note), request changes — so every caller of the
 * shared decision path gets an honest preview without spelling its own copy.
 */
/** The inline Undo's line for each escalation arm (`GateDecision.action`, api-types 0.57.0). */
const ESCALATION_PREVIEW: Record<string, string> = {
  extend: 'The checks re-run on the tree as it stands, each under twice its time bound.',
  targeted: "The checks re-run with the repo's declared targeted test command in place of the full test set. With none declared the engine refuses it and the gate stays open (an engine before core-ts 0.15.38 waives the test set instead).",
  accept_partial: 'Tests waived by the operator: the checks that passed re-run; the ones that did not pass or did not run are waived and named in the floor note.',
  accept_suggestion: "The evaluator's edit is applied and the run goes back to the creator phase to rework it.",
  // wicked-core#555: the amendment changes what the run is JUDGED against, from here on. Say that
  // — an operator pressing this is descoping, and "the run resumes" would hide it.
  amend_intent:
    "The run's acceptance list changes: every phase from here on — the evaluator included — is judged against your amendment instead of the withdrawn launch item. It is recorded on the run.",
  // (DES-RULE-CHECK-001 S2) A rules hold's answers: the step does not run again, so never "the run resumes".
  retry_rules: 'The steering-rule check runs again on the same work; the step does not run again.',
  skip_rules: 'The selected rules are skipped with your reason, labelled on the run, the gate and the delivery; then the rule check runs again.',
};

export function describeDecision(
  decision: GateDecision, count = 1, deliver: DeliverTarget | null = null,
): { verb: DecisionVerb; preview: string } {
  const note = (decision.amend ?? '').trim() !== '';
  if (decision.approve && (decision as { plan?: unknown }).plan !== undefined) {
    // D11: the plan gate's approve WITH an edited plan — the edit is the answer.
    return { verb: 'approve', preview: 'The run takes your edited plan (the floor still adds what its band requires).' };
  }
  // core#469 / core#467 (crew#699): the escalation arms say what they do, not "resumes".
  const arm = ESCALATION_PREVIEW[(decision as { action?: string }).action ?? ''];
  if (decision.approve && arm !== undefined) return { verb: 'approve', preview: arm };
  if (decision.approve) {
    // studio#368: approving a deliver gate pushes and opens a PR — the preview says so, not "resumes".
    const base = deliver !== null && count === 1 ? deliverPreview(deliver) : decisionPreview('approve', count);
    return { verb: 'approve', preview: note ? `${base.slice(0, -1)}, carrying your note as guidance.` : base };
  }
  if ((decision as { action?: string }).action === 'request_changes') {
    return {
      verb: 'request-changes',
      preview: 'The run rewinds to its last creator phase and redoes it with your note.',
    };
  }
  return { verb: 'reject', preview: decisionPreview('reject', count, note) };
}

/** The page-close contract, in the inline block's own words. */
export const CLOSE_NOTE = 'Close this tab before then and nothing is sent: the gate stays open.';
