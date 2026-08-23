// The Document-mode conversation (DES-MERGE-001 §2, §6.3 slice 10).
//
// One thread per doc, spanning all its versions (§2.4). Frames arrive inside slice 3's
// relay envelope `{type:"interactiveEvent", event}` and are folded into an ordered
// transcript keyed `projectId:docId` — the same shape the runtime store folds for the
// board headline, at the thread's altitude instead of the card's (§3.4).
//
// The vocabulary is wicked-interactive's (`service/events.js`) and this repo does not
// own it, so every payload is read DEFENSIVELY: both spellings of each field, no throw
// on a shape that does not match, and a frame naming no project+document is dropped
// rather than rendered under a guessed key.

import { create } from 'zustand';
import { isFiller } from './narration.js';
import {
  recordAnchor, recordExport, writeSendStates,
  type StoredAnchor, type StoredExport, type StoredSendState,
} from '../interactive/threadStopgap.js';
import { UNFILED_MOUNT } from '../api/interactive.js';
import type { ConversationEntry, ExportFormat } from '../api/interactive.js';
import type { CoreEvent } from '../api/types.js';

// ── Transcript ───────────────────────────────────────────────────────────────

/**
 * One targeted comment from the point-and-comment overlay (§4.3, slices 11+12). `wid`
 * is the document's own stable anchor (INV-1), which is what makes the item deep-linkable
 * back to its element for as long as the element exists.
 */
export interface FeedbackItem { wid: string; text: string }

/** What a failed export offers to run again — the same format, at the same version. */
export interface ExportRetry { format: ExportFormat; version: number }

/**
 * DES-UX-001 §6.1 honesty budget (the J3 pin): how long a send may wear
 * "generating — this message is being worked now" with NO
 * `wicked.interactive.*` signal for its thread before the chip must become a
 * visible timeout state (honest copy + a working retry). The reproduced
 * failure was a create whose pill span 28 minutes with zero backend signal —
 * no run anywhere, Health green. 90s is the budget: long enough for a slow
 * worker pickup, far shorter than a user abandoning the page.
 */
export const GENERATING_SILENCE_BUDGET_MS = 90_000;

export type DocMsg =
  // `items` is set only for a submitted feedback batch: ONE message, N targets (§4.3 —
  // sending each comment separately would produce N versions and N runs). `notRecorded`
  // is §7.7's failure shape: the bus event landed and the document still updates, but the
  // inject that puts this message in the run did not — retryable, never silent.
  // `failed` is DES-UX-001 §6.1's visible-failure state: the send itself was refused
  // before the bridge accepted it — retryable, never silent (EC36). `restored` marks a
  // message rehydrated from `GET /d/:doc/api/conversation` (§6.3): the wire carries no
  // message ids, so a restored message's id is minted fresh and its version anchor (if
  // any) came from the session-storage stopgap, not the transcript.
  // `sentAt` is the send's own clock (§6.1 honesty budget): stamped when the
  // message is enqueued and re-stamped by a retry, it is half of what decides
  // when the generating chip must stop claiming "being worked now".
  // `refused` narrows `failed` (round-3 J3): the bridge never ACCEPTED this send,
  // so the wire's announce history holds no line for it — the send-state stopgap
  // must persist its text itself for the failure to survive a reload.
  | { kind: 'user';      id: string; text: string; version?: number;
      items?: FeedbackItem[]; notRecorded?: boolean; failed?: boolean; refused?: boolean;
      restored?: boolean; sentAt?: number }
  | { kind: 'narration'; id: string; text: string }
  // `href` + `file` make an agent message DOWNLOADABLE (§4.4): an export is an ordinary
  // message from the service, carrying its artifact — never a toast, never a second origin.
  | { kind: 'agent';     id: string; author: string; text: string; href?: string; file?: string }
  // §3.3's actionable kind: what happened, the fix NAMED verbatim, and — where the action
  // repeats — what to retry. An error with no next action is banned, so `hint` is required.
  | { kind: 'actionable'; id: string; text: string; hint: string; retry?: ExportRetry }
  | { kind: 'verdict';   id: string; author: string; text: string }
  | { kind: 'gate';      id: string; requestId: string; question: string; options: string[] }
  | { kind: 'divider';   id: string; version: number };

