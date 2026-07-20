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
    background: '#161c26',
    border: '1px solid rgba(230,237,243,0.07)',
    borderRadius: '6px',
    padding: '8px',
  };

  return (
    <div data-testid="burn" className="flex flex-col gap-2 text-[11px]">
      {!b.hasUsage ? (
        <p style={{ color: 'rgba(230,237,243,0.4)' }} data-testid="burn-empty">
          Awaiting usage — token/cost burn lights up when a CLI emits <code>cliUsage</code>{' '}
          (claude reports tokens + cost directly).
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div style={cardStyle}>
              <p style={{ color: 'rgba(230,237,243,0.4)' }}>tokens{partialTotals ? ' (partial)' : ''}</p>
              <p className="font-mono text-sm" style={{ color: '#e6edf3' }}>{tokens(b.totalTokens)}</p>
              <p className="text-[10px]" style={{ color: 'rgba(230,237,243,0.35)' }}>
                {tokens(b.totalInput)} in / {tokens(b.totalOutput)} out
              </p>
            </div>
            <div style={cardStyle}>
              <p style={{ color: 'rgba(230,237,243,0.4)' }}>cost{b.costComplete && !partialTotals ? '' : ' (partial)'}</p>
              <p className="font-mono text-sm" style={{ color: '#e6edf3' }}>{cost(b.totalCost)}</p>
              {b.totalCost === null && <p className="text-[10px]" style={{ color: 'rgba(230,237,243,0.35)' }}>no cost reported</p>}
            </div>
            <div style={cardStyle} data-testid="burn-rework">
              <p style={{ color: 'rgba(230,237,243,0.4)' }}>rework{partialTotals ? ' (prov.)' : ''}</p>
              <p className="font-mono text-sm" style={{ color: '#e6edf3' }}>
                {partialTotals ? '~' : ''}{b.reworkPct.toFixed(0)}%
              </p>
              <p className="text-[10px]" style={{ color: 'rgba(230,237,243,0.35)' }}>{tokens(b.reworkTokens)} tok</p>
            </div>
          </div>

          {partialTotals && (
            <p className="text-[10px]" style={{ color: 'rgba(230,237,243,0.35)' }} data-testid="burn-partial">
              Token totals and rework% are from connect onward; earlier usage may be missing.
            </p>
          )}

          <div>
            <p className="mb-1" style={{ color: 'rgba(230,237,243,0.4)' }}>per CLI</p>
            <ul className="flex flex-col gap-0.5">
              {b.perCli.map((c) => (
                <li key={c.cli} className="flex justify-between font-mono" style={{ color: 'rgba(230,237,243,0.6)' }}>
                  <span>{c.cli}</span>
                  <span>{tokens(c.input + c.output)} tok · {cost(c.cost)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {b.noAdapterClis.length > 0 && (
        <p style={{ color: '#ffda19' }} data-testid="burn-unavailable">
          usage unavailable for {b.noAdapterClis.join(', ')} — no usage adapter
        </p>
      )}

      {b.pendingUsageClis.length > 0 && (
        <p style={{ color: 'rgba(230,237,243,0.4)' }} data-testid="burn-pending">
          usage not yet reported for {b.pendingUsageClis.join(', ')}
        </p>
      )}
    </div>
  );
}
