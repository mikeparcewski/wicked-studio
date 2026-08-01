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
    background: '#161c26',
    border: '1px solid rgba(230,237,243,0.07)',
    borderRadius: '6px',
    padding: '8px',
  };

  return (
    <div data-testid="decisions-ledger" className="flex flex-col gap-2">
      {decidedUnits.length === 0 && pendingGate === null ? (
        <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
          No governed decisions recorded yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {decidedUnits.map((u) => (
            <li key={u.ord} data-testid="ledger-row" data-ord={u.ord} style={rowStyle}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-[11px] font-mono" style={{ color: '#e6edf3' }}>unit #{u.ord}</span>
                  {(u.role === 'creator' || u.role === 'evaluator') && (
                    <span
                      data-testid="role-badge"
                      className="text-[10px] font-mono px-1 rounded"
                      style={{
                        background: u.role === 'evaluator' ? 'rgba(56,139,253,0.15)' : 'rgba(63,185,80,0.12)',
                        color: u.role === 'evaluator' ? '#58a6ff' : '#3fb950',
                      }}
                    >
                      {u.role === 'creator' ? 'Creator' : 'Evaluator'}
                    </span>
                  )}
                  {u.gate != null && u.gate !== 'auto' && (
                    <span
                      data-testid="gate-badge"
                      className="text-[10px] font-mono px-1 rounded"
                      style={{ background: 'rgba(255,218,25,0.1)', color: '#ffda19' }}
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
                      style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149' }}
                    >
                      ×{u.attempts.length}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
                  {u.resolved ? u.stage : 'resolving…'}
                </span>
              </div>

              <RoutingProvenance routing={u.routing} />
              {u.skillRef && (
                <p className="text-[11px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
                  skill: <span style={{ color: 'rgba(230,237,243,0.6)' }}>{u.skillRef}</span>
                </p>
              )}

              {u.gateEvals.map((g, i) => (
                <div
                  key={i}
                  className="mt-1 rounded p-1.5"
                  style={{ background: '#0f1419', border: '1px solid rgba(230,237,243,0.05)' }}
                >
                  <p className="text-[11px] font-mono">
                    <span
                      className="font-semibold"
                      style={{ color: g.combined ? '#3fb950' : '#f85149' }}
                    >
                      {g.combined ? 'ALLOW' : 'DENY'}
                    </span>
                    <span style={{ color: 'rgba(230,237,243,0.45)' }}>
                      {' · '}{gateDecider(g)}
                      {g.criterion ? ` · ${g.criterion}` : ' · (ungated)'}
                    </span>
                  </p>
                  {g.hasDeterministicFloor && (
                    <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
                      deterministic: {g.deterministicPass ? 'pass' : 'fail'}
                    </p>
                  )}
                  {g.agentVerdict !== null && (
                    <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
                      agent: {g.agentVerdict}
                      {g.agentReasoning ? ` — ${g.agentReasoning}` : ''}
                    </p>
                  )}
                  {g.evaluatorPass !== null && (
                    <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
                      evaluator: {g.evaluatorPass ? 'pass' : 'fail'}
                      {/* Name the policies that ran, or say plainly that none did — "pass" on its
                          own reads as an enforced approval when it is a default-allow. */}
                      {g.evaluatorPolicies.length > 0
                        ? ` — ${g.evaluatorPolicies.join(', ')}`
                        : g.evaluatorPass
                          ? ' (no policy applied)'
                          : ''}
                    </p>
                  )}
                  {g.denialReason && (
                    <p className="text-[10px] font-mono" style={{ color: '#f85149' }}>
                      reason: {g.denialReason}
                    </p>
                  )}
                </div>
              ))}

              {u.denialReason && u.gateEvals.length === 0 && (
                <p className="mt-1 text-[11px] font-mono" style={{ color: '#f85149' }} data-testid="ledger-denial">
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
                background: 'rgba(255,218,25,0.06)',
                border: '1px dashed rgba(255,218,25,0.35)',
                color: '#ffda19',
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
                border: '1px dashed rgba(230,237,243,0.12)',
                color: 'rgba(230,237,243,0.35)',
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
