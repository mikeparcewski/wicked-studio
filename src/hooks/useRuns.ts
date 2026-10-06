import { useAskThreadStore } from '../store/askThread.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';
import { useCapabilities } from '../store/capabilities.js';
import { choicesOf, recommendedOf, useGateStore } from '../store/gates.js';
import { useElicitationStore } from '../store/elicitations.js';
import { rememberWorkTitles } from '../board/gateActions.js';

/**
 * Owns the run list + the late-join reconcile (DES-STUDIO-001 §2.1, §3.3). A
 * WS client gets no replay, so on every (re)connect — and on every lifecycle
 * event, via `refresh()` — it re-fetches `GET /runs` (daemon-sorted actionable-
 * first) and self-heals the gate cache: prune to still-`awaiting_human`, then
 * backfill any missing prompt from the daemon cache (`GET /runs/:id/gate`). If a
 * prompt is unavailable (daemon restarted, §3.3 known limit), the SteeringGate
 * still works id-only.
 *
 * `refresh()` is debounced at 400 ms so a burst of WS lifecycle events (e.g.
 * sessionStarted → unitPlanned → unitDistributed → unitExecuting) only issues
 * ONE `GET /runs` call instead of one per event. This prevents the libuv thread
 * pool from being saturated by stacked actor-bound requests, which would starve
 * concurrent read-only operations (getCoverageReport, listConformanceRules, etc.).
 */
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

      for (const id of awaiting) {
        if (useGateStore.getState().gates[id]) continue;
        try {
          const g = await api.getGate(id);
          if (cancelled) return;
          // The daemon-cached gate carries whatever the payload named; `GateInfo` is a
          // closed interface, so the additive answer shape (§7.11) is read off the bag.
          const choices = choicesOf(g as unknown as Record<string, unknown>);
          const recommended = recommendedOf(g as unknown as Record<string, unknown>);
          setGate({
            runId: g.runId,
            ord: g.ord,
            prompt: g.prompt,
            lifecycle: g.lifecycle,
            receivedAt: Date.parse(g.receivedAt) || Date.now(),
            ...(choices !== undefined ? { choices } : {}),
            ...(recommended !== undefined ? { recommended } : {}),
          });
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
