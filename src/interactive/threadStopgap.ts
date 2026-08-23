// The session-storage half of thread persistence (DES-UX-001 §6.3, slice T).
//
// BRIDGE-UX-1 probe 2 (§8.4.1) fixed the split: the bridge's
// `GET /d/:doc/api/conversation` is a REAL history read — role/text/ts(/state)
// only — so thread TEXT rehydrates from the wire on doc open. What the wire
// genuinely lacks is the version↔message correlation (`source_message_id` is
// dropped at append and `version.created` never enters the transcript), so the
// VERSION ANCHORS — and only they — stay in session-scoped storage: what this
// browser session observed, keyed by thread.
//
// The correlation is by USER-MESSAGE ORDINAL (1-based, counting only `kind:
// "user"` messages): the wire returns every user line in send order, and the
// bridge processes sends FIFO (probe 1), so "the Nth user message" is a stable
// address across a reload — the same order-correlation the live anchor queue
// rides. No message ids are persisted because they are minted per session.

/** One observed landing: the Nth user message produced this version. */
export interface StoredAnchor { ord: number; version: number }

function storageKey(threadKey: string): string {
  return `wk-thread-anchors:${threadKey}`;
}

/** Session storage can be absent (jsdom configs) or full — both degrade to the
 *  honest gap the stopgap banner states, never a throw. */
function safeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The anchors this session (and its reloads) observed for one thread. */
export function readAnchors(threadKey: string): StoredAnchor[] {
  const storage = safeStorage();
  if (storage === null) return [];
  try {
    const raw = storage.getItem(storageKey(threadKey));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((a): a is StoredAnchor =>
      typeof a === 'object' && a !== null
      && Number.isInteger((a as StoredAnchor).ord)
      && Number.isInteger((a as StoredAnchor).version));
  } catch {
    return [];
  }
}

/** Record one landing at tag time. A re-tag of the same ordinal (fork, then the
 *  generation that follows it, §7.10) replaces the earlier entry. */
export function recordAnchor(threadKey: string, ord: number, version: number): void {
  const storage = safeStorage();
  if (storage === null) return;
  try {
    const kept = readAnchors(threadKey).filter((a) => a.ord !== ord);
    storage.setItem(storageKey(threadKey), JSON.stringify([...kept, { ord, version }]));
  } catch {
    // Full or refused storage: the anchor is simply not restorable next reload.
  }
}

// ── Send states (round-3 J3, finding 4) ───────────────────────────────────────
//
// A send that has not RESOLVED is state the wire does not carry: the conversation
// read returns accepted user lines with no notion of "answered", "failed" or
// "stalled", so a reload used to re-render every unresolved send as a plain
// accepted message — the failure (and its retry) silently vanished. The stopgap
// persists each thread's unresolved sends the same way it persists anchors:
// session-scoped, addressed by ACCEPTED-user-line ordinal.
//
//   - `state:"pending"`  an accepted send still awaiting its landing. `sentAt`
//     rides along so the §6.1 honesty budget RESUMES across the reload instead
//     of re-arming (a send that was already stalled stays visibly stalled).
//   - `state:"failed"` with no `text`: an accepted send whose run died (the
//     status-error backlog kill) — the wire holds its line; the flag re-attaches.
//   - `state:"failed"` WITH `text`: a REFUSED send — the bridge never accepted
//     it, so the wire has no line to attach to. `ord` is the accepted ordinal it
//     follows (0 = before any), and `text` lets the reload re-render the message
//     itself, wearing its failure and its retry.

export interface StoredSendState {
  /** For accepted sends: their 1-based ordinal among accepted user lines.
   *  For refused sends: the accepted ordinal they FOLLOW (0 = the thread start). */
  ord: number;
  state: 'pending' | 'failed';
  sentAt: number;
  /** Present only on refused sends — the wire has no copy of the message. */
  text?: string;
}

function sendsKey(threadKey: string): string {
  return `wk-thread-sends:${threadKey}`;
}

/** The unresolved sends this session (and its reloads) still owes answers for. */
export function readSendStates(threadKey: string): StoredSendState[] {
  const storage = safeStorage();
  if (storage === null) return [];
  try {
    const raw = storage.getItem(sendsKey(threadKey));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is StoredSendState =>
      typeof s === 'object' && s !== null
      && Number.isInteger((s as StoredSendState).ord)
      && ((s as StoredSendState).state === 'pending' || (s as StoredSendState).state === 'failed')
      && typeof (s as StoredSendState).sentAt === 'number');
  } catch {
    return [];
  }
}

/** Replace the thread's unresolved-send snapshot wholesale — the writer derives
 *  it from the live projection after every mutation, so replace-all is the only
 *  write that cannot drift. */
export function writeSendStates(threadKey: string, states: StoredSendState[]): void {
  const storage = safeStorage();
  if (storage === null) return;
  try {
    if (states.length === 0) storage.removeItem(sendsKey(threadKey));
    else storage.setItem(sendsKey(threadKey), JSON.stringify(states));
  } catch {
    // Full or refused storage: the send states simply do not survive the reload.
  }
}

// ── Export entries (round-3 minor: the transcript's downloads survive reload) ──
//
// An export lands in the thread as an agent message carrying its download
// (§4.4), but the announce history carries no exports — so a reload dropped
// them. Session-scoped, deduplicated on href; restored at the transcript tail.

export interface StoredExport { text: string; href: string; file?: string }

function exportsKey(threadKey: string): string {
  return `wk-thread-exports:${threadKey}`;
}

export function readExports(threadKey: string): StoredExport[] {
  const storage = safeStorage();
  if (storage === null) return [];
  try {
    const raw = storage.getItem(exportsKey(threadKey));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is StoredExport =>
      typeof e === 'object' && e !== null
      && typeof (e as StoredExport).text === 'string'
      && typeof (e as StoredExport).href === 'string');
  } catch {
    return [];
  }
}

export function recordExport(threadKey: string, entry: StoredExport): void {
  const storage = safeStorage();
  if (storage === null) return;
  try {
    const kept = readExports(threadKey).filter((e) => e.href !== entry.href);
    storage.setItem(exportsKey(threadKey), JSON.stringify([...kept, entry]));
  } catch {
    // Full or refused storage: the export message is simply not restorable.
  }
}
