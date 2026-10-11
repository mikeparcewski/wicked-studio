import type { CoreEvent, WorkUnit } from '../api/types.js';
import { useRunEventStore } from '../store/events.js';
import { gateUngated, gateUngatedReason, judgeSkippedOf, judgeVerdictOf } from '../api/wave6-wire.js';
import { phaseLabel } from './gateVerdictModel.js';
import { unitStepName } from '../board/chainModel.js';
import { useDisplayText } from '../hooks/useHomePath.js';

/**
 * The evaluator verdict card (DES-UX-001 §1.3-2, slice R).
 *
 * A failed run used to answer "why did this fail" with a one-line rejection; the
 * evaluator's actual record — which phase gated, what it evaluated, what it
 * rejected — was on the wire the whole time (`gateEvaluated`, already fetched
 * into the run event store by the run view's hydrate) and never rendered. This
 * card reads that log and states, for the deciding phase: the `criterion`
 * gated, the `agentVerdict` + `agentReasoning`, the `denialReason`, and which
 * governance layers actually ran.
 *
 * FINDING-025: an EMPTY `evaluatorPolicies` beside `evaluatorPass: true` is a
 * vacuous default-allow — nothing was applied, so the "pass" enforces nothing.
 * The card labels it as such (`data-vacuous="true"`) instead of letting it read
 * as an enforced approval.
 *
 * The retention empty state (§1.3-3, steering-added): historical runs whose
 * event logs carry no `gateEvaluated` entries (event retention predates the
 * run, or the log was pruned) render the card in its empty dress — "no
 * evaluator record survives for this run" — never a blank card, and never a
 * verdict fabricated from the one-line status.
 *
 * Zero new requests: the card is a pure view over the already-fetched event log.
 */

interface Props {
  runId: string;
  /** The run's units (snapshot) — resolves the deciding ord to a phase name. */
  units: readonly WorkUnit[];
  /** Audit row 30: the run COMPLETED — the verdict that stood is its last evaluation; an earlier
   *  denial it recovered from (a retried step) is not what decided it. */
  completed?: boolean;
}

/** A `gateEvaluated` frame narrowed to the fields the card states. */
interface GateEvalView {
  ord: number | null;
  criterion: string | null;
  hasDeterministicFloor: boolean;
  deterministicPass: boolean;
  /** `null` when no judge ran — including the engine's `"skipped"` (studio#306). */
  agentVerdict: string | null;
  /** studio#306: why the engine deliberately ran no judge; `null` otherwise. */
  judgeSkipped: string | null;
  /** Whether the judge seat was identity-distinct from the creator; `null` when the frame does not say. */
  judgeDistinct: boolean | null;
  agentReasoning: string | null;
  evaluatorPass: boolean | null;
  evaluatorPolicies: string[];
  denialReason: string | null;
  combined: boolean;
  /** Wave 6 (api-types 0.36.0): the engine SAYS no judge seat could be convened — and why. */
  ungated: boolean;
  ungatedReason: string | null;
}

