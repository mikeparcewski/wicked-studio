import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';
import { isAwaitingPinned } from './awaitingPins.js';
import type { ElicitationMulti } from '../api/ask.js';

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
  /** (ask) The seat key that asked — the frame's additive `seat` (wicked-core, ask frames only). */
  seat?: string;
  /** (ask) The asking unit's ordinal — the frame's additive `ord`. */
  ord?: number;
  /** (C3) The index into `options` the producer recommends: marked and preselected. */
  recommended?: number;
  /** (guided asks, api-types 0.153.0) A multi-select's bounds: the answer picks several (`content.values`). */
  multi?: ElicitationMulti;
}

/**
 * How the question is answered, as the wire says it: the producer's recommended option (C3) and a multi-select's
 * bounds (api-types 0.153.0). Kept only when well-formed against `options`; absent otherwise.
 */
export function answerShapeOf(raw: unknown): Pick<OpenElicitation, 'recommended' | 'multi'> {
  if (raw === null || typeof raw !== 'object') return {};
  const { options, recommended, multi } = raw as { options?: unknown; recommended?: unknown; multi?: unknown };
  if (!Array.isArray(options) || options.length === 0) return {};
  const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  const m = multi !== null && typeof multi === 'object' ? multi as { min?: unknown; max?: unknown } : null;
  return {
    ...(int(recommended) && recommended >= 0 && recommended < options.length ? { recommended } : {}),
    ...(m !== null && int(m.min) && int(m.max) && m.min >= 1 && m.min <= m.max && m.max <= options.length ? { multi: { min: m.min, max: m.max } } : {}),
  };
}

/**
 * Who asked, as the wire says it: an ask question's `elicitationCreated` frame (and, on a daemon that
 * keeps them, the `GET /runs/:id/elicitation` body) carries the asking seat and unit ordinal. Kept only
 * when well-formed; absent on an older daemon or another producer, and then the card names the step
 * the run is on (`askingResponder`).
 */
export function askerOf(raw: unknown): Pick<OpenElicitation, 'seat' | 'ord'> {
  if (raw === null || typeof raw !== 'object') return {};
  const { seat, ord } = raw as { seat?: unknown; ord?: unknown };
  return {
    ...(typeof seat === 'string' && seat.trim() !== '' ? { seat } : {}),
    ...(typeof ord === 'number' && Number.isInteger(ord) && ord >= 0 ? { ord } : {}),
  };
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
        ...askerOf(event),
        ...answerShapeOf(event),
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
      // Pinned ids live outside the run universe (§11.5 — a chat-keyed
      // elicitation is never in GET /runs); the prune must not eat them.
      const dropped = Object.keys(s.elicitations).filter(
        (runId) => !live.has(runId) && !isAwaitingPinned(runId),
      );
      // Identity-stable when nothing is dropped: reconcile runs on EVERY run-list refresh, so
      // returning fresh objects each time rerenders every subscriber for no change.
      if (dropped.length === 0) return s;

      const droppedSet = new Set(dropped);
      const next: Record<string, OpenElicitation> = {};
      for (const [runId, e] of Object.entries(s.elicitations)) {
        if (!droppedSet.has(runId)) next[runId] = e;
      }
      // Each dropped run must still bump, so a GET in flight for it cannot write back afterwards
      // (DES-002 v0.25 — the zombie-prompt case).
      let gens = s.generations;
      for (const runId of dropped) gens = bumped(gens, runId);
      return { elicitations: next, generations: gens };
    });
  },
}));
