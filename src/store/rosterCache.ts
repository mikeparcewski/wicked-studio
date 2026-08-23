import type { RosterSeat } from '../api/types.js';

/**
 * The agent-roster cache (DES-FEEDBACK-001 §6.1/§6.2, slice C).
 *
 * Chat's default agent chips render on FIRST paint with zero network requests
 * whenever a roster is already known (DES-UXFIX-001 §2.4): this module holds
 * the list the app has ALREADY fetched — every `api.getRoster()` call site
 * (the Build launch form on startup, Settings, Chat's [+ Add] picker, Chat's
 * own cold-cache mount resolve — the EC44-named request) deposits its answer
 * here — and Chat reads it synchronously. When nothing has been deposited
 * yet, Chat renders an honest resolving state and resolves it (BRIEF-UX-001
 * C6/EC44: the chips are truth — there is NO hardcoded fallback set any
 * more, because a chip must never claim a seat the send won't connect).
 *
 * Plain module state, not a zustand store: no component re-renders when the
 * cache fills — it is read at decision points (chip initialization, picker
 * open), never subscribed to.
 */

let cached: RosterSeat[] | null = null;
const listeners = new Set<(roster: RosterSeat[]) => void>();

/** The last roster any surface fetched, or `null` when none has yet. */
export function getCachedRoster(): RosterSeat[] | null {
  return cached;
}

/** Deposit a freshly fetched roster for later synchronous reads. */
export function setCachedRoster(roster: RosterSeat[]): void {
  cached = roster;
  for (const fn of listeners) fn(roster);
}

/**
 * Warm-roster notification (DES-UX-001 §7.9-1): a surface that mounted while
 * the cache was cold (rendering its resolving state) hears the deposit that
 * arrives later — its own resolve, or e.g. the launch form's startup fetch
 * landing first — and seeds its chips from it. The subscription itself can
 * never fire a request (§2.4 holds unchanged).
 */
export function subscribeRoster(fn: (roster: RosterSeat[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test hook: return to the cold-start state. */
export function clearCachedRoster(): void {
  cached = null;
  listeners.clear();
}
