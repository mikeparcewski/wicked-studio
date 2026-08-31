/**
 * Awaiting-record pins (DES-RUN-NARRATOR §11.5).
 *
 * The gate and elicitation stores self-heal against the RUN list: every
 * `GET /runs` reconcile prunes records whose id the fetched universe cannot
 * vouch for. That is correct for runs — and wrong for the chat surface, whose
 * gates/elicitations the daemon keys by the CHAT session id, an id that is
 * never in `GET /runs`. Without a pin, the §11.5 dock mounts on
 * `awaitingHuman` and is swept ~400 ms later by the very refresh that frame
 * triggered (verified live against crew 0.7.4).
 *
 * A surface that OWNS an id outside the run universe pins it for its mounted
 * lifetime; both reconciles skip pinned ids. Counted, not boolean, so React
 * StrictMode's synthetic remount (and any future second surface on the same
 * id) cannot unpin early. Event-driven clears (`gateDecided`,
 * `sessionCompleted`, an answered gate's `clearGate`) are untouched — a pin
 * only shields against the run-universe prune, never against real resolution.
 */
const counts = new Map<string, number>();

/** Pin `id`; returns the matching unpin (call it exactly once, e.g. as an
 *  effect cleanup). */
export function pinAwaiting(id: string): () => void {
  counts.set(id, (counts.get(id) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (counts.get(id) ?? 0) - 1;
    if (n <= 0) counts.delete(id);
    else counts.set(id, n);
  };
}

/** True while any surface holds a pin on `id`. */
export function isAwaitingPinned(id: string): boolean {
  return (counts.get(id) ?? 0) > 0;
}