function toView(ev: CoreEvent): GateEvalView {
  return {
    ungated: gateUngated(ev),
    ungatedReason: gateUngatedReason(ev),
    ord: typeof ev.ord === 'number' ? ev.ord : null,
    criterion: typeof ev.criterion === 'string' ? ev.criterion : null,
    hasDeterministicFloor: ev.hasDeterministicFloor === true,
    deterministicPass: ev.deterministicPass === true,
    agentVerdict: judgeVerdictOf(ev as unknown as Record<string, unknown>),
    judgeSkipped: judgeSkippedOf(ev as unknown as Record<string, unknown>),
    judgeDistinct: typeof (ev as unknown as Record<string, unknown>)['judgeDistinct'] === 'boolean' ? ((ev as unknown as Record<string, unknown>)['judgeDistinct'] as boolean) : null,
    agentReasoning: typeof ev.agentReasoning === 'string' ? ev.agentReasoning : null,
    evaluatorPass: typeof ev.evaluatorPass === 'boolean' ? ev.evaluatorPass : null,
    evaluatorPolicies: Array.isArray(ev.evaluatorPolicies)
      ? (ev.evaluatorPolicies as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
    denialReason: typeof ev.denialReason === 'string' ? ev.denialReason : null,
    combined: ev.combined === true,
  };
}

/**
 * The DECIDING evaluation: the last one that denied (a `denialReason`, or a
 * combined-deny), else the last evaluation overall — arrival order is the
 * daemon's order, so "last" is the verdict that stood when the run halted.
 */
export function decidingEval(events: readonly CoreEvent[], completed = false): GateEvalView | null {
  const evals = events.filter((e) => e.type === 'gateEvaluated').map(toView);
  if (evals.length === 0) return null;
  if (completed) return evals[evals.length - 1] ?? null;
  const denies = evals.filter((g) => g.denialReason !== null || !g.combined);
  return denies[denies.length - 1] ?? evals[evals.length - 1] ?? null;
}

// `phaseLabel` (the unit-key suffix for workflow units, the stage for free-text ones) is shared
// with the gate card's verdict block — one spelling, `./gateVerdictModel.ts`.

const EMPTY_EVENTS: CoreEvent[] = [];

export function VerdictDetail({ runId, units, completed = false }: Props): React.ReactElement {
  const showText = useDisplayText();
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY_EVENTS;
  const deciding = decidingEval(events, completed);

  if (deciding === null) {
    // The empty dress (§1.4): dim ink on a raised surface, NO status color — an
    // absent record is a retention fact, not a failure signal.
    return (
      <div
        data-testid="verdict-detail"
        data-empty="true"
        className="wk-session-verdict wk-verdict wk-verdict--ungated"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)' }}
      >
        <p style={{ color: 'var(--ink-muted)' }}>No checks record survives for this run.</p>
        <p className="mt-1" style={{ color: 'var(--ink-dim)' }}>
          Event retention predates this run, or its log was pruned — the gate&apos;s reasoning
          was not kept. The status above is the only record.
        </p>
      </div>
    );
  }

  const vacuous = deciding.evaluatorPolicies.length === 0 && deciding.evaluatorPass === true;
  // The step by its plain name ("Security check"), not its key ("security_review").
  const decidingUnit = deciding.ord === null ? undefined : units.find((u) => u.ord === deciding.ord);
  const phase = decidingUnit !== undefined ? unitStepName(decidingUnit) : phaseLabel(runId, units, deciding.ord);
  const failed = deciding.denialReason !== null || !deciding.combined
    || (deciding.hasDeterministicFloor && !deciding.deterministicPass)
    || deciding.evaluatorPass === false || /^(?:fail|deny|denied|not pass)$/i.test(deciding.agentVerdict ?? '');
  const unverified = !deciding.hasDeterministicFloor && deciding.agentVerdict === null && deciding.evaluatorPolicies.length === 0;
  const headline = failed ? `${phase} was stopped by a check`
    : unverified ? `No checks were set for ${phase} — it passed by default, nothing was verified`
      : deciding.ungated ? (deciding.hasDeterministicFloor
        ? `Repository checks ran for ${phase} — no independent review ran`
        : `${phase} passed its automatic checks — no independent review ran`)
        : vacuous ? `Checks passed for ${phase} — no additional checks were set`
      : `Checks passed for ${phase}`;

  return (
    <div
      data-testid="verdict-detail"
      {...(deciding.ord !== null ? { 'data-phase-ord': deciding.ord } : {})}
      {...(vacuous ? { 'data-vacuous': 'true' } : {})}
      className={`wk-session-verdict wk-verdict wk-verdict--${failed ? 'fail' : 'ungated'}`}
    >
      <p className="wk-verdict-head">{headline.charAt(0).toUpperCase() + headline.slice(1)}</p>
      <details className="wk-tech-details">
        <summary className="wk-tech-details-summary">Technical details</summary>
        <div className="wk-session-verdict-details" data-tech="on">

      {deciding.criterion !== null && (
        <p className="text-[11px] font-mono" data-testid="verdict-criterion" style={{ color: 'var(--ink-muted)' }}>
          criterion: {showText(deciding.criterion)}
        </p>
      )}

      {deciding.agentVerdict !== null && (
        <p className="text-xs" style={{ color: 'var(--ink-body)' }}>
          <span className="font-mono font-semibold">{deciding.agentVerdict}</span>
          {deciding.agentReasoning !== null && <span> — {showText(deciding.agentReasoning)}</span>}
        </p>
      )}
      {deciding.judgeSkipped !== null && (
        <p
          className="text-xs font-mono"
          data-testid="verdict-judge-skipped"
          data-judge-distinct={deciding.judgeDistinct === null ? 'unknown' : String(deciding.judgeDistinct)}
          style={{ color: 'var(--status-gate)' }}
        >
          judge skipped — {showText(deciding.judgeSkipped)}
          {deciding.judgeDistinct === false ? ' · judgeDistinct: false' : ''}
        </p>
      )}
      {deciding.agentVerdict === null && deciding.agentReasoning !== null && (
        <p className="text-xs" style={{ color: 'var(--ink-body)' }}>{showText(deciding.agentReasoning)}</p>
      )}

      {deciding.denialReason !== null && (
        <p className="text-xs font-mono" data-testid="verdict-denial" style={{ color: 'var(--status-fail)' }}>
          denied: {showText(deciding.denialReason)}
        </p>
      )}

      {/* Which governance layers actually ran — never overclaimed (FINDING-025). */}
      <p className="text-[11px] font-mono" style={{ color: 'var(--ink-muted)' }}>
        {deciding.hasDeterministicFloor
          ? `deterministic floor: ${deciding.deterministicPass ? 'pass' : 'fail'}`
          : 'no deterministic floor'}
        {' · '}
        {deciding.evaluatorPass === null
          ? 'evaluator layer did not run'
          : vacuous
            ? 'evaluator: default-allow (no policy applied — an unenforced pass, not an approval)'
            : `evaluator: ${deciding.evaluatorPass ? 'pass' : 'fail'} (${deciding.evaluatorPolicies.length} ${
                deciding.evaluatorPolicies.length === 1 ? 'policy' : 'policies'
              })`}
      </p>
      {deciding.evaluatorPolicies.length > 0 && <p>policies: {showText(deciding.evaluatorPolicies.join(', '))}</p>}
      {/* Wave 6 (F-7R2-005 / -017): the engine's own word that no judge could be convened. */}
      {deciding.ungated && (
        <p
          className="text-[11px] font-mono font-semibold"
          data-testid="verdict-ungated"
          {...(deciding.ungatedReason !== null ? { 'data-ungated-reason': deciding.ungatedReason } : {})}
          style={{ color: 'var(--status-gate)' }}
        >
          UNGATED — {showText(deciding.ungatedReason ?? 'the engine convened no judge')}; evaluator ≠ creator was not held on this verdict
        </p>
      )}
        </div>
      </details>
    </div>
  );
}
