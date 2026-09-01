import { create } from 'zustand';
import { api } from '../api/client.js';

/**
 * Post-hoc delivery (crew#393) — the one-click "Deliver" on a STRANDED run's
 * Delivery card: `POST /runs/:id/deliver` lifts the completed run's worktree
 * into a PR with the same hardened script the deliver phase runs.
 *
 * The store holds one {@link PostHocDeliver} per run id so the card, the rail
 * badge and any future surface read the SAME in-flight/answered fact and cannot
 * disagree (the D1 rule, applied to this write):
 *
 *  - `'delivering'` — the POST is in flight; the button disables. A synchronous
 *    in-flight guard means a double-click never doubles the POST (the endpoint
 *    is idempotent AND 409s an in-flight duplicate, but studio does not lean on
 *    either — one click, one request).
 *  - `'delivered'`  — 200 `{prUrl}`. The url feeds `resolveDelivery` as its
 *    `readUrl`, so the card flips to the pr-open arm in place, without waiting
 *    for the next DTO refresh.
 *  - `'error'`      — the LOUD failure, verbatim (denialCopy's standing rule:
 *    the headline is studio's, the detail is the engine's own words — a 409
 *    carries the deliver script's own message, e.g. the rebase-conflict text
 *    with nothing pushed). Never silent, never re-worded. A later click retries
 *    from scratch — the endpoint is idempotent, so a retry can never open a
 *    second PR.
 */
export type PostHocDeliver =
  | { phase: 'delivering' }
  | { phase: 'delivered'; prUrl: string }
  | { phase: 'error'; error: string };

interface PostHocDeliverStore {
  /** Per run id. ABSENT = never attempted this session. */
  byRun: Record<string, PostHocDeliver>;
  /** Fire the POST for one run. No-op while one is already in flight, and after
   *  a success (the answered `prUrl` stands — idempotent server-side too). */
  deliver: (runId: string) => void;
}

export const usePostHocDeliverStore = create<PostHocDeliverStore>((set, get) => ({
  byRun: {},

  deliver: (runId) => {
    const current = get().byRun[runId];
    if (current?.phase === 'delivering' || current?.phase === 'delivered') return;
    set((s) => ({ byRun: { ...s.byRun, [runId]: { phase: 'delivering' } } }));
    api
      .deliverRun(runId)
      .then(({ prUrl }) => {
        set((s) => ({ byRun: { ...s.byRun, [runId]: { phase: 'delivered', prUrl } } }));
      })
      .catch((err: unknown) => {
        // ApiError.message is already the body's `error` (the script's own
        // words) — apiFetch extracted it. Kept VERBATIM; empty degrades to a
        // plain sentence rather than a blank red paragraph (the absent-and-
        // empty-are-one-thing rule from store/delivery.ts).
        const raw = err instanceof Error ? err.message : String(err);
        const error = raw.trim() !== '' ? raw : 'the daemon rejected the delivery and gave no reason';
        set((s) => ({ byRun: { ...s.byRun, [runId]: { phase: 'error', error } } }));
      });
  },
}));
