import { rememberProposalRuns } from '../board/planRevBinding.js';
import { useAskThreadStore } from '../store/askThread.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';
import { useCapabilities } from '../store/capabilities.js';
import { useGateStore } from '../store/gates.js';
import { answerShapeOf, askerOf, useElicitationStore } from '../store/elicitations.js';
import { ensureGate, rememberWorkTitles } from '../board/gateActions.js';

/**
 * Owns the run list + the late-join reconcile (DES-STUDIO-001 §2.1, §3.3). A
 * WS client gets no replay, so on every (re)connect — and on every lifecycle
 * event, via `refresh()` — it re-fetches `GET /runs` (daemon-sorted actionable-
 * first) and self-heals the gate cache: prune to still-`awaiting_human`, then
 * backfill any missing prompt from the daemon cache (`GET /runs/:id/gate`). If a
 * prompt is unavailable (daemon restarted, §3.3 known limit), the retired gate card
 * still works id-only.
 *
 * `refresh()` is debounced at 400 ms so a burst of WS lifecycle events (e.g.
 * sessionStarted → unitPlanned → unitDistributed → unitExecuting) only issues
 * ONE `GET /runs` call instead of one per event. This prevents the libuv thread
 * pool from being saturated by stacked actor-bound requests, which would starve
 * concurrent read-only operations (getCoverageReport, listConformanceRules, etc.).
 */
const TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/**
 * artifact-runs-fix (rig: 404 noise on `GET /runs/:id/elicitation`): a live run whose read answered "none" is not
 * read again until its status changes. A question that opens later arrives live on `/ws`; this read exists for a page
 * that loads after one opened, so every `GET /runs` refresh re-reading every parked run (13 on the rig, each a 404)
 * bought nothing. Keyed run → the status it had when it answered none.
 */
const answeredNone = new Map<string, string>();

/** F31: how many late-join gate reads are on their way at once (98 parked runs read one by one took ~28 s on the rig). */
export const GATE_READS_IN_FLIGHT = 4;

/**
 * F31: the late-join passes' shared read slots. At most `GATE_READS_IN_FLIGHT` reads are on their way across every
 * pass (a refresh that replaces a pass does not add four more). A slot is held until its read ends; a hydration read
 * ends by its deadline at the latest (`GATE_READ_DEADLINE_MS`), so a hung request cannot stall the passes after it.
 */
let slotsBusy = 0;
const slotWaiters: Array<() => void> = [];
export async function inGateSlot(fn: () => Promise<void>): Promise<void> {
  // A freed slot is handed to the longest waiter (first in, first out), never taken by a newcomer.
  if (slotsBusy < GATE_READS_IN_FLIGHT) slotsBusy += 1;
  else await new Promise<void>((r) => slotWaiters.push(r));
  try {
    await fn();
  } finally {
    const next = slotWaiters.shift();
    if (next !== undefined) next();
    else slotsBusy -= 1;
  }
}

/** Test seam. */
export function resetElicitationProbes(): void {
  answeredNone.clear();
}

/** studio#769: read the open question of every live run the store holds none for (CAS-guarded). */
export async function hydrateElicitations(runs: readonly SessionView[], cancelled: () => boolean = () => false): Promise<void> {
  const store = useElicitationStore.getState;
  // A recorded "none" holds only while the run stays in the status it answered in (review r1: a run that leaves and
  // comes back is read again); a finished run's entry goes.
  for (const v of runs) {
    const was = answeredNone.get(v.session.id);
    if (was !== undefined && (was !== v.session.status || TERMINAL.has(v.session.status))) answeredNone.delete(v.session.id);
  }
  const live = runs
    .filter((v) => !TERMINAL.has(v.session.status) && store().elicitations[v.session.id] === undefined && answeredNone.get(v.session.id) !== v.session.status)
    .map((v) => [v.session.id, v.session.status] as const);
  await Promise.all(live.map(async ([id, status]) => {
    const gen = store().getRunGen(id);
    let e: Awaited<ReturnType<typeof api.getElicitation>>;
    try {
      e = await api.getElicitation(id);
    } catch {
      return;
    }
    // Recorded only for a pass still current and a run whose question state did not move meanwhile (review r1).
    if (cancelled() || store().getRunGen(id) !== gen) return;
    if (e === null) { answeredNone.set(id, status); return; }
    answeredNone.delete(id);
    store().setFromGetIfUnchanged(id, gen, {
      runId: e.runId, elicitationId: e.elicitationId, message: e.message, options: e.options, receivedAt: e.receivedAt, ...askerOf(e), ...answerShapeOf(e),
    });
  }));
}

