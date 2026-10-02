import { useEffect } from 'react';
import type { SessionView } from '../../api/types.js';
import { runIdentityOf, teamPlanApi } from '../../api/teamPlan.js';
import { chainOf, chainSentence, type ChainModel, type ChainStep } from '../../board/chainModel.js';
import { useConnectionStore } from '../../store/connection.js';
import { loadCatalog, usePlanCatalog } from '../../store/planCatalog.js';
import { useTeamPlanStore } from '../../store/teamPlan.js';

/**
 * THE CHAIN LINE (DES-STUDIO-REBUILD-001 §5.5, slice S6a): one run's plan as a line of steps.
 *
 * It hydrates from `GET /runs/:id/team` when it mounts, again when the run's status or unit moves
 * (the refresh a daemon with no team relay needs: it sends no `teamEvent` frames), and again after
 * a `/ws` reconnect; live `teamEvent` frames fold in between (App feeds the store). A run that is
 * not a team run renders from its units. Never "checked" without `check_state` (board/chainModel).
 */
export function useRunChain(view: SessionView): ChainModel {
  const runId = view.session.id;
  const fold = useTeamPlanStore((s) => s.byRun[runId] ?? null);
  const connected = useConnectionStore((s) => s.status === 'connected');
  const entries = usePlanCatalog((s) => s.entries);
  const moved = `${view.session.status}:${view.session.unit_ix}`;

  useEffect(() => {
    useTeamPlanStore.getState().track(runId);
    loadCatalog();
    return () => useTeamPlanStore.getState().untrack(runId);
  }, [runId]);

  useEffect(() => {
    // Re-read on a reconnect too (`connected` flips): /ws has no replay of what was missed.
    let cancelled = false;
    teamPlanApi.team(runId)
      .then((resp) => { if (!cancelled) useTeamPlanStore.getState().hydrate(runId, resp); })
      .catch(() => { /* an older daemon, or no team state: the units stand */ });
    return () => { cancelled = true; };
  }, [runId, moved, connected]);

  const labels: Record<string, string> = {};
  for (const e of entries) {
    if (e.description !== null && e.description.length <= 40) labels[e.id] = e.description;
  }
  return chainOf(view, fold, { userPlan: runIdentityOf(view.session)?.kind === 'user_plan', catalogLabels: labels });
}

const STATE_WORD: Record<ChainStep['state'], string> = {
  todo: 'not started', running: 'working', done: 'done', checked: 'checked', failed: 'stopped',
  replaced: 'replaced', struck: 'removed',
};

const ADDED_WORD: Record<ChainStep['addedBy'], string> = {
  pa: 'added by the lead helper', floor: 'required for this risk', human: 'from your plan', policy: 'added by a rule',
};

export function ChainLine({ chain, runId }: { chain: ChainModel; runId: string }): React.ReactElement {
  return (
    <div data-testid="chain" data-run-id={runId} data-source={chain.source} data-proposed={chain.proposed ? 'true' : 'false'} className="wk-chain">
      {chain.steps.length > 0 && (
        <ol data-testid="chain-line" aria-label={chain.proposed ? 'Proposed steps' : 'Steps'} className="wk-chain-line">
          {chain.steps.map((s, i) => (
            <li
              key={s.id}
              data-testid="chain-step"
              data-step-id={s.id}
              data-block={s.block}
              data-state={s.state}
              data-added-by={s.addedBy}
              {...(s.late ? { 'data-late': 'true' } : {})}
              title={[ADDED_WORD[s.addedBy], s.reason].filter(Boolean).join(' — ')}
              aria-label={`${s.label}: ${STATE_WORD[s.state]}`}
              className={`wk-chain-step wk-chain-step--${s.state}`}
            >
              {i > 0 && <span aria-hidden className="wk-chain-join" />}
              <span aria-hidden className={`wk-chain-dot wk-chain-dot--${s.state}`} />
              <span className="wk-chain-label">{s.label}</span>
              {s.late && <span className="wk-chain-late">added</span>}
            </li>
          ))}
        </ol>
      )}
      {(chain.total > 0 || chain.transportLine === null) && (
        <p data-testid="chain-sentence" className="wk-chain-sentence">{chainSentence(chain)}</p>
      )}
      {chain.transportLine !== null && (
        <p data-testid="chain-transport" className="wk-chain-transport">{chain.transportLine}</p>
      )}
    </div>
  );
}
