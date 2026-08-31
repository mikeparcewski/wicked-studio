import type { RunModel, UnitModel } from '../hooks/useRunModel.js';
import { RoutingProvenance } from './RoutingProvenance.js';

interface Props {
  model: RunModel;
}

/**
 * Which layer actually decided this gate.
 *
 * A DENIAL is always attributable — some layer said no, and it is named. An APPROVAL is not:
 * each layer passes vacuously when it did not run. The deterministic floor reports that via
 * `hasDeterministicFloor`, the agent judge via a null `agentVerdict`, and the evaluator second
 * pass via an EMPTY `evaluatorPolicies` — the policy engine executes on every unit and
 * default-allows when nothing matched, so `evaluatorPass === true` alone proves nothing
 * (FINDING-025). Credit a layer for an approval only when it genuinely evaluated something;
 * otherwise the honest answer is 'ungated'.
 */
function gateDecider(g: UnitModel['gateEvals'][number]): string {
  if (!g.combined) {
    const deniers: string[] = [];
    if (g.hasDeterministicFloor && !g.deterministicPass) deniers.push('deterministic floor');
    if (g.evaluatorPass === false) deniers.push('evaluator (2nd pass)');
    if (deniers.length === 0 && g.agentVerdict !== null) deniers.push('agent judge');
    return deniers.length > 0 ? deniers.join(' + ') : 'governance';
  }
  // `=== true`, not `!== null`: an allow whose evaluator says `false` is a contradictory record, and
  // the one thing we must not do with a contradiction is name a layer as the approver. Fall through.
  if (g.evaluatorPass === true && g.evaluatorPolicies.length > 0) return 'evaluator (2nd pass)';
  if (g.agentVerdict !== null) return 'agent judge';
  if (g.hasDeterministicFloor) return 'deterministic floor';
  return 'ungated';
}

