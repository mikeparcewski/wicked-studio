import type { RunModel, UnitModel } from '../hooks/useRunModel.js';
import { RoutingProvenance } from './RoutingProvenance.js';

interface Props {
  model: RunModel;
}

/**
 * Who owned a decision. HONESTY (cockpit adversarial review): under deny-dominance the DENIER is the
 * layer that FAILED, not the deepest layer that ran. On a DENY (`combined === false`) attribute to the
 * failing layer(s); a naive "deepest layer" read would blame the agent judge for a denial the agent
 * actually PASSED (e.g. the deterministic floor failed while the semantic judge approved). On an ALLOW
 * every layer that ran approved, so the deepest layer that ran owns the (approving) decision.
 */
function gateDecider(g: UnitModel['gateEvals'][number]): string {
  if (!g.combined) {
    const deniers: string[] = [];
    if (g.hasDeterministicFloor && !g.deterministicPass) deniers.push('deterministic floor');
    if (g.evaluatorPass === false) deniers.push('evaluator (2nd pass)');
    // The agent event carries only a verdict string (no boolean), so the agent is named a denier only
    // by ELIMINATION — when no provable floor/evaluator failure explains the DENY, the agent must have
    // rejected. This never blames the agent while a concrete floor/evaluator denial is present.
    if (deniers.length === 0 && g.agentVerdict !== null) deniers.push('agent judge');
    return deniers.length > 0 ? deniers.join(' + ') : 'governance';
  }
  if (g.evaluatorPass !== null) return 'evaluator (2nd pass)';
  if (g.agentVerdict !== null) return 'agent judge';
  if (g.hasDeterministicFloor) return 'deterministic floor';
  return 'ungated';
}

/**
 * FR-5 Decisions ledger (made + pending). Hydrated from the snapshot's routing
 * (council winner / agreement% / dissent, via {@link RoutingProvenance}) + `denial_reason`,
 * and appended by live `gateEvaluated` rows (deterministicPass / agentVerdict + reasoning /
 * evaluatorPass / denialReason / combined — and *who decided*). Pending = the current
 * awaiting-human gate + the next unit's gate. Every field maps to a real event/snapshot
 * field; nothing is invented.
 */
export function DecisionsLedger({ model }: Props): React.ReactElement {
  const { units, session, pendingGate } = model;

  const decidedUnits = units.filter(
    (u) => u.routing !== null || u.denialReason !== null || u.gateEvals.length > 0,
  );

  // The next unit down the ladder. We do NOT assert a gate/"decision point" here: the run's
  // human_confirm policy decides whether a gate lands, so this is labeled neutrally as the next
  // unit. It is flagged as a real gate only when the policy actually places one before it.
  const nextUnitOrd =
    pendingGate !== null ? pendingGate.ord + 1 : session.status === 'executing' ? session.unit_ix : null;

  const nextIsGated = ((): boolean => {
    if (nextUnitOrd === null) return false;
    const hc = session.human_confirm;
    if (hc === 'all') return true;
    if (hc === 'none') return false;
    return hc.before === nextUnitOrd;
  })();

  const rowStyle: React.CSSProperties = {
    background: '#1b222e',
    border: '1px solid rgba(230,237,243,0.07)',
    borderRadius: '0.75rem',
    padding: '0.75rem',
    fontSize: '11px',
  };

  return (
    <div data-testid="decisions-ledger" className="flex flex-col gap-2">
      {decidedUnits.length === 0 && pendingGate === null ? (
        <p className="text-xs text-gray-400">No governed decisions recorded yet.</p>
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

              {/* Routing / skill provenance (snapshot). Reuses RoutingProvenance. */}
              <RoutingProvenance routing={u.routing} />
              {u.skillRef && (
                <p className="text-[11px] text-gray-500">
                  skill: <span className="font-mono">{u.skillRef}</span>
                </p>
              )}

              {/* Gate evaluations (live gateEvaluated). */}
              {u.gateEvals.map((g, i) => (
                <div key={i} className="mt-1 rounded bg-gray-50 p-1.5">
                  <p className={g.combined ? 'text-green-700' : 'text-red-700'}>
                    <span className="font-semibold">{g.combined ? 'ALLOW' : 'DENY'}</span> ·{' '}
                    {gateDecider(g)}
                    {g.criterion ? ` · ${g.criterion}` : ' · (ungated)'}
                  </p>
                  {g.hasDeterministicFloor && (
                    <p className="text-gray-500">
                      deterministic: {g.deterministicPass ? 'pass' : 'fail'}
                    </p>
                  )}
                  {g.agentVerdict !== null && (
                    <p className="text-gray-500">
                      agent: {g.agentVerdict}
                      {g.agentReasoning ? ` — ${g.agentReasoning}` : ''}
                    </p>
                  )}
                  {g.evaluatorPass !== null && (
                    <p className="text-gray-500">evaluator: {g.evaluatorPass ? 'pass' : 'fail'}</p>
                  )}
                  {g.denialReason && <p className="text-red-600">reason: {g.denialReason}</p>}
                </div>
              ))}

              {/* Snapshot denial_reason (when no live gate detail arrived). */}
              {u.denialReason && u.gateEvals.length === 0 && (
                <p className="mt-1 text-red-600" data-testid="ledger-denial">
                  denied: {u.denialReason}
                </p>
              )}
            </li>
          ))}

          {/* Pending: current awaiting-human gate + the next gate down the ladder. */}
          {pendingGate !== null && (
            <li
              data-testid="ledger-pending"
              className="rounded border border-dashed border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-700"
            >
              <span className="font-semibold">PENDING</span> · awaiting human · before unit #
              {pendingGate.ord}
              {pendingGate.prompt ? ` — ${pendingGate.prompt}` : ''}
            </li>
          )}
          {nextUnitOrd !== null && (
            <li
              data-testid="ledger-next"
              className="rounded border border-dashed border-gray-200 p-2 text-[11px] text-gray-400"
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
