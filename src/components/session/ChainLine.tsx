import { useEffect, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import { isRouteUnsupported } from '../../api/errors.js';
import { runIdentityOf, teamPlanApi } from '../../api/teamPlan.js';
import { chainOf, chainSentence, unitPhaseId, withGatePlan, type ChainModel, type ChainStep } from '../../board/chainModel.js';
import { useGateStore } from '../../store/gates.js';
import { checkChip, checkedSentence, type MomentOf } from '../../board/checkState.js';
import type { WalkthroughStepState } from '../../api/types.js';
import { openSheet } from '../../store/sheets.js';
import { useConnectionStore } from '../../store/connection.js';
import { loadCatalog, usePlanCatalog } from '../../store/planCatalog.js';
import { useTeamPlanStore } from '../../store/teamPlan.js';

/**
 * THE CHAIN LINE (DES-STUDIO-REBUILD-001 §5.5, slice S6a): one run's plan as a line of steps.
 *
 * It hydrates from `GET /runs/:id/team` when it mounts, again when the run's status or unit moves
 * (the refresh a daemon with no team relay needs: it sends no `teamEvent` frames), and again after
 * a `/ws` reconnect; live `teamEvent` frames fold in between (App feeds the store). A run that is
 * not a team run renders from its units. Never "checked" without `check_state` (board/chainModel):
 * WT-U2 hands the acceptance read's per-step states in as `checks`, and each step wears its chip —
 * "checked at 0:34 ▸" (opens the walkthrough there), "check failed at 0:41", "end-to-end testing is
 * yours" — with the moment from the take's chapter marks (`momentOf`), never invented.
 */
export interface RunChain {
  chain: ChainModel;
  /** The team read failed for a reason other than "this daemon has no such route": said, with a retry. */
  teamError: string | null;
  retry: () => void;
}

export function useRunChain(view: SessionView): RunChain {
  const runId = view.session.id;
  const fold = useTeamPlanStore((s) => s.byRun[runId] ?? null);
  const connected = useConnectionStore((s) => s.status === 'connected');
  const entries = usePlanCatalog((s) => s.entries);
  // studio#470: while a plan gate waits, the line lists the plan the gate asks about.
  const gate = useGateStore((s) => s.gates[runId]);
  const planPrompt = gate !== undefined && (gate.gateKind === 'plan_approval' || /^\s*Approve plan rev \d+/i.test(gate.prompt)) ? gate.prompt : undefined;
  const moved = `${view.session.status}:${view.session.unit_ix}`;

  useEffect(() => {
    useTeamPlanStore.getState().track(runId);
    loadCatalog();
    return () => useTeamPlanStore.getState().untrack(runId);
  }, [runId]);

  const [teamError, setTeamError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Read on mount and again on each REconnect (/ws has no replay of what was missed) — never on
    // the drop itself: during an outage the retained chain stands (Copilot).
    if (!connected && (useTeamPlanStore.getState().byRun[runId]?.snapshot ?? null) !== null) return;
    let cancelled = false;
    teamPlanApi.team(runId)
      .then((resp) => {
        if (cancelled) return;
        setTeamError(null);
        useTeamPlanStore.getState().hydrate(runId, resp);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // A daemon without the route (bare 404/501): the units are the honest chain. Anything
        // else is a failure, said as one — never a plausible chain standing in for the team's.
        setTeamError(isRouteUnsupported(e) ? null : e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [runId, moved, connected, attempt]);

  const labels: Record<string, string> = {};
  for (const e of entries) {
    if (e.description !== null && e.description.length <= 40) labels[e.id] = e.description;
  }
  const opts = { userPlan: runIdentityOf(view.session)?.kind === 'user_plan', catalogLabels: labels };
  return {
    chain: withGatePlan(chainOf(view, fold, opts), planPrompt, opts),
    teamError,
    retry: () => setAttempt((n) => n + 1),
  };
}

/** The unit a step ran as: a units-chain step is `u<ord>`; a team step's id is its unit's phase id. */
export function stepUnitOrd(s: ChainStep, units: readonly SessionView['units'][number][]): number | null {
  const m = /^u(\d+)$/.exec(s.id);
  if (m !== null) return units.some((u) => u.ord === Number(m[1])) ? Number(m[1]) : null;
  const u = units.find((x) => unitPhaseId(x) === s.id);
  return u?.ord ?? null;
}

const STATE_WORD: Record<ChainStep['state'], string> = {
  todo: 'not started', running: 'working', done: 'done', checked: 'checked', failed: 'stopped',
  replaced: 'replaced', struck: 'removed',
};

const ADDED_WORD: Record<ChainStep['addedBy'], string> = {
  pa: 'added by the lead helper', floor: 'required for this risk', human: 'from your plan', policy: 'added by a rule',
};

function whyOf(s: ChainStep): string {
  return [ADDED_WORD[s.addedBy], s.reason].filter(Boolean).join(' — ');
}

export function ChainLine({ chain, runId, units = [], teamError = null, onRetry, checks = null, momentOf, onOpenAt, nothingChecked = false }: {
  chain: ChainModel;
  runId: string;
  /** The run's units: a step that has one opens its sheet (S11). */
  units?: SessionView['units'];
  teamError?: string | null;
  onRetry?: () => void;
  /** WT-U2: the acceptance read's per-step check states (`chain` already folded them — these give the chips their words). */
  checks?: readonly WalkthroughStepState[] | null;
  /** WT-U2: the take's chapter moments; absent = chips with nothing to open. */
  momentOf?: MomentOf;
  /** WT-U2: a chip with a moment asks the run's walkthrough to open there. */
  onOpenAt?: (sec: number) => void;
  /** S17c: true when the run is terminal with no checked governance entries → "· nothing checked". */
  nothingChecked?: boolean;
}): React.ReactElement {
  return (
    <div data-testid="chain" data-run-id={runId} data-source={chain.source} data-proposed={chain.proposed ? 'true' : 'false'} className="wk-chain">
      {chain.steps.length > 0 && (
        <ol data-testid="chain-line" aria-label={chain.proposed ? 'Proposed steps' : 'Steps'} className="wk-chain-line">
          {chain.steps.map((s, i) => {
            const ord = stepUnitOrd(s, units);
            const chip = checkChip(s, checks, momentOf);
            return (
            <li
              {...(ord !== null ? { 'data-object': `step:${runId}:${ord}` } : {})}
              key={s.id}
              data-testid="chain-step"
              data-step-id={s.id}
              data-block={s.block}
              data-state={s.state}
              data-added-by={s.addedBy}
              {...(s.late ? { 'data-late': 'true' } : {})}
              title={whyOf(s)}
              aria-label={`${s.label}: ${STATE_WORD[s.state]} — ${whyOf(s)}`}
              className={`wk-chain-step wk-chain-step--${s.state}`}
            >
              {i > 0 && <span aria-hidden className="wk-chain-join" />}
              <span aria-hidden className={`wk-chain-dot wk-chain-dot--${s.state}`} />
              {ord !== null ? (
                <button type="button" data-testid="chain-step-open" onClick={() => openSheet({ kind: 'step', runId, ord })} aria-label={`Look underneath ${s.label}`} className="wk-chain-label wk-chain-open">{s.label}</button>
              ) : (
                <span className="wk-chain-label">{s.label}</span>
              )}
              {s.late && <span className="wk-chain-late">added</span>}
              {chip !== null && (chip.atSec === null || onOpenAt === undefined ? (
                <span data-testid="chain-step-check" data-check={chip.kind} className={`wk-chain-check wk-chain-check--${chip.kind}`}>{chip.text}</span>
              ) : (
                <button type="button" data-testid="chain-step-check" data-check={chip.kind} data-sec={String(chip.atSec)} onClick={() => onOpenAt(chip.atSec as number)} aria-label={`${chip.text} — open the walkthrough there`} className={`wk-chain-check wk-chain-check--${chip.kind} wk-chain-check--open`}>{chip.text} ▸</button>
              ))}
            </li>
            );
          })}
        </ol>
      )}
      {(chain.total > 0 || chain.transportLine === null) && (
        <p data-testid="chain-sentence" className="wk-chain-sentence">{checkedSentence(chain) ?? chainSentence(chain, nothingChecked)}</p>
      )}
      {teamError !== null && (
        <p data-testid="chain-team-error" className="wk-chain-transport">
          Could not read the team plan ({teamError}); {chain.source === 'team' ? 'showing the plan as last read' : 'showing the run\u2019s own steps'}.{' '}
          {onRetry !== undefined && (
            <button type="button" data-testid="chain-team-retry" onClick={onRetry} className="wk-since-toggle">Try again</button>
          )}
        </p>
      )}
      {chain.transportLine !== null && (
        <p data-testid="chain-transport" className="wk-chain-transport">{chain.transportLine}</p>
      )}
    </div>
  );
}