export function DecisionsLedger({ model }: Props): React.ReactElement {
  const { units, session, pendingGate } = model;

  const decidedUnits = units.filter(
    (u) => u.routing !== null || u.denialReason !== null || u.gateEvals.length > 0,
  );

  const nextUnitOrd =
    pendingGate !== null ? pendingGate.ord + 1 : session.status === 'executing' ? session.unit_ix : null;

  const nextIsGated = ((): boolean => {
    if (nextUnitOrd === null) return false;
    const hc = session.human_confirm;
    if (hc === 'all') return true;
    if (hc === 'none') return false;
    return hc.before === nextUnitOrd;
  })();

  const rowStyle = {
    background: 'var(--surface-rail)',
    border: '1px solid var(--surface-raised)',
    borderRadius: '6px',
    padding: '8px',
  };

  return (
    <div data-testid="decisions-ledger" className="flex flex-col gap-2">
      {decidedUnits.length === 0 && pendingGate === null ? (
        <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
          No governed decisions recorded yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {decidedUnits.map((u) => (
            <li key={u.ord} data-testid="ledger-row" data-ord={u.ord} style={rowStyle}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-[11px] font-mono" style={{ color: 'var(--ink-high)' }}>unit #{u.ord}</span>
                  {(u.role === 'creator' || u.role === 'evaluator') && (
                    <span
                      data-testid="role-badge"
                      className="text-[10px] font-mono px-1 rounded"
                      style={{
                        background: u.role === 'evaluator' ? 'var(--accent-subtle)' : 'var(--status-run-dim)',
                        color: u.role === 'evaluator' ? 'var(--accent)' : 'var(--status-run)',
                      }}
                    >
                      {u.role === 'creator' ? 'Creator' : 'Evaluator'}
                    </span>
                  )}
                  {u.gate != null && u.gate !== 'auto' && (
                    <span
                      data-testid="gate-badge"
                      className="text-[10px] font-mono px-1 rounded"
                      style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}
                    >
                      {typeof u.gate === 'string' && u.gate === 'human_confirm'
                        ? 'HUMAN-CONFIRM'
                        : typeof u.gate === 'object' && 'human_confirm' in u.gate
                        ? 'HUMAN-CONFIRM'
                        : 'CONDITIONAL'}
                    </span>
                  )}
                  {u.attempts.length > 1 && (
                    <span
                      data-testid="rework-badge"
                      className="text-[10px] font-mono px-1 rounded"
                      style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}
                    >
                      ×{u.attempts.length}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                  {u.resolved ? u.stage : 'resolving…'}
                </span>
              </div>

              <RoutingProvenance routing={u.routing} />
              {u.skillRef && (
                <p className="text-[11px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                  skill: <span style={{ color: 'var(--ink-muted)' }}>{u.skillRef}</span>
                </p>
              )}

              {u.gateEvals.map((g, i) => (
                <div
                  key={i}
                  className="mt-1 rounded p-1.5"
                  style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
                >
                  <p className="text-[11px] font-mono">
                    <span
                      className="font-semibold"
                      style={{ color: g.combined ? 'var(--status-run)' : 'var(--status-fail)' }}
                    >
                      {g.combined ? 'ALLOW' : 'DENY'}
                    </span>
                    <span style={{ color: 'var(--ink-muted)' }}>
                      {/* Usability review #7: "ALLOW · ungated · (ungated)" said the same
                          nothing twice. An ungated allow is ONE honest line. */}
                      {g.combined && gateDecider(g) === 'ungated' && !g.criterion
                        ? ' · allowed — no policy applied'
                        : <>{' · '}{gateDecider(g)}{g.criterion ? ` · ${g.criterion}` : ' · no criterion recorded'}</>}
                    </span>
                  </p>
                  {g.hasDeterministicFloor && (
                    <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                      deterministic: {g.deterministicPass ? 'pass' : 'fail'}
                    </p>
                  )}
                  {g.agentVerdict !== null && (
                    <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                      agent: {g.agentVerdict}
                      {g.agentReasoning ? ` — ${g.agentReasoning}` : ''}
                    </p>
                  )}
                  {/* A vacuous pass (true with zero policies) renders NO evaluator line:
                      the headline above already says "allowed — no policy applied", and
                      repeating it dressed as an evaluator verdict is the theater review
                      #7 flagged. A fail, or a pass that names its policies, still shows. */}
                  {g.evaluatorPass !== null && !(g.evaluatorPass && g.evaluatorPolicies.length === 0) && (
                    <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                      evaluator: {g.evaluatorPass ? 'pass' : 'fail'}
                      {g.evaluatorPolicies.length > 0
                        ? ` — ${g.evaluatorPolicies.join(', ')}`
                        : ''}
                    </p>
                  )}
                  {g.denialReason && (
                    <p className="text-[10px] font-mono" style={{ color: 'var(--status-fail)' }}>
                      reason: {g.denialReason}
                    </p>
                  )}
                </div>
              ))}

              {u.denialReason && u.gateEvals.length === 0 && (
                <p className="mt-1 text-[11px] font-mono" style={{ color: 'var(--status-fail)' }} data-testid="ledger-denial">
                  denied: {u.denialReason}
                </p>
              )}
            </li>
          ))}

          {pendingGate !== null && (
            <li
              data-testid="ledger-pending"
              className="rounded p-2 text-[11px] font-mono"
              style={{
                background: 'var(--status-gate-dim)',
                border: '1px dashed var(--status-gate)',
                color: 'var(--status-gate)',
              }}
            >
              <span className="font-semibold">PENDING</span> · awaiting human · before unit #
              {pendingGate.ord}
              {pendingGate.prompt ? ` — ${pendingGate.prompt}` : ''}
            </li>
          )}
          {nextUnitOrd !== null && (
            <li
              data-testid="ledger-next"
              className="rounded p-2 text-[11px] font-mono"
              style={{
                border: '1px dashed var(--surface-raised)',
                color: 'var(--ink-dim)',
              }}
            >
              {nextIsGated ? 'next decision point · unit #' : 'next unit · unit #'}
              {nextUnitOrd}
              {nextIsGated ? ' (human-confirm gate)' : ''}
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
