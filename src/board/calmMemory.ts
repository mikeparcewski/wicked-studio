import type { MemoryItem } from '../api/memory.js';

/**
 * The calm Memory page's words (the operator-approved pages mockup, 2026-10-26): where a memory
 * came from, the page's one sentence, and a row's short date. Pure; pinned by unit test.
 */

export type MemoryOrigin = 'told' | 'session';

const SESSION_FACETS = ['run', 'run_id', 'session', 'session_id', 'chat', 'chat_id', 'agent', 'run_agent'] as const;
const TOLD_SOURCES: ReadonlySet<string> = new Set(['operator', 'user', 'told', 'you', 'studio']);

/**
 * Where a memory came from, when the store says: told by you (an operator scope, or a `source`
 * facet naming the operator), or learned in a session (a run, chat or agent facet, or a run or
 * session segment in its scope). `null` when the memory carries neither — the row says its kind
 * instead, never a guess.
 */
export function memoryOrigin(m: Pick<MemoryItem, 'scope' | 'facets'>): MemoryOrigin | null {
  const source = (m.facets.source ?? m.facets.origin ?? '').toLowerCase();
  if (TOLD_SOURCES.has(source)) return 'told';
  const segs = m.scope.split('/').map((s) => s.split(':')[0] ?? '');
  if (segs[0] === 'operator' || segs[0] === 'user') return 'told';
  if (SESSION_FACETS.some((k) => (m.facets[k] ?? '') !== '')) return 'session';
  if (source === 'session' || source === 'run' || source === 'agent') return 'session';
  if (segs.some((s) => s === 'run' || s === 'session' || s === 'chat')) return 'session';
  return null;
}

/** The page's one sentence: "Your agents remember 333 things. 2 proposals are waiting for you." */
export function memorySentence({ total, pending, coverage }: {
  total: number | null; pending: number | null | 'unsupported'; coverage: 'loading' | 'ok' | 'unsupported' | 'failed';
}): string {
  const kept = total !== null
    ? total === 0 ? 'Your agents haven’t learned anything yet.' : `Your agents remember ${total} ${total === 1 ? 'thing' : 'things'}, and where each came from.`
    : coverage === 'loading' ? 'Reading what your agents have learned…' : 'What your agents have learned, and where it came from.';
  const waiting = typeof pending !== 'number' || pending === 0 ? '' : ` ${pending} ${pending === 1 ? 'proposal is' : 'proposals are'} waiting for you.`;
  return `${kept}${waiting}`;
}

/** "Oct 23" this year, "Oct 23, 2025" before it. */
export function shortDate(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
