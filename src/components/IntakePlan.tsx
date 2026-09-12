import type { WorkUnit, WorkflowDef } from '../api/types.js';
import { phaseLabel } from './gateVerdictModel.js';

/**
 * The PLAN on an intake gate (acceptance finding F-7R2-008): what the operator is approving before
 * unit 1 runs — every planned unit with its ord, phase, stage, executor, skill and seat — instead of
 * the brief echoed back. A pure view over the run's `units` snapshot (the daemon's `GET /runs/:id`)
 * and, when the host has it, the workflow def the run was planned from (`GET /workflows`), which
 * carries the phase vocabulary the units alone do not: executor kind, `skill_ref`, `executes_code`,
 * the evaluator ≠ creator role.
 *
 * Seats are said as the wire says them: a unit with `assigned_cli` names it; one without is
 * "council picks" over the run's pool (`session.clis`) — the council convenes at dispatch, so
 * before approval no seat is a fact yet. Nothing is inferred from the prompt text.
 *
 * Mounted by `SteeringGate` when the gate is the intake gate (a pre-run gate on the run's FIRST
 * unit) and by the testing launch panel's copy of that card. Zero fetches.
 */

export interface IntakePlanProps {
  runId: string;
  units: readonly WorkUnit[];
  /** The run's seat pool (`session.clis`) — what "council picks" chooses from. */
  clis?: readonly string[] | undefined;
  /** The workflow def the run was planned from, when the host knows it. */
  workflow?: WorkflowDef | null | undefined;
  /**
   * The run's deliver posture (F-E2E-030, `session.auto_deliver`): `false` — the engine pauses
   * for a human before the `deliver` phase pushes and opens the PR; `true` — the launch opted out
   * (auto-deliver). `null`/absent — the engine predates the deliver gate, so NO promise is made.
   */
  autoDeliver?: boolean | null | undefined;
}

/** The run's deliver posture off the session DTO (`auto_deliver`, additive since wicked-core-ts
 *  0.7.24): a boolean when the engine knows the deliver gate, `null` when it predates it. */
export function autoDeliverOf(session: unknown): boolean | null {
  if (typeof session !== 'object' || session === null) return null;
  const v = (session as { auto_deliver?: unknown }).auto_deliver;
  return typeof v === 'boolean' ? v : null;
}

/** Whether `prompt` is the engine's PRE-RUN gate on the run's first unit — the intake gate. */
export function isIntakeGate(prompt: string | undefined, ord: number | undefined, units: readonly WorkUnit[]): boolean {
  if (prompt === undefined || typeof ord !== 'number') return false;
  if (!/^\s*Approve unit\s+\d+\s+before it runs/i.test(prompt)) return false;
  const first = units.reduce<number | null>((min, u) => (min === null || u.ord < min ? u.ord : min), null);
  return first === null || first === ord;
}

/** The phase row's executor word: `tool` for a Tool-executor phase, `agent` otherwise. */
function executorOf(unit: WorkUnit, phase: WorkflowDef['phases'][number] | undefined): 'agent' | 'tool' {
  if (Array.isArray(unit.tool_cmd) && unit.tool_cmd.length > 0) return 'tool';
  if (phase?.executor?.type === 'tool') return 'tool';
  return 'agent';
}

export function IntakePlan({ runId, units, clis, workflow, autoDeliver }: IntakePlanProps): React.ReactElement | null {
  if (units.length === 0) return null;
  const ordered = [...units].sort((a, b) => a.ord - b.ord);
  const pool = (clis ?? []).filter((c) => c !== '');
  return (
    <div
      data-testid="intake-plan"
      data-units={ordered.length}
      {...(workflow ? { 'data-workflow': workflow.id } : {})}
      className="rounded-lg p-2.5 mb-3 flex flex-col gap-1 font-mono"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)' }}
    >
      <p className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>
        The plan you are approving — {ordered.length} phase{ordered.length === 1 ? '' : 's'}
        {workflow ? <span style={{ color: 'var(--ink-muted)' }}> · workflow {workflow.id}</span> : null}
      </p>
      <ol className="flex flex-col gap-0.5 text-[11px]" style={{ color: 'var(--ink-body)' }}>
        {ordered.map((u) => {
          const name = phaseLabel(runId, units, u.ord);
          const phase = workflow?.phases.find((p) => p.id === name);
          const executor = executorOf(u, phase);
          const skill = u.skill_ref ?? phase?.skill_ref ?? null;
          const seat = u.assigned_cli;
          return (
            <li
              key={u.id}
              data-testid="intake-plan-unit"
              data-ord={u.ord}
              data-phase={name}
              data-executor={executor}
              {...(seat ? { 'data-seat': seat } : {})}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              <span style={{ color: 'var(--ink-dim)' }}>#{u.ord}</span>
              <span className="font-semibold">{name}</span>
              {name !== u.stage && <span style={{ color: 'var(--ink-muted)' }}>{u.stage}</span>}
              <span style={{ color: 'var(--ink-muted)' }}>{executor}</span>
              {skill !== null && skill !== '' && (
                <span data-testid="intake-plan-skill" style={{ color: 'var(--accent)' }}>{skill}</span>
              )}
              {(u.executes_code === true || phase?.executes_code === true) && (
                <span style={{ color: 'var(--status-run)' }}>writes code</span>
              )}
              {(u.role === 'evaluator' || phase?.role === 'evaluator') && (
                <span style={{ color: 'var(--status-gate)' }}>evaluator ≠ creator</span>
              )}
              {/* F-E2E-030: the deliver phase is the step that leaves the machine — say, on the
                  plan the operator approves, whether a human confirms it first. Silent when the
                  engine predates the gate (no false promise). */}
              {executor === 'tool' && name === 'deliver' && typeof autoDeliver === 'boolean' && (
                <span
                  data-testid="intake-plan-deliver-gate"
                  data-deliver-gate={autoDeliver ? 'auto' : 'human'}
                  style={{ color: autoDeliver ? 'var(--status-run)' : 'var(--status-gate)' }}
                >
                  {autoDeliver
                    ? 'auto-deliver — pushes its branch + opens the PR with no gate'
                    : 'human gate before it pushes its branch + opens the PR'}
                </span>
              )}
              <span data-testid="intake-plan-seat" style={{ color: seat ? 'var(--ink-high)' : 'var(--ink-dim)' }}>
                {seat
                  ? `seat: ${seat}`
                  : executor === 'tool'
                    ? 'no seat — a direct command'
                    : pool.length > 0
                      ? `council picks from ${pool.join(', ')}`
                      : 'council picks the seat'}
              </span>
            </li>
          );
        })}
      </ol>
      {ordered.some((u) => u.assigned_cli === null) && (
        <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          seats are chosen by the council at dispatch — only eligible (signed-in or free-tier) seats are polled
        </p>
      )}
    </div>
  );
}
