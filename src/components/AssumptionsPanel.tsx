import type { RunModel, UnitModel } from '../hooks/useRunModel.js';
import { useRuntimeStore } from '../store/runtime.js';
import { isUnanimous, lostQuorum, quorumLabel } from './councilQuorum.js';

interface Props {
  model: RunModel;
}

function routingSummary(r: NonNullable<UnitModel['routing']>): string {
  if (r.method === 'council') {
    // "unanimous" is reserved for a council that KEPT its quorum. Zero dissent among one
    // surviving seat of three is silence, not agreement (FINDING-026 D). The exception is a
    // pre-fix run with no `seated` recorded: no quorum signal exists, so `isUnanimous` keeps
    // the old reading rather than casting doubt on every historical council.
    if (isUnanimous(r)) return `council: ${r.winner} (unanimous)`;
    const agreement = `${r.dissent} dissent, ${r.agreement_pct}% agreement`;
    return lostQuorum(r)
      ? `council: ${r.winner} (quorum lost — ${quorumLabel(r)}, ${agreement})`
      : `council: ${r.winner} (${agreement})`;
  }
  if (r.method === 'evaluator_distinct') return `evaluator≠creator: ${r.winner} (was ${r.was})`;
  if (r.method === 'tool') return 'tool: direct command (no council)';
  return `degraded: ${r.reason}`;
}

export function AssumptionsPanel({ model }: Props): React.ReactElement {
  const routed = model.units.filter((u) => u.resolved && u.routing != null);
  const recorded = useRuntimeStore((s) => s.assumptions[model.session.id]) ?? [];

  return (
    <div data-testid="assumptions" className="flex flex-col gap-2 text-[11px]">
      {recorded.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-mono font-semibold" style={{ color: 'var(--ink-muted)' }}>
            external transformations
          </p>
          <ul className="flex flex-col gap-1">
            {recorded.map((a, i) => (
              <li
                key={`${a.ord}:${a.library}:${i}`}
                data-testid="assumption-transform"
                className="rounded p-1.5 font-mono"
                style={{
                  background: a.known ? 'var(--status-run-dim)' : 'var(--status-gate-dim)',
                  border: a.known
                    ? '1px solid var(--status-run-dim)'
                    : '1px dashed var(--status-gate)',
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span style={{ color: 'var(--ink-high)' }}>unit #{a.ord}</span>
                  <span style={{ color: 'var(--accent)' }}>{a.library}</span>
                  {!a.known && (
                    <span
                      data-testid="needs-review-badge"
                      className="rounded px-1 text-[9px] font-semibold uppercase"
                      style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}
                    >
                      needs review
                    </span>
                  )}
                </div>
                <p style={{ color: 'var(--ink-muted)' }}>{a.transform}</p>
                <p style={{ color: 'var(--ink-muted)' }}>{a.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {routed.length === 0 ? (
        <p style={{ color: 'var(--ink-dim)' }}>
          No routing decisions recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {routed.map((u) => (
            <li
              key={u.ord}
              className="rounded p-1.5 font-mono"
              style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
            >
              <span className="font-medium" style={{ color: 'var(--ink-high)' }}>unit #{u.ord}</span>
              {u.description.includes(' — ') && (
                <span className="ml-1" style={{ color: 'var(--ink-dim)' }}>
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
