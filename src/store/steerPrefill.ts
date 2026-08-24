/**
 * Guidance-as-prefill (DES-UX-002 §3.3, slice BC): the work chronicle's
 * "use in next run" action deposits a past gate amendment here and navigates
 * to the standard composer, which consumes it ONCE at mount and shows it in an
 * editable steer field. The same consume-once discipline as the retry prefill
 * (`retryPrefill.ts`) — peek in the lazy initializer (StrictMode double-invokes
 * initializers in dev), clear in the commit effect.
 *
 * The wire has no steer/guidance field on `LaunchRunBody` (wire honesty:
 * CREW-UX-4 is the durable-guidance endpoint, slice BE) — so at launch the
 * composer folds the steer text into the `problem` body as a labelled trailing
 * paragraph, visibly: the operator sees exactly the text that will ride.
 */
export interface SteerPrefill {
  /** The amendment text to pre-populate in the composer's steer field. */
  steer: string;
  /** The project the guidance came from — the composer's pre-bind hint. */
  projectId: string | null;
}

let pending: SteerPrefill | null = null;

export function setSteerPrefill(prefill: SteerPrefill): void {
  pending = prefill;
}

/** Read WITHOUT consuming — for lazy `useState` initializers (see module doc). */
export function peekSteerPrefill(): SteerPrefill | null {
  return pending;
}

/** The second half of peek-then-clear: drop the deposit once a mount took it. */
export function clearSteerPrefill(): void {
  pending = null;
}
