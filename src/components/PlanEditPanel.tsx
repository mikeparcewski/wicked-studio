import type { SessionView } from '../api/types.js';
import { planEditAvailability } from '../board/planModel.js';
import { usePhaseSelection } from '../hooks/useLaunchPlan.js';
import { IDLE_PLAN_EDIT, proposePlanEdit, retryPlanEdit, usePlanEdits } from '../store/planEdits.js';
import { PhasePicker } from './PhasePicker.js';

/**
 * Mid-run plan edits (DES-TEAMING-002 §8.12, the plan card's Edit): add phases to a live planned
 * run through `POST /runs/:id/plan`. A skin over `store/planEdits` — each Propose is a new edit
 * with a fresh `requestId`; Retry re-sends the same one; the answer's band, high-risk flag and
 * floor additions are shown as the engine gave them.
 */
export function PlanEditPanel({ view }: { view: SessionView }): React.ReactElement | null {
  const runId = view.session.id;
  const availability = planEditAvailability(view.session);
  const selection = usePhaseSelection(availability.show);
  const edit = usePlanEdits((s) => s.byRun[runId]) ?? IDLE_PLAN_EDIT;
  if (!availability.show) return null;

  const canPropose = availability.editable && selection.plan !== null && edit.status !== 'sending';
  const outcome = edit.status === 'done' ? edit.outcome : null;

  return (
    <div data-testid="plan-edit" data-editable={availability.editable ? 'true' : 'false'} className="flex flex-col gap-2 text-[11px]">
      {!availability.editable && (
        <p data-testid="plan-edit-unavailable" style={{ color: 'var(--ink-muted)' }}>{availability.reason}</p>
      )}
      {availability.editable && (
        <>
          <PhasePicker model={selection} touch={false} emptyText="Pick phases to add to this run's plan." />
          <button
            type="button"
            data-testid="plan-edit-propose"
            disabled={!canPropose}
            onClick={() => {
              if (selection.plan === null) return;
              void proposePlanEdit(runId, { steps: selection.plan.steps }).then(() => {
                if (usePlanEdits.getState().byRun[runId]?.status === 'done') selection.clear();
              });
            }}
            className="self-start rounded-lg px-3 py-1 font-mono font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {edit.status === 'sending' ? 'Proposing…' : 'Add to plan'}
          </button>
        </>
      )}

      {outcome?.kind === 'applied' && (
        <div data-testid="plan-edit-result" data-kind="applied" className="flex flex-col gap-0.5" style={{ color: 'var(--ink-high)' }}>
          <span>Held for the run’s next step boundary.</span>
          <span data-testid="plan-edit-band">band {outcome.band ?? 'unchanged'}</span>
          {outcome.highRisk === true && (
            <span data-testid="plan-edit-high-risk" style={{ color: 'var(--status-gate)' }}>
              This edit moves the run into high risk.
            </span>
          )}
          <span data-testid="plan-edit-floor-added">
            {outcome.floorAdded.length > 0
              ? `The floor adds: ${outcome.floorAdded.join(', ')}.`
              : 'The floor adds nothing.'}
          </span>
        </div>
      )}
      {outcome?.kind === 'already-applied' && (
        <p data-testid="plan-edit-result" data-kind="already-applied" style={{ color: 'var(--ink-high)' }}>
          Already applied: the engine had this edit, so nothing new was added.
        </p>
      )}
      {outcome?.kind === 'answered-gate' && (
        <p data-testid="plan-edit-result" data-kind="answered-gate" style={{ color: 'var(--ink-high)' }}>
          The edit answered the plan gate; the run is {outcome.status}.
        </p>
      )}
      {edit.status === 'failed' && (
        <div className="flex items-center gap-2 flex-wrap">
          <p data-testid="plan-edit-error" style={{ color: 'var(--status-fail)' }}>{edit.error}</p>
          {edit.retryable && (
            <button
              type="button"
              data-testid="plan-edit-retry"
              onClick={() => void retryPlanEdit(runId)}
              className="rounded-lg px-2 py-0.5 font-mono"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            >
              Retry the same edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
