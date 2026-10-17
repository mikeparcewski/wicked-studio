import { useAskThreadStore } from '../store/askThread.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';
import { useCapabilities } from '../store/capabilities.js';
import { gateFromInfo, useGateStore } from '../store/gates.js';
import { askerOf, useElicitationStore } from '../store/elicitations.js';
import { rememberWorkTitles } from '../board/gateActions.js';

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

/** studio#769: read the open question of every live run the store holds none for (CAS-guarded). */
export async function hydrateElicitations(runs: readonly SessionView[], cancelled: () => boolean = () => false): Promise<void> {
  const store = useElicitationStore.getState;
  const live = runs.filter((v) => !TERMINAL.has(v.session.status) && store().elicitations[v.session.id] === undefined).map((v) => v.session.id);
  await Promise.all(live.map(async (id) => {
    const gen = store().getRunGen(id);
    let e: Awaited<ReturnType<typeof api.getElicitation>>;
    try {
      e = await api.getElicitation(id);
    } catch {
      return;
    }
    if (cancelled() || e === null) return;
    store().setFromGetIfUnchanged(id, gen, {
      runId: e.runId, elicitationId: e.elicitationId, message: e.message, options: e.options, receivedAt: e.receivedAt, ...askerOf(e),
    });
  }));
}

export function useRuns(): { runs: SessionView[]; refresh: () => void; loaded: boolean; error: string | null } {
  const status = useConnectionStore((s) => s.status);
  const setGate = useGateStore((s) => s.setGate);
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

      for (const id of awaiting) {
        if (useGateStore.getState().gates[id]) continue;
        try {
          const g = await api.getGate(id);
          if (cancelled) return;
          setGate(gateFromInfo(g));
        } catch {
          /* no cached prompt — id-only gate still works */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, tick, setGate, reconcileGates, reconcileElicitations]);

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
