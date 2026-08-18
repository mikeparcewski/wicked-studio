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
import { isWhimsy } from './narration.js';
import type { CoreEvent } from '../api/types.js';

// ── Transcript ───────────────────────────────────────────────────────────────

/**
 * One targeted comment from the point-and-comment overlay (§4.3, slices 11+12). `wid`
 * is the document's own stable anchor (INV-1), which is what makes the item deep-linkable
 * back to its element for as long as the element exists.
 */
export interface FeedbackItem { wid: string; text: string }

export type DocMsg =
  // `items` is set only for a submitted feedback batch: ONE message, N targets (§4.3 —
  // sending each comment separately would produce N versions and N runs). `notRecorded`
  // is §7.7's failure shape: the bus event landed and the document still updates, but the
  // inject that puts this message in the run did not — retryable, never silent.
  | { kind: 'user';      id: string; text: string; version?: number;
      items?: FeedbackItem[]; notRecorded?: boolean }
  | { kind: 'narration'; id: string; text: string }
  | { kind: 'agent';     id: string; author: string; text: string; href?: string }
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

/** A relayed interactive frame, reduced to `(thread key, event type, payload)`. */
function frameOf(event: CoreEvent): Frame | null {
  if (event.type !== 'interactiveEvent') return null;
  const ev = event.event as Record<string, unknown> | undefined;
  if (typeof ev !== 'object' || ev === null) return null;
  const type = pick(ev, 'event_type', 'type');
  const payload = (typeof ev.payload === 'object' && ev.payload !== null ? ev.payload : ev) as Record<string, unknown>;
  const docId = pick(payload, 'document_id', 'doc_id', 'document');
  const projectId = pick(payload, 'project_id', 'project') ?? pick(ev, 'project_id', 'project');
  if (type === null || docId === null || projectId === null) return null;
  return { key: threadKey(projectId, docId), type, payload };
}

/** The one spelling of a thread's identity. Thread id = the doc's lineage (§2.4). */
export function threadKey(projectId: string, docId: string): string {
  return `${projectId}:${docId}`;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface DocThreadStore {
  messages: Record<string, DocMsg[]>;
  /** What the stream last said the generation is doing, per thread. */
  genState: Record<string, GenState>;
  /** The user message a landing version will be tagged with (§7.6, client half). */
  anchor: Record<string, string>;
  /** Fold one CoreEvent — every non-interactive frame is ignored. */
  ingest: (event: CoreEvent) => void;
  /** Append the user's message and make it the pending version anchor. */
  addUserMsg: (key: string, id: string, text: string, items?: FeedbackItem[]) => void;
  /** Flag/clear §7.7's "not recorded in the run" chip on one already-rendered message. */
  markNotRecorded: (key: string, id: string, notRecorded: boolean) => void;
  /** Append a client-authored informative line (§3.3) — an action the user took. */
  addNarration: (key: string, text: string) => void;
  /** The version divider a fork+inject continuation renders behind (§7.10). */
  addDivider: (key: string, version: number) => void;
  setGenState: (key: string, state: GenState) => void;
  clear: (key: string) => void;
}

/** Append one message to a thread. */
function append(messages: Record<string, DocMsg[]>, key: string, msg: DocMsg): Record<string, DocMsg[]> {
  return { ...messages, [key]: [...(messages[key] ?? []), msg] };
}

export const useDocThreadStore = create<DocThreadStore>((set) => ({
  messages: {},
  genState: {},
  anchor: {},

  ingest: (event) => {
    const frame = frameOf(event);
    if (frame === null) return;
    const { key, type, payload } = frame;

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
        // §3.2: filler never reaches the transcript, but a filtered frame still carries
        // the state transition it rode in on — dropping the LINE is not dropping the fact.
        if (text === null || isWhimsy(text)) return { genState: { ...s.genState, [key]: next } };
        return {
          messages: append(messages, key, { kind: 'narration', id: nextMsgId(), text }),
          genState: { ...s.genState, [key]: next },
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
      if (type === EXPORTED) {
        const format = pick(payload, 'format') ?? 'file';
        const file = pick(payload, 'file') ?? format;
        const href = pick(payload, 'download');
        return {
          messages: append(messages, key, {
            kind: 'agent', id: nextMsgId(), author: 'export',
            text: `${format.toUpperCase()} export ready — ${file}`,
            ...(href === null ? {} : { href }),
          }),
        };
      }

      // §7.6, client half: the version the generation just landed is tagged onto the user
      // message that triggered it, so slice 9's strip has a message to scroll to. The
      // service half writes the same id into `versions.json`; this is what makes the
      // anchor resolvable in the session that produced it.
      if (type === VERSION) {
        const raw = payload.version;
        const version = typeof raw === 'number' ? raw : Number(pick(payload, 'version') ?? NaN);
        const kind = pick(payload, 'kind') ?? '';
        if (!Number.isInteger(version)) return s;
        const anchorId = s.anchor[key];
        const generated = GENERATED.has(kind);
        const tagged = anchorId === undefined
          ? messages
          : {
              ...messages,
              [key]: (messages[key] ?? []).map((m) =>
                m.kind === 'user' && m.id === anchorId ? { ...m, version } : m),
            };
        const anchor = { ...s.anchor };
        if (generated) delete anchor[key];
        return {
          messages: tagged,
          anchor,
          genState: generated ? { ...s.genState, [key]: 'terminal' } : s.genState,
        };
      }

      return s;
    });
  },

  addUserMsg: (key, id, text, items) =>
    set((s) => ({
      messages: append(s.messages, key, { kind: 'user', id, text, ...(items ? { items } : {}) }),
      anchor: { ...s.anchor, [key]: id },
    })),

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

  addDivider: (key, version) =>
    set((s) => ({ messages: append(s.messages, key, { kind: 'divider', id: nextMsgId(), version }) })),

  setGenState: (key, state) => set((s) => ({ genState: { ...s.genState, [key]: state } })),

  clear: (key) =>
    set((s) => {
      const messages = { ...s.messages }; delete messages[key];
      const genState = { ...s.genState }; delete genState[key];
      const anchor = { ...s.anchor }; delete anchor[key];
      return { messages, genState, anchor };
    }),
}));
