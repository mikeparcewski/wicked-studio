import type { RunModel, UnitModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

function routingSummary(r: NonNullable<UnitModel['routing']>): string {
  if (r.method === 'council') {
    return r.dissent > 0
      ? `council: ${r.winner} (${r.dissent} dissent, ${r.agreement_pct}% agreement)`
      : `council: ${r.winner} (unanimous)`;
  }
  if (r.method === 'evaluator_distinct') return `evaluator≠creator: ${r.winner} (was ${r.was})`;
  if (r.method === 'tool') return 'tool: direct command (no council)';
  return `degraded: ${r.reason}`;
}

export function AssumptionsPanel({ model }: Props): React.ReactElement {
  const routed = model.units.filter((u) => u.resolved && u.routing != null);

  return (
    <div data-testid="assumptions" className="flex flex-col gap-2 text-[11px]">
      <p
        className="rounded p-1.5 font-mono"
        style={{ background: 'rgba(167,139,250,0.08)', border: '1px dashed rgba(167,139,250,0.3)', color: '#a78bfa' }}
      >
        proto — routing provenance per unit; structured-assumptions skill convention pending
      </p>
      {routed.length === 0 ? (
        <p style={{ color: 'rgba(230,237,243,0.4)' }}>
          No routing decisions recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {routed.map((u) => (
            <li
              key={u.ord}
              className="rounded p-1.5 font-mono"
              style={{ background: '#161c26', border: '1px solid rgba(230,237,243,0.07)', color: 'rgba(230,237,243,0.6)' }}
            >
              <span className="font-medium" style={{ color: '#e6edf3' }}>unit #{u.ord}</span>
              {u.description.includes(' — ') && (
                <span className="ml-1" style={{ color: 'rgba(230,237,243,0.4)' }}>
                  {u.description.split(' — ')[0]}
                </span>
              )}{' '}
              — {routingSummary(u.routing!)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
