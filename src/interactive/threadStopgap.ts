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