/**
 * The composer's four states (§2.2). `idle` is a fact about the ROUTE — no document
 * selected — so it is never stored; the other three are what the stream last said.
 */
export type GenState = 'idle' | 'generating' | 'gated' | 'terminal';

let seq = 0;
export function nextMsgId(): string { return `dmsg-${++seq}`; }

// ── Frame parsing ────────────────────────────────────────────────────────────

const STATUS   = 'wicked.interactive.status.posted';
const CHAT     = 'wicked.interactive.chat.posted';
const REVIEW   = 'wicked.interactive.review.completed';
const VERSION  = 'wicked.interactive.version.created';
const EXPORTED = 'wicked.interactive.export.generated';

/** Version kinds a GENERATION produces. A `fork` is a lineage move the user made, not
 *  the agent finishing — it neither ends the working state nor consumes the anchor. */
const GENERATED: ReadonlySet<string> = new Set(['generated', 'structural', 'demo']);

/** First non-empty string among the candidate keys of an untyped bag. */
function pick(bag: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

interface Frame { key: string; type: string; payload: Record<string, unknown> }

/** A relayed interactive frame, reduced to `(thread key, event type, payload)`.
 *
 *  Project resolution (the round-2 first-generation fix): the bridge stamps
 *  `project_id` on every payload of a doc BOUND to a crew project (serviceEmit
 *  derives it from the binding breadcrumb), and stamps NOTHING for an unbound
 *  doc — which the studio serves through the Unfiled (`default`) mount. So a
 *  doc-naming frame with no project is not ambiguous, it is the Unfiled mount's:
 *  dropping it (the pre-fix behavior) left every Unfiled doc's thread deaf —
 *  the canvas kept the v0 "Building…" placeholder after v1 landed, the
 *  generating chip never resolved, and the manifest never re-read. */
function frameOf(event: CoreEvent): Frame | null {
  if (event.type !== 'interactiveEvent') return null;
  const ev = event.event as Record<string, unknown> | undefined;
  if (typeof ev !== 'object' || ev === null) return null;
  const type = pick(ev, 'event_type', 'type');
  const payload = (typeof ev.payload === 'object' && ev.payload !== null ? ev.payload : ev) as Record<string, unknown>;
  const docId = pick(payload, 'document_id', 'doc_id', 'document');
  if (type === null || docId === null) return null;
  const projectId = pick(payload, 'project_id', 'project')
    ?? pick(ev, 'project_id', 'project')
    ?? UNFILED_MOUNT;
  return { key: threadKey(projectId, docId), type, payload };
}

/** The one spelling of a thread's identity. Thread id = the doc's lineage (§2.4). */
export function threadKey(projectId: string, docId: string): string {
  return `${projectId}:${docId}`;
}

// ── Store ────────────────────────────────────────────────────────────────────

/** One bridge-reported failure line (`status.posted {state:"error"}`), per thread.
 *  Consumers compare entry IDENTITY (a new object per error), so "did a NEW error
 *  arrive since I started?" needs no clock — snapshot the entry, watch it change. */
export interface ThreadError { text: string }

/**
 * One OBSERVED version landing (DES-FEEDBACK-003 §7.3): the landing page's
 * activity river marks "a doc/demo version landed" on the owning project's
 * lane. The frame itself carries no timestamp, so the clock is the ARRIVAL
 * time — the same honest stamp the runtime log and the gate store already use
 * (observed by this page, never invented).
 */
export interface VersionLanding { projectId: string; version: number; kind: string; at: number }

/** Ring cap on the observed-landings list — a lens over recent activity, not a ledger. */
const LANDINGS_CAP = 200;

interface DocThreadStore {
  messages: Record<string, DocMsg[]>;
  /** What the stream last said the generation is doing, per thread. */
  genState: Record<string, GenState>;
  /** The newest `status.posted {state:"error"}` line, per thread — what the
   *  brand-learn poll (learnPoll.ts) reads to surface the bridge's ASYNC
   *  refusals (the SSRF guard's, a failed grab) while it waits on the
   *  readback route. The transcript keeps carrying the same line as a
   *  narration message; this is an index into it, not a second author. */
  lastError: Record<string, ThreadError>;
  /**
   * The FIFO of user-message ids awaiting a landed version, per thread
   * (DES-UX-001 §6.1 + §8.4.1 probe 1). The bridge QUEUES sends — every
   * `chat.posted` acks 200 and lands durably in send order — but `version.created`
   * carries no `source_message_id`, so the anchor is a CLIENT-side correlation
   * by order: the oldest pending send is the one the next generated version
   * answers. Head of the queue = the message being worked (`thread-generating`);
   * the rest are queued behind the current run (`thread-queued`).
   */
  pending: Record<string, string[]>;
  /** Threads whose rehydration read (§6.3) has run — once per thread per session. */
  hydrated: Record<string, boolean>;
  /**
   * When the LAST `wicked.interactive.*` frame for each thread arrived (§6.1
   * honesty budget). Any frame counts — status, chat, version, export: each one
   * proves something is alive on the other end, so each one re-arms the budget.
   * A thread that has never heard anything has no entry.
   */
  lastSignalAt: Record<string, number>;
  /** Deferred continuation dividers (§7.10, the J3 bookkeeping pin), per thread:
   *  each waits for the wire to show its version exists. See `expectDivider`. */
  expectedDividers: Record<string, { msgId: string; version: number }[]>;
  /**
   * The newest version the stream has landed, per thread. The transcript tags its anchor
   * message (§7.6) and does not otherwise care; a mode SURFACE does — a re-authored demo
   * spec is a new version of the same artifact (§7.10's continuation rhythm), so the
   * storyboard re-reads the service rather than showing the steps it was fed at mount.
   */
  landed: Record<string, number>;
  /** Every version landing this page has observed, arrival-stamped (§7.3 river marks). */
  landings: VersionLanding[];
  /** Fold one CoreEvent — every non-interactive frame is ignored. */
  ingest: (event: CoreEvent) => void;
  /** Append the user's message and enqueue it as a pending version anchor (§6.1). */
  addUserMsg: (key: string, id: string, text: string, items?: FeedbackItem[]) => void;
  /** Flag/clear §7.7's "not recorded in the run" chip on one already-rendered message. */
  markNotRecorded: (key: string, id: string, notRecorded: boolean) => void;
  /** §6.1's visible failure: the send was refused — drop it from the pending queue
   *  and mark the message failed, so it renders `thread-send-failed` with a retry.
   *  `refused` says the bridge never ACCEPTED it (an HTTP refusal): the wire holds
   *  no line for it, so the send-state stopgap persists its text itself. */
  markSendFailed: (key: string, id: string, refused?: boolean) => void;
  /** Re-arm a failed send: clear the flag and re-enqueue at the TAIL — a retry is a
   *  new send in queue order, never a jump back to its original position. */
  retrySend: (key: string, id: string) => void;
  /**
   * §6.3 rehydration, from `GET /d/:doc/api/conversation` (BRIDGE-UX-1 probe 2):
   * rebuild the transcript TEXT from the wire — user lines as user messages,
   * agent narration as narration (the §3.2 filler seam still applies) — and
   * re-attach version anchors from the session-storage stopgap by user-message
   * ordinal (the only correlation the wire supports). Applies only while the
   * projection is empty; a thread with live messages keeps them and just marks
   * itself hydrated, so the read never doubles what this session already saw.
   *
   * Round-3 J3 (finding 4): `sends` re-attaches the unresolved-send states the
   * wire cannot carry — pending sends re-enter the FIFO with their ORIGINAL
   * sentAt (the honesty budget resumes, it never re-arms), failed accepted sends
   * re-wear their failure + retry, and REFUSED sends (no wire line) are
   * re-rendered from their persisted text. `exports` restores the transcript's
   * downloadable export entries the announce history has no record of.
   */
  hydrate: (key: string, entries: ConversationEntry[], anchors: StoredAnchor[],
            sends?: StoredSendState[], exports?: StoredExport[]) => void;
  /** Append a client-authored informative line (§3.3) — an action the user took. */
  addNarration: (key: string, text: string) => void;
  /**
   * Append a service-authored agent message, optionally carrying a downloadable artifact.
   * The export wire (§4.4, slice 15) adds the finished export from the HTTP response it
   * already has, so the download is offered the moment it exists rather than whenever the
   * bus echo arrives. `ingest`'s EXPORTED handler deduplicates on `href`, so the echo that
   * follows never doubles the entry.
   */
  addAgentMsg: (key: string, author: string, text: string,
                artifact?: { href: string; file?: string }) => void;
  /** Append an §3.3 ACTIONABLE line — a failure that names its fix, and what to retry. */
  addActionable: (key: string, text: string, hint: string, retry?: ExportRetry) => void;
  /**
   * Register the version divider a fork+inject continuation WILL render behind
   * (§7.10) — deferred to the wire (the J3 bookkeeping pin): "continues as vN"
   * is an anchor, and no anchor may render before the thread has OBSERVED that
   * version exist. The divider is inserted immediately above the continuation
   * message by the first `version.created` arrival at or past `version`; a
   * continuation whose run never lands anything never grows a divider.
   */
  expectDivider: (key: string, msgId: string, version: number) => void;
  setGenState: (key: string, state: GenState) => void;
  clear: (key: string) => void;
}

/** Append one message to a thread. */
function append(messages: Record<string, DocMsg[]>, key: string, msg: DocMsg): Record<string, DocMsg[]> {
  return { ...messages, [key]: [...(messages[key] ?? []), msg] };
}

/**
 * Round-3 J3 (finding 4): derive one thread's unresolved-send snapshot from the
 * live projection and persist it (session storage) — called after every mutation
 * that can change it, so the write cannot drift from the truth on screen.
 * Ordinals count ACCEPTED user lines only (the wire's own addressing); a REFUSED
 * send carries its text, because the announce history has no line for it.
 */
function persistSendStates(key: string): void {
  const s = useDocThreadStore.getState();
  const msgs = s.messages[key] ?? [];
  const pending = new Set(s.pending[key] ?? []);
  const out: StoredSendState[] = [];
  let ord = 0; // accepted-user-line ordinal, the wire's addressing
  for (const m of msgs) {
    if (m.kind !== 'user') continue;
    if (m.refused === true) {
      out.push({ ord, state: 'failed', sentAt: m.sentAt ?? 0, text: m.text });
      continue;
    }
    ord += 1;
    if (m.failed === true) out.push({ ord, state: 'failed', sentAt: m.sentAt ?? 0 });
    else if (pending.has(m.id)) out.push({ ord, state: 'pending', sentAt: m.sentAt ?? 0 });
  }
  writeSendStates(key, out);
}

export const useDocThreadStore = create<DocThreadStore>((set) => ({
  messages: {},
  genState: {},
  pending: {},
  hydrated: {},
  landed: {},
  landings: [],
  lastError: {},
  lastSignalAt: {},
  expectedDividers: {},

  ingest: (event) => {
    const frame = frameOf(event);
    if (frame === null) return;
    const { key, type, payload } = frame;
    // §6.1 honesty budget: every parsed frame for this thread is a liveness
    // signal — stamp it before the fold, whatever the fold does with the frame.
    set((s) => ({ lastSignalAt: { ...s.lastSignalAt, [key]: Date.now() } }));
    // The anchor the VERSION branch tags, surfaced out of the reducer so the
    // session-storage stopgap (§6.3) records it OUTSIDE the state update.
    let taggedOrd: number | null = null;
    let taggedVersion = 0;
    // The EXPORTED branch's stopgap record, surfaced the same way.
    let exportEntry: StoredExport | null = null;

    set((s) => {
      const messages = s.messages;
      const was = s.genState[key] ?? 'terminal';

      // status.posted carries BOTH narration and the gate: `state:"asking"` is the
      // question (§2.2 case 3), every other state is a line about the work (§3.3).
      if (type === STATUS) {
        const state = pick(payload, 'state') ?? 'working';
        const text = pick(payload, 'message', 'status', 'text');
        if (state === 'asking') {
          const requestId = pick(payload, 'request_id', 'requestId');
          const question = pick(payload, 'question') ?? text;
          if (requestId === null || question === null) return s;
          const options = Array.isArray(payload.options)
            ? payload.options.filter((o): o is string => typeof o === 'string')
            : [];
          return {
            messages: append(messages, key, { kind: 'gate', id: nextMsgId(), requestId, question, options }),
            genState: { ...s.genState, [key]: 'gated' },
          };
        }
        const done = state === 'complete' || state === 'error';
        const next: GenState = done ? 'terminal' : was === 'gated' ? 'gated' : 'generating';
        // An error line is ALSO indexed as the thread's newest failure (a fresh
        // object each time — see ThreadError), so waiters can spot its arrival.
        const failed = state === 'error' && text !== null
          ? { lastError: { ...s.lastError, [key]: { text } } }
          : {};
        // §6.1 (EC36): a run that DIES takes its backlog with it — every send still
        // pending resolves to the VISIBLE failed state (with its retry) rather than
        // a chip that generates forever. Probe 4 (§8.4.1): the death is one
        // doc-scoped `status.posted {state:"error"}`; nothing else will answer them.
        const backlog = state === 'error' ? new Set(s.pending[key] ?? []) : null;
        const base = backlog === null || backlog.size === 0
          ? messages
          : {
              ...messages,
              [key]: (messages[key] ?? []).map((m) =>
                m.kind === 'user' && backlog.has(m.id) ? { ...m, failed: true } : m),
            };
        const pending = backlog !== null && backlog.size > 0
          ? { pending: { ...s.pending, [key]: [] } }
          : {};
        // §3.2/§3.3: filler never reaches the transcript — rotating flavour text and a
        // subject-less `Working…` are both dropped AT THE SEAM, so an upstream bridge that
        // still speaks either cannot put it on screen. A filtered frame still carries the
        // state transition it rode in on: dropping the LINE is not dropping the fact.
        if (text === null || isFiller(text)) {
          return { messages: base, genState: { ...s.genState, [key]: next }, ...failed, ...pending };
        }
        return {
          messages: append(base, key, { kind: 'narration', id: nextMsgId(), text }),
          genState: { ...s.genState, [key]: next },
          ...failed,
          ...pending,
        };
      }

      // §2.5: every author is an author. A review verdict is an ordinary message with a
      // name on it, not a toast and not a `role:"review"` special kind (§4.7).
      if (type === CHAT) {
        const role = pick(payload, 'role') ?? 'agent';
        const text = pick(payload, 'text', 'message', 'content');
        // Our own submits are echoed back by the bus; the optimistic message is already
        // in the transcript, so re-rendering the echo would double every user line.
        if (text === null || role === 'user') return s;
        const author = pick(payload, 'reviewer', 'author', 'cli') ?? (role === 'review' ? 'reviewer' : 'agent');
        return {
          messages: append(messages, key,
            role === 'review'
              ? { kind: 'verdict', id: nextMsgId(), author, text }
              : { kind: 'agent', id: nextMsgId(), author, text }),
        };
      }

      if (type === REVIEW) {
        const author = pick(payload, 'reviewer', 'author') ?? 'reviewer';
        const text = pick(payload, 'verdict', 'message', 'text') ?? `${author} review complete`;
        return { messages: append(messages, key, { kind: 'verdict', id: nextMsgId(), author, text }) };
      }

      // An export is a completed artifact, so it lands IN the thread with its download
      // (§4.4's merged-UI change — studio's `downloadRunEvidence` pattern), not a toast.
      // ExportMenu adds the message immediately from the HTTP response; this WS echo
      // deduplicates on `href` so the same download never appears twice.
      if (type === EXPORTED) {
        const format = pick(payload, 'format') ?? 'file';
        const file = pick(payload, 'file') ?? format;
        const href = pick(payload, 'download');
        if (href !== null && (messages[key] ?? []).some(
          (m) => m.kind === 'agent' && m.href === href,
        )) return s;
        const text = `${format.toUpperCase()} export ready — ${file}`;
        // Round-3 minor: the announce history carries no exports, so the entry is
        // ALSO recorded in the session stopgap — the reload restores the download.
        if (href !== null) exportEntry = { text, href, file };
        return {
          messages: append(messages, key, {
            kind: 'agent', id: nextMsgId(), author: 'export', text,
            ...(href === null ? {} : { href, file }),
          }),
        };
      }

      // §7.6, client half: the version the generation just landed is tagged onto the user
      // message that triggered it, so slice 9's strip has a message to scroll to. The
      // service half writes the same id into `versions.json`; this is what makes the
      // anchor resolvable in the session that produced it.
      // §6.1 + §8.4.1 probe 1: `version.created` carries NO source_message_id, so
      // the anchor is a client-side ORDER correlation — the bridge queues sends
      // FIFO, so the landed version answers the OLDEST pending send. A `generated`
      // landing consumes that anchor; a fork tags it but leaves it pending (the
      // generation that follows the fork is what answers it, §7.10). No pending
      // send ⇒ nothing is tagged: a marker never renders under an unrelated
      // request (the EC36 gaslight pin).
      if (type === VERSION) {
        const raw = payload.version;
        const version = typeof raw === 'number' ? raw : Number(pick(payload, 'version') ?? NaN);
        const kind = pick(payload, 'kind') ?? '';
        if (!Number.isInteger(version)) return s;
        const queue = s.pending[key] ?? [];
        const anchorId = queue.length > 0 ? queue[0] : undefined;
        const generated = GENERATED.has(kind);
        // §7.10 deferred dividers (the J3 bookkeeping pin): this arrival is the
        // proof-of-existence a registered continuation waited for. Each divider
        // whose version the wire has now reached is inserted immediately above
        // its continuation message — never earlier than this moment.
        const expected = s.expectedDividers[key] ?? [];
        const due = expected.filter((e) => version >= e.version);
        let thread = messages[key] ?? [];
        for (const e of due) {
          const divider: DocMsg = { kind: 'divider', id: nextMsgId(), version: e.version };
          const at = thread.findIndex((m) => m.kind === 'user' && m.id === e.msgId);
          thread = at === -1
            ? [...thread, divider]
            : [...thread.slice(0, at), divider, ...thread.slice(at)];
        }
        const dividers = due.length === 0
          ? {}
          : { expectedDividers: { ...s.expectedDividers,
                                  [key]: expected.filter((e) => version < e.version) } };
        const tagged = anchorId === undefined
          ? (due.length === 0 ? messages : { ...messages, [key]: thread })
          : {
              ...messages,
              [key]: thread.map((m) =>
                m.kind === 'user' && m.id === anchorId ? { ...m, version } : m),
            };
        if (anchorId !== undefined && generated) {
          // The session-storage stopgap's address (§6.3): the tagged message's
          // 1-based ordinal among ACCEPTED user messages — the only spelling that
          // survives a reload, because message ids are minted per session. A
          // REFUSED send has no wire line, so it does not count (round-3 J3:
          // the wire's ordinals are the address space, not the projection's).
          let ord = 0;
          for (const m of thread) {
            if (m.kind === 'user' && m.refused !== true) ord += 1;
            if (m.kind === 'user' && m.id === anchorId) { taggedOrd = ord; break; }
          }
          taggedVersion = version;
        }
        return {
          messages: tagged,
          ...dividers,
          pending: generated && anchorId !== undefined
            ? { ...s.pending, [key]: queue.slice(1) }
            : s.pending,
          landed: { ...s.landed, [key]: version },
          // The river's mark (§7.3): project id is the thread key's first
          // segment (`threadKey` = `${projectId}:${docId}`), clock = arrival.
          landings: [
            ...s.landings,
            { projectId: key.slice(0, key.indexOf(':')), version, kind, at: Date.now() },
          ].slice(-LANDINGS_CAP),
          // Terminal only when nothing is queued behind the landing (§6.1): a
          // queued send means the bridge is still working the thread's backlog,
          // so the thread stays (or becomes) GENERATING until the queue drains.
          genState: generated
            ? { ...s.genState, [key]: queue.length <= 1 ? 'terminal' : 'generating' }
            : s.genState,
        };
      }

      return s;
    });
    if (taggedOrd !== null) recordAnchor(key, taggedOrd, taggedVersion);
    if (exportEntry !== null) recordExport(key, exportEntry);
    // Any frame can resolve or fail sends (a landing consumes the head anchor, a
    // status error kills the backlog) — re-derive the persisted snapshot either way.
    persistSendStates(key);
  },

  addUserMsg: (key, id, text, items) => {
    set((s) => ({
      messages: append(s.messages, key,
        { kind: 'user', id, text, sentAt: Date.now(), ...(items ? { items } : {}) }),
      pending: { ...s.pending, [key]: [...(s.pending[key] ?? []), id] },
    }));
    persistSendStates(key);
  },

  markSendFailed: (key, id, refused = false) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] ?? []).map((m) =>
          m.kind === 'user' && m.id === id
            ? { ...m, failed: true, ...(refused ? { refused: true } : {}) }
            : m),
      },
      pending: { ...s.pending, [key]: (s.pending[key] ?? []).filter((p) => p !== id) },
    }));
    persistSendStates(key);
  },

  retrySend: (key, id) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] ?? []).map((m) =>
          // A retry is a NEW send, so its §6.1 honesty-budget clock restarts too.
          // A refused send being re-armed sheds the refused mark: if THIS attempt
          // is accepted, the wire will hold its line like any other send's.
          m.kind === 'user' && m.id === id
            ? { ...m, failed: false, refused: false, sentAt: Date.now() }
            : m),
      },
      pending: { ...s.pending, [key]: [...(s.pending[key] ?? []).filter((p) => p !== id), id] },
    }));
    persistSendStates(key);
  },

  hydrate: (key, entries, anchors, sends = [], exports = []) =>
    set((s) => {
      // Once per thread per session, and never over a live projection: the read
      // restores what the wire holds, it must not double what this tab saw.
      if (s.hydrated[key] === true) return s;
      if ((s.messages[key] ?? []).length > 0) return { hydrated: { ...s.hydrated, [key]: true } };
      const byOrd = new Map(anchors.map((a) => [a.ord, a.version]));
      // Round-3 J3: the persisted unresolved sends, by accepted-user ordinal.
      const sendByOrd = new Map(sends.filter((x) => x.text === undefined).map((x) => [x.ord, x]));
      const refusedAfter = new Map<number, StoredSendState[]>();
      for (const x of sends) {
        if (x.text === undefined) continue;
        refusedAfter.set(x.ord, [...(refusedAfter.get(x.ord) ?? []), x]);
      }
      // The wire OUTRANKS a refusal mark: a "refused" send whose exact text IS
      // the next accepted line was accepted after all — the failure was the lost
      // RESPONSE (a reload tearing down the in-flight fetch, a network blip),
      // never the send. Restoring the stale copy would duplicate the message
      // wearing a fabricated failure; the truth is an accepted send still
      // awaiting its answer, so it re-enters as PENDING on its original clock.
      {
        let o = 0;
        for (const e of entries) {
          const t = typeof e.text === 'string' ? e.text.trim() : '';
          if (t === '' || e.role !== 'user') continue;
          o += 1;
          const queued = refusedAfter.get(o - 1) ?? [];
          const match = queued.find((x) => (x.text as string).trim() === t);
          if (match === undefined) continue;
          if (!sendByOrd.has(o)) {
            sendByOrd.set(o, { ord: o, state: 'pending', sentAt: match.sentAt });
          }
          queued.splice(queued.indexOf(match), 1);
        }
      }
      const restored: DocMsg[] = [];
      const pendingRestored: { ord: number; id: string }[] = [];
      const pushRefused = (afterOrd: number): void => {
        for (const x of refusedAfter.get(afterOrd) ?? []) {
          // A REFUSED send has no wire line — its persisted text re-renders it,
          // wearing the failure and its retry (never a plain accepted message).
          restored.push({
            kind: 'user', id: nextMsgId(), text: x.text as string, restored: true,
            failed: true, refused: true, sentAt: x.sentAt,
          });
        }
      };
      let ord = 0;
      pushRefused(0);
      for (const e of entries) {
        const text = typeof e.text === 'string' ? e.text.trim() : '';
        if (text === '') continue;
        if (e.role === 'user') {
          ord += 1;
          const version = byOrd.get(ord);
          const sendState = sendByOrd.get(ord);
          const id = nextMsgId();
          restored.push({
            kind: 'user', id, text, restored: true,
            ...(version === undefined ? {} : { version }),
            // A still-unresolved send keeps its ORIGINAL clock: the honesty
            // budget resumes across the reload instead of re-arming (a send
            // that was already stalled comes back visibly stalled).
            ...(sendState === undefined ? {} : { sentAt: sendState.sentAt }),
            ...(sendState?.state === 'failed' ? { failed: true } : {}),
          });
          if (sendState?.state === 'pending') pendingRestored.push({ ord, id });
          pushRefused(ord);
        } else if (!isFiller(text)) {
          // Agent narration (including error states) at the same seam live frames
          // cross: filler is dropped here too — one rule, both sources (§3.2).
          restored.push({ kind: 'narration', id: nextMsgId(), text });
        }
      }
      // Round-3 minor: the transcript's export downloads, restored at the tail —
      // the announce history holds no exports, so the stopgap is their record.
      for (const x of exports) {
        restored.push({ kind: 'agent', id: nextMsgId(), author: 'export',
                        text: x.text, href: x.href, ...(x.file === undefined ? {} : { file: x.file }) });
      }
      if (restored.length === 0) return { hydrated: { ...s.hydrated, [key]: true } };
      const pendingIds = pendingRestored.sort((a, b) => a.ord - b.ord).map((x) => x.id);
      return {
        messages: { ...s.messages, [key]: restored },
        hydrated: { ...s.hydrated, [key]: true },
        ...(pendingIds.length === 0 ? {} : {
          pending: { ...s.pending, [key]: pendingIds },
          // Sends are still in flight, so the thread IS generating — restored
          // exactly as unresolved, never quietly demoted to terminal.
          genState: { ...s.genState, [key]: 'generating' as GenState },
        }),
      };
    }),

  markNotRecorded: (key, id, notRecorded) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: (s.messages[key] ?? []).map((m) =>
          m.kind === 'user' && m.id === id ? { ...m, notRecorded } : m),
      },
    })),

  addNarration: (key, text) =>
    set((s) => ({ messages: append(s.messages, key, { kind: 'narration', id: nextMsgId(), text }) })),

  addAgentMsg: (key, author, text, artifact) => {
    set((s) => ({
      messages: append(s.messages, key, {
        kind: 'agent', id: nextMsgId(), author, text,
        ...(artifact === undefined ? {} : { href: artifact.href }),
        ...(artifact?.file === undefined ? {} : { file: artifact.file }),
      }),
    }));
    // Round-3 minor: a downloadable artifact message (an export) is state the
    // announce history does not carry — record it so the reload restores it.
    if (artifact !== undefined) {
      recordExport(key, { text, href: artifact.href,
                          ...(artifact.file === undefined ? {} : { file: artifact.file }) });
    }
  },

  addActionable: (key, text, hint, retry) =>
    set((s) => ({
      messages: append(s.messages, key, {
        kind: 'actionable', id: nextMsgId(), text, hint,
        ...(retry === undefined ? {} : { retry }),
      }),
    })),

  expectDivider: (key, msgId, version) =>
    set((s) => ({
      expectedDividers: {
        ...s.expectedDividers,
        [key]: [...(s.expectedDividers[key] ?? []), { msgId, version }],
      },
    })),

  setGenState: (key, state) => set((s) => ({ genState: { ...s.genState, [key]: state } })),

  clear: (key) =>
    set((s) => {
      const messages = { ...s.messages }; delete messages[key];
      const genState = { ...s.genState }; delete genState[key];
      const pending = { ...s.pending }; delete pending[key];
      const hydrated = { ...s.hydrated }; delete hydrated[key];
      const landed = { ...s.landed }; delete landed[key];
      const lastError = { ...s.lastError }; delete lastError[key];
      const lastSignalAt = { ...s.lastSignalAt }; delete lastSignalAt[key];
      const expectedDividers = { ...s.expectedDividers }; delete expectedDividers[key];
      return { messages, genState, pending, hydrated, landed, lastError, lastSignalAt, expectedDividers };
    }),
}));