export function useRuns(): { runs: SessionView[]; refresh: () => void; loaded: boolean; error: string | null } {
  const status = useConnectionStore((s) => s.status);
  const reconcileGates = useGateStore((s) => s.reconcile);
  const reconcileElicitations = useElicitationStore((s) => s.reconcile);
  const [runs, setRuns] = useState<SessionView[]>([]);
  // Slice Z (DES-UX-001 §7.6): whether at least one GET /runs has RESOLVED —
  // lets a route naming an unlisted run distinguish "index still in flight"
  // from "the daemon does not serve this id" (the honest pending copy).
  const [loaded, setLoaded] = useState(false);
  // studio#466: the newest `GET /runs` FAILED — said in the daemon's own words. A failed read is
  // not an empty list: nothing may be derived from the runs it did not bring (above all no "N
  // repos never indexed" with a batch launch). Cleared by the next read that answers.
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setTick((t) => t + 1);
    }, 400);
  }, []);

  // Clear any pending debounce timeout on unmount so setTick is never called
  // on an unmounted component.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  // A (re)connect may have missed a question's live frame: every live run is read again (review r1).
  useEffect(() => { if (status === 'connected') resetElicitationProbes(); }, [status]);

  useEffect(() => {
    if (status !== 'connected') return;
    let cancelled = false;

    void (async () => {
      let fetched: SessionView[];
      try {
        ({ runs: fetched } = await api.listRuns());
      } catch (e: unknown) {
        // Keep the last list; ConnectionStatus reflects a disconnect. The failure itself is kept
        // too, so a surface that has no list yet can say the read failed instead of waiting forever.
        if (!cancelled) setError(e instanceof Error && e.message !== '' ? e.message : 'the daemon did not answer');
        return;
      }
      if (cancelled) return;
      setRuns(fetched);
      setLoaded(true);
      setError(null);
      // studio#443: the decision notices name the work, not the run id.
      rememberWorkTitles(fetched);
      // DES-CATALOG-002: which runs were launched from a chat proposal (their plan answers carry planRev on every path).
      rememberProposalRuns(fetched);
      // ASK-S1: ask paths are known before their gates reconcile, so the turn gate stays undrawn here too.
      useAskThreadStore.getState().learnRuns(fetched);
      useGateStore.getState().reclassifyAskGates();

      const awaiting = fetched
        .filter((v) => v.session.status === 'awaiting_human')
        .map((v) => v.session.id);
      reconcileGates(awaiting);
      // A recorded turn gate on a run that no longer waits there is stale (codex r2 #2).
      // (`unit_ix` is a 0-based index into the ord-ordered units — the cursor unit's ORD is what a gate names.)
      useAskThreadStore.getState().reconcileTurnGates(fetched.map((v) => ({
        id: v.session.id, status: v.session.status,
        cursorOrd: [...v.units].sort((a, b) => a.ord - b.ord)[v.session.unit_ix]?.ord ?? null,
      })));
      // Elicitations reconcile against ALL live runs, not just awaiting-human ones: a run can be
      // executing and still hold an open MCP question (DES-002 v0.25 — an absent run must bump so
      // an in-flight GET cannot resurrect a zombie prompt).
      reconcileElicitations(fetched.map((v) => v.session.id));
      // studio#769: the late-join rehydration the store was built for (its CAS, `setFromGetIfUnchanged`). A
      // page loaded after a worker's question opened, or one that missed the frame while the socket
      // reconnected, reads `GET /runs/:id/elicitation` for every live run it holds no question for. A
      // frame that lands while the read is in flight bumps the generation, so the read cannot resurrect a
      // prompt the operator already answered. A failed read leaves the store as it was (no question is
      // cleared for a broken daemon).
      void hydrateElicitations(fetched, () => cancelled);

      // F31: in the list's order, as before (so the toast strip leads as it did), but a few reads at a time across passes
      // (`inGateSlot`) instead of one by one; the run a person is looking at reads its own gate first (RunBlock). A
      // refresh that cancels this pass stops its new reads; a read that lands still applies, because `applyGateRead`
      // drops it if the run's gate moved meanwhile. A failed read leaves the id-only gate working and is tried again on
      // the next pass.
      await Promise.all(awaiting.map((id) => inGateSlot(async () => {
        if (cancelled || useGateStore.getState().gates[id] !== undefined) return;
        await ensureGate(id);
      })));
    })();

    return () => {
      cancelled = true;
    };
  }, [status, tick, reconcileGates, reconcileElicitations]);

  // ASK-S1: `/health` may answer AFTER the first runs list (codex r4 #1) — when the capability lands,
  // the list already in hand is classified and any gate cached meanwhile is reclassified.
  const askOn = useCapabilities((s) => s.askPath);
  useEffect(() => {
    if (!askOn || !loaded) return;
    useAskThreadStore.getState().learnRuns(runs);
    useGateStore.getState().reclassifyAskGates();
  }, [askOn, loaded, runs]);

  return { runs, refresh, loaded, error };
}
