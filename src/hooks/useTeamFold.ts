import { useEffect, useState } from 'react';
import { isRouteUnsupported } from '../api/errors.js';
import { teamPlanApi } from '../api/teamPlan.js';
import { useConnectionStore } from '../store/connection.js';
import { useTeamPlanStore, type TeamFold } from '../store/teamPlan.js';

/**
 * One run's team fold for a surface that is not its chain line (ASK-S1: the session thread folds
 * the ask run's `wicked.team.*` rows into quiet lines). Tracks the run in the team-plan store
 * while mounted, hydrates from `GET /runs/:id/team` on mount, on each `/ws` reconnect and whenever
 * `moved` changes (a daemon with no team relay sends no frames), and reads the live frames the
 * app's fold grows it by. `null` while nothing is tracked.
 *
 * The chain line keeps its own hydrate (`useRunChain`, S6a) — it also folds the gate plan and the
 * catalog labels; this hook is the fold alone.
 */
export function useTeamFold(runId: string | null, moved = ''): { fold: TeamFold | null; error: string | null; retry: () => void } {
  const fold = useTeamPlanStore((s) => (runId === null ? null : s.byRun[runId] ?? null));
  const connected = useConnectionStore((s) => s.status === 'connected');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (runId === null) return;
    useTeamPlanStore.getState().track(runId);
    return () => useTeamPlanStore.getState().untrack(runId);
  }, [runId]);

  useEffect(() => {
    if (runId === null) return;
    // On mount and on each REconnect — never on the drop itself: during an outage the fold stands.
    if (!connected && (useTeamPlanStore.getState().byRun[runId]?.snapshot ?? null) !== null) return;
    let cancelled = false;
    teamPlanApi.team(runId)
      .then((resp) => {
        if (cancelled) return;
        setError(null);
        useTeamPlanStore.getState().hydrate(runId, resp);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(isRouteUnsupported(e) ? null : e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [runId, moved, connected, attempt]);

  return { fold, error, retry: () => setAttempt((n) => n + 1) };
}
