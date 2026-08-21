import { burnSummary, type RunModel } from '../hooks/useRunModel.js';
import type { SessionStatus } from '../api/types.js';

interface Props {
  model: RunModel;
}

const TERMINAL: ReadonlySet<SessionStatus> = new Set(['completed', 'cancelled', 'failed']);

const fmt = new Intl.NumberFormat('en-US');

function tokens(n: number): string {
  return fmt.format(n);
}

function cost(n: number | null): string {
  return n === null ? '—' : `$${n.toFixed(4)}`;
}

export function Burn({ model }: Props): React.ReactElement {
  const b = burnSummary(model);

  const nonTerminal = !TERMINAL.has(model.session.status);
  const partialTotals = nonTerminal || b.noAdapterClis.length > 0 || b.pendingUsageClis.length > 0;

  const cardStyle = {
    background: 'var(--surface-rail)',
    border: '1px solid var(--surface-raised)',
    borderRadius: '6px',
    padding: '8px',
  };

  return (
    <div data-testid="burn" className="flex flex-col gap-2 text-[11px]">
      {!b.hasUsage ? (
        <p style={{ color: 'var(--ink-dim)' }} data-testid="burn-empty">
          Awaiting usage — token/cost burn lights up when a CLI emits <code>cliUsage</code>{' '}
          (claude reports tokens + cost directly).
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div style={cardStyle}>
              <p style={{ color: 'var(--ink-dim)' }}>tokens{partialTotals ? ' (partial)' : ''}</p>
              <p className="font-mono text-sm" style={{ color: 'var(--ink-high)' }}>{tokens(b.totalTokens)}</p>
              <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                {tokens(b.totalInput)} in / {tokens(b.totalOutput)} out
              </p>
              {(b.totalCacheRead > 0 || b.totalCacheCreation > 0) && (
                <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                  {tokens(b.totalCacheRead)} cached · {tokens(b.totalCacheCreation)} written
                </p>
              )}
            </div>
            <div style={cardStyle}>
              <p style={{ color: 'var(--ink-dim)' }}>cost{b.costComplete && !partialTotals ? '' : ' (partial)'}</p>
              <p className="font-mono text-sm" style={{ color: 'var(--ink-high)' }}>{cost(b.totalCost)}</p>
              {b.totalCost === null && <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>no cost reported</p>}
            </div>
            <div style={cardStyle} data-testid="burn-rework">
              <p style={{ color: 'var(--ink-dim)' }}>rework{partialTotals ? ' (prov.)' : ''}</p>
              <p className="font-mono text-sm" style={{ color: 'var(--ink-high)' }}>
                {partialTotals ? '~' : ''}{b.reworkPct.toFixed(0)}%
              </p>
              <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{tokens(b.reworkTokens)} tok</p>
            </div>
          </div>

          {partialTotals && (
            <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }} data-testid="burn-partial">
              Token totals and rework% are from connect onward; earlier usage may be missing.
            </p>
          )}

          <div>
            <p className="mb-1" style={{ color: 'var(--ink-dim)' }}>per CLI</p>
            <ul className="flex flex-col gap-0.5">
              {b.perCli.map((c) => (
                <li key={c.cli} className="flex justify-between font-mono" style={{ color: 'var(--ink-muted)' }}>
                  <span>{c.cli}</span>
                  <span>{tokens(c.input + c.output)} tok · {cost(c.cost)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {b.noAdapterClis.length > 0 && (
        <p style={{ color: 'var(--status-gate)' }} data-testid="burn-unavailable">
          usage unavailable for {b.noAdapterClis.join(', ')} — no usage adapter
        </p>
      )}

      {b.pendingUsageClis.length > 0 && (
        <p style={{ color: 'var(--ink-dim)' }} data-testid="burn-pending">
          usage not yet reported for {b.pendingUsageClis.join(', ')}
        </p>
      )}
    </div>
  );
}
