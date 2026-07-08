import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';
import { useGateStore } from '../store/gates.js';

/**
 * Owns the run list + the late-join reconcile (DES-STUDIO-001 §2.1, §3.3). A
 * WS client gets no replay, so on every (re)connect — and on every lifecycle
 * event, via `refresh()` — it re-fetches `GET /runs` (daemon-sorted actionable-
 * first) and self-heals the gate cache: prune to still-`awaiting_human`, then
 * backfill any missing prompt from the daemon cache (`GET /runs/:id/gate`). If a
 * prompt is unavailable (daemon restarted, §3.3 known limit), the SteeringGate
 * still works id-only.
 */
export function useRuns(): { runs: SessionView[]; refresh: () => void } {
  const status = useConnectionStore((s) => s.status);
  const setGate = useGateStore((s) => s.setGate);
  const reconcileGates = useGateStore((s) => s.reconcile);
  const [runs, setRuns] = useState<SessionView[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (status !== 'connected') return;
    let cancelled = false;

    void (async () => {
      let fetched: SessionView[];
      try {
        ({ runs: fetched } = await api.listRuns());
      } catch {
        return; // keep the last list; ConnectionStatus reflects the disconnect
      }
      if (cancelled) return;
      setRuns(fetched);

      const awaiting = fetched
        .filter((v) => v.session.status === 'awaiting_human')
        .map((v) => v.session.id);
      reconcileGates(awaiting);

      for (const id of awaiting) {
        if (useGateStore.getState().gates[id]) continue;
        try {
          const g = await api.getGate(id);
          if (cancelled) return;
          setGate({
            runId: g.runId,
            ord: g.ord,
            prompt: g.prompt,
            lifecycle: g.lifecycle,
            receivedAt: Date.parse(g.receivedAt) || Date.now(),
          });
        } catch {
          /* no cached prompt — id-only gate still works */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, tick, setGate, reconcileGates]);

  return { runs, refresh };
}
