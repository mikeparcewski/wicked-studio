import type { CoreEvent, WorkUnit } from '../api/types.js';
import { useRunEventStore } from '../store/events.js';

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
}

/** A `gateEvaluated` frame narrowed to the fields the card states. */
interface GateEvalView {
  ord: number | null;
  criterion: string | null;
  hasDeterministicFloor: boolean;
  deterministicPass: boolean;
  agentVerdict: string | null;
  agentReasoning: string | null;
  evaluatorPass: boolean | null;
  evaluatorPolicies: string[];
  denialReason: string | null;
  combined: boolean;
}

function toView(ev: CoreEvent): GateEvalView {
  return {
    ord: typeof ev.ord === 'number' ? ev.ord : null,
    criterion: typeof ev.criterion === 'string' ? ev.criterion : null,
    hasDeterministicFloor: ev.hasDeterministicFloor === true,
    deterministicPass: ev.deterministicPass === true,
    agentVerdict: typeof ev.agentVerdict === 'string' ? ev.agentVerdict : null,
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
export function decidingEval(events: readonly CoreEvent[]): GateEvalView | null {
  const evals = events.filter((e) => e.type === 'gateEvaluated').map(toView);
  if (evals.length === 0) return null;
  const denies = evals.filter((g) => g.denialReason !== null || !g.combined);
  return denies[denies.length - 1] ?? evals[evals.length - 1] ?? null;
}

/** Phase name for an ord: the unit-key suffix for workflow units, the stage for free-text ones. */
function phaseLabel(runId: string, units: readonly WorkUnit[], ord: number | null): string {
  if (ord === null) return 'unknown phase';
  const unit = units.find((u) => u.ord === ord);
  if (unit === undefined) return `unit ${ord}`;
  const key = unit.id.startsWith(`${runId}:`) ? unit.id.slice(runId.length + 1) : `u${unit.ord}`;
  return /^u\d+$/.test(key) ? unit.stage : key;
}

const EMPTY_EVENTS: CoreEvent[] = [];

export function VerdictDetail({ runId, units }: Props): React.ReactElement {
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY_EVENTS;
  const deciding = decidingEval(events);

  if (deciding === null) {
    // The empty dress (§1.4): dim ink on a raised surface, NO status color — an
    // absent record is a retention fact, not a failure signal.
    return (
      <div
        data-testid="verdict-detail"
        data-empty="true"
        className="rounded-lg p-3 text-xs font-mono"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)' }}
      >
        <p style={{ color: 'var(--ink-dim)' }}>no evaluator record survives for this run</p>
        <p className="mt-1" style={{ color: 'var(--ink-dim)' }}>
          Event retention predates this run, or its log was pruned — the gate&apos;s reasoning
          was not kept. The status above is the only record.
        </p>
      </div>
    );
  }

  const vacuous = deciding.evaluatorPolicies.length === 0 && deciding.evaluatorPass === true;
  const phase = phaseLabel(runId, units, deciding.ord);

  return (
    <div
      data-testid="verdict-detail"
      {...(deciding.ord !== null ? { 'data-phase-ord': deciding.ord } : {})}
      {...(vacuous ? { 'data-vacuous': 'true' } : {})}
      className="rounded-lg p-3 flex flex-col gap-1.5"
      style={{ background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)' }}
    >
      <p className="text-xs font-semibold font-mono" style={{ color: 'var(--status-fail)' }}>
        Evaluator verdict — {phase}
      </p>

      {deciding.criterion !== null && (
        <p className="text-[11px] font-mono" data-testid="verdict-criterion" style={{ color: 'var(--ink-muted)' }}>
          criterion: {deciding.criterion}
        </p>
      )}

      {deciding.agentVerdict !== null && (
        <p className="text-xs" style={{ color: 'var(--ink-body)' }}>
          <span className="font-mono font-semibold">{deciding.agentVerdict}</span>
          {deciding.agentReasoning !== null && <span> — {deciding.agentReasoning}</span>}
        </p>
      )}
      {deciding.agentVerdict === null && deciding.agentReasoning !== null && (
        <p className="text-xs" style={{ color: 'var(--ink-body)' }}>{deciding.agentReasoning}</p>
      )}

      {deciding.denialReason !== null && (
        <p className="text-xs font-mono" data-testid="verdict-denial" style={{ color: 'var(--status-fail)' }}>
          denied: {deciding.denialReason}
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
    </div>
  );
}
