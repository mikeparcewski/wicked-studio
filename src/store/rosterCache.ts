import type { RosterSeat } from '../api/types.js';

/**
 * The agent-roster cache (DES-FEEDBACK-001 §6.1/§6.2, slice C).
 *
 * Chat's default agent chips must render on FIRST paint with zero network
 * requests (DES-UXFIX-001 §2.4 — the binding constraint). The roster they
 * render from is therefore never fetched on Chat's mount: this module holds
 * the list the app has ALREADY fetched — every `api.getRoster()` call site
 * (the Build launch form on startup, Settings, Chat's [+ Add] picker — a
 * user action) deposits its answer here — and Chat reads it synchronously.
 * When nothing has been deposited yet, Chat falls back to the hardcoded
 * `DEFAULT_CHAT_AGENTS` constant (§6.2) rather than fetching.
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
 * Warm-roster notification (DES-UX-001 §7.9-1): a surface whose defaults were
 * seeded while the cache was cold (the fallback trio) hears the deposit that
 * arrives later — e.g. the launch form's startup fetch landing after Chat
 * mounted — so a warm roster beats the fallback without any new fetch. The
 * subscription itself can never fire a request (§2.4 holds unchanged).
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
