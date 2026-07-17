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

/**
 * FR-6 Assumptions — **proto** (NFR-3 labeled). Shows routing provenance for every resolved
 * unit (council outcome, evaluator-distinct re-assignment, or degraded fallback). The full
 * assumptions surface (toolchain, no-rollback constraints, …) awaits a skill convention.
 */
export function AssumptionsPanel({ model }: Props): React.ReactElement {
  const routed = model.units.filter((u) => u.resolved && u.routing != null);

  return (
    <div data-testid="assumptions" className="flex flex-col gap-2 text-[11px]">
      <p className="rounded border border-dashed border-purple-300 bg-purple-50 p-1.5 text-purple-600">
        proto — routing provenance per unit; structured-assumptions skill convention pending
      </p>
      {routed.length === 0 ? (
        <p className="text-gray-400">
          No routing decisions recorded yet. The full assumptions surface (assumed toolchain,
          no-rollback, …) is coming with the skill convention.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {routed.map((u) => (
            <li key={u.ord} className="rounded border border-gray-200 p-1.5 text-gray-600">
              <span className="font-medium">unit #{u.ord}</span>
              {u.description.includes(' — ') && (
                <span className="ml-1 text-gray-400">{u.description.split(' — ')[0]}</span>
              )}{' '}
              — {routingSummary(u.routing!)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
