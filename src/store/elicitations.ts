import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/**
 * A browser-side open-elicitation record, keyed by run id (DES-002).
 *
 * An MCP server inside an ACP session calls `elicitation/create` when it needs a human answer.
 * The daemon caches it and broadcasts `elicitationCreated`; this store is the browser's mirror,
 * event-sourced the same way `useGateStore` mirrors open gates.
 *
 * # Why every mutation bumps a generation
 *
 * Late-join rehydration does `GET /runs/:id/elicitation`, and that request takes time. In that
 * window a WebSocket frame can resolve the elicitation, or open a DIFFERENT one. A naive
 * "if empty, set it" guard resurrects a prompt the operator already answered — DES-002 v0.23
 * records exactly that race.
 *
 * So the store is a compare-and-swap: `getRunGen()` snapshots before the GET,
 * `setFromGetIfUnchanged()` writes back only if nothing moved. Any ingest, clear or reconcile
 * bumps the generation, which is what makes a stale write a no-op rather than a resurrection.
 */
export interface OpenElicitation {
  runId: string;
  elicitationId: string;
  message: string;
  /** Ordered set of valid responses; `null` means free-text. */
  options: string[] | null;
  receivedAt: string;
}

interface ElicitationStore {
  elicitations: Record<string, OpenElicitation>;
  /** Per-run mutation counter. Bumped by EVERY write, which is what makes the CAS work. */
  generations: Record<string, number>;

  /** The generation to snapshot before an async GET. */
  getRunGen: (runId: string) => number;
  /** Upsert from a live event or a direct set. Bumps the generation. */
  setElicitation: (e: OpenElicitation) => void;
  /** Drop a run's elicitation. Bumps the generation. */
  clearElicitation: (runId: string) => void;
  /**
   * Write a GET result back ONLY if the run's generation is unchanged since `gen`.
   *
   * Returns whether it applied — callers that care can log the near-miss. A `false` here is the
   * store refusing to resurrect a prompt that a concurrent WS frame already superseded.
   */
  setFromGetIfUnchanged: (runId: string, gen: number, e: OpenElicitation | null) => boolean;
  /**
   * Replace a KNOWN-stale entry with the server's current one (DES-002 v0.22).
   *
   * Used on a 409 from POST: our elicitationId was stale, so we refetch. Guarded on the stale id
   * so a WS-delivered newer elicitation is never clobbered by this recovery path.
   */
  swapFromGet: (runId: string, staleId: string, e: OpenElicitation | null) => boolean;
  /** Fold one CoreEvent in. */
  ingest: (event: CoreEvent) => void;
  /** Self-healing prune: drop elicitations for runs that are gone or terminal. */
  reconcile: (liveRunIds: string[]) => void;
}

/** Bump helper — every mutation path goes through this, so none can forget. */
function bumped(gens: Record<string, number>, runId: string): Record<string, number> {
  return { ...gens, [runId]: (gens[runId] ?? 0) + 1 };
}

export const useElicitationStore = create<ElicitationStore>((set, get) => ({
  elicitations: {},
  generations: {},

  getRunGen: (runId) => get().generations[runId] ?? 0,

  setElicitation: (e) =>
    set((s) => ({
      elicitations: { ...s.elicitations, [e.runId]: e },
      generations: bumped(s.generations, e.runId),
    })),

  clearElicitation: (runId) =>
    set((s) => {
      // Bump even when there was nothing to clear: an in-flight GET snapshotted a generation and
      // must not be allowed to write after a resolve, whether or not we held an entry at the time.
      const next = { ...s.elicitations };
      delete next[runId];
      return { elicitations: next, generations: bumped(s.generations, runId) };
    }),

  setFromGetIfUnchanged: (runId, gen, e) => {
    let applied = false;
    set((s) => {
      if ((s.generations[runId] ?? 0) !== gen) return s; // superseded mid-flight — drop it
      applied = true;
      const next = { ...s.elicitations };
      if (e === null) delete next[runId];
      else next[runId] = e;
      return { elicitations: next, generations: bumped(s.generations, runId) };
    });
    return applied;
  },

  swapFromGet: (runId, staleId, e) => {
    let applied = false;
    set((s) => {
      // Only replace the entry we believe is stale. If a WS frame already delivered a different
      // elicitation, that one wins and this recovery is a no-op.
      if (s.elicitations[runId]?.elicitationId !== staleId) return s;
      applied = true;
      const next = { ...s.elicitations };
      if (e === null) delete next[runId];
      else next[runId] = e;
      return { elicitations: next, generations: bumped(s.generations, runId) };
    });
    return applied;
  },

  ingest: (event) => {
    const runId = typeof event.session === 'string' ? event.session : undefined;
    if (runId === undefined) return;
    if (event.type === 'elicitationCreated') {
      const id = event.elicitationId;
      const message = event.message ?? event.prompt;
      if (typeof id !== 'string' || typeof message !== 'string') return;
      get().setElicitation({
        runId,
        elicitationId: id,
        message,
        options: Array.isArray(event.options) ? event.options : null,
        receivedAt: new Date().toISOString(),
      });
      return;
    }
    // Any terminal or resolution signal closes the prompt. Listed explicitly rather than
    // defaulting to "clear on anything unknown", which would drop a live prompt on an
    // unrelated event type.
    if (
      event.type === 'elicitationResolved' ||
      event.type === 'sessionCompleted' ||
      event.type === 'sessionFailed' ||
      event.type === 'sessionCancelled'
    ) {
      get().clearElicitation(runId);
    }
  },

  reconcile: (liveRunIds) => {
    const live = new Set(liveRunIds);
    set((s) => {
      const dropped = Object.keys(s.elicitations).filter((runId) => !live.has(runId));
      // Identity-stable when nothing is dropped: reconcile runs on EVERY run-list refresh, so
      // returning fresh objects each time rerenders every subscriber for no change.
      if (dropped.length === 0) return s;

      const next: Record<string, OpenElicitation> = {};
      for (const [runId, e] of Object.entries(s.elicitations)) {
        if (live.has(runId)) next[runId] = e;
      }
      // Each dropped run must still bump, so a GET in flight for it cannot write back afterwards
      // (DES-002 v0.25 — the zombie-prompt case).
      let gens = s.generations;
      for (const runId of dropped) gens = bumped(gens, runId);
      return { elicitations: next, generations: gens };
    });
  },
}));
