import { BridgeUnavailableError, type LearnedTheme } from '../api/interactive.js';

/**
 * The bounded readback poll behind the /theme brand-learn flow.
 *
 * A learn is fire-and-forget on the wire (`theme.requested` acks with an
 * EventAck; the work happens on the bridge), so the ONLY way to know the
 * tokens landed is to poll `GET /d/:docId/api/theme/learned` (interactive#181)
 * until its 404 turns 200. The hard constraints this module owns:
 *
 *   - BOUNDED: the schedule below is the whole lifetime — a gentle backoff
 *     to a 5s cadence, hard-capped at ~66s of waiting. No interval survives
 *     the outcome; there is nothing to leak.
 *   - CANCELLABLE: the caller's AbortSignal ends the loop at the next seam
 *     (including mid-sleep). Unmount aborts; navigation aborts.
 *   - HONEST about refusals: the bridge reports failures ASYNC as
 *     `status.posted {state:"error"}` frames (the SSRF guard's refusal, a
 *     failed grab). `bridgeError` is read every tick so a refusal ends the
 *     wait with the bridge's OWN sentence instead of a timeout shrug.
 *   - a FLAKY poll is not a failed learn: a thrown fetch keeps the loop
 *     alive (remembered for the timeout report) — except the typed 503,
 *     which means the bridge itself is gone and waiting cannot help.
 */

/** ~66s total: 1s → 5s backoff, then a 5s cadence. */
export const LEARN_POLL_DELAYS_MS: readonly number[] = [
  1_000, 1_500, 2_500, 4_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000,
  5_000, 5_000, 5_000, 5_000,
];

export type LearnPollOutcome =
  | { kind: 'learned'; result: LearnedTheme }
  | { kind: 'bridge-error'; reason: string }
  | { kind: 'cancelled' }
  | { kind: 'timeout'; attempts: number; lastFetchError: string | null };

export interface LearnPollDeps {
  /** One readback attempt — `getLearnedTheme`: the result, or null while 404. */
  fetchLearned: () => Promise<LearnedTheme | null>;
  /** The bridge's async refusal, if one has arrived since the learn was fired
   *  (the docThread store's `lastError` behind an identity snapshot). */
  bridgeError?: () => string | null;
  signal: AbortSignal;
  /** Test seam: the backoff schedule (defaults to LEARN_POLL_DELAYS_MS). */
  delays?: readonly number[];
  /** Test seam: the sleeper (defaults to an abort-aware setTimeout). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** setTimeout that resolves EARLY on abort — the loop re-checks at the top. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort(): void { clearTimeout(timer); resolve(); }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollLearnedTheme(deps: LearnPollDeps): Promise<LearnPollOutcome> {
  const { fetchLearned, bridgeError, signal } = deps;
  const delays = deps.delays ?? LEARN_POLL_DELAYS_MS;
  const sleep = deps.sleep ?? abortableSleep;
  let lastFetchError: string | null = null;

  // delays.length sleeps ⇒ delays.length + 1 attempts, then the hard cap.
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (signal.aborted) return { kind: 'cancelled' };
    const refusal = bridgeError?.() ?? null;
    if (refusal !== null) return { kind: 'bridge-error', reason: refusal };
    try {
      const result = await fetchLearned();
      if (result !== null) return { kind: 'learned', result };
    } catch (e: unknown) {
      // The bridge itself is gone — waiting cannot land tokens.
      if (e instanceof BridgeUnavailableError) return { kind: 'bridge-error', reason: e.message };
      lastFetchError = e instanceof Error ? e.message : String(e);
    }
    if (signal.aborted) return { kind: 'cancelled' };
    if (attempt < delays.length) await sleep(delays[attempt] as number, signal);
  }
  return { kind: 'timeout', attempts: delays.length + 1, lastFetchError };
}
