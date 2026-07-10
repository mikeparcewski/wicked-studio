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

/**
 * FR-7 Burn + rework-cost. Running tokens + cost from real `cliUsage` events, a per-CLI
 * split, and the REWORK slice = Σ tokens where `attempt>0` (tied to the ledger's gate
 * rejections). Cost comes from claude directly. A non-claude seat that emitted no `cliUsage`
 * is listed honestly as "usage unavailable" (no usage adapter) — never rendered as 0; a claude
 * seat with no usage *yet* is "not yet reported" (transient), never "unavailable". Token totals
 * + rework% are captioned as forward-only/provisional whenever usage may still be incomplete.
 * If no usage has arrived at all, the panel says so rather than showing fabricated numbers.
 */
export function Burn({ model }: Props): React.ReactElement {
  const b = burnSummary(model);

  // Forward-only totals: the merge only sees usage from connect onward, so totals + rework% are
  // provisional whenever the run is still live OR a seat's usage is missing/lagging.
  const nonTerminal = !TERMINAL.has(model.session.status);
  const partialTotals = nonTerminal || b.noAdapterClis.length > 0 || b.pendingUsageClis.length > 0;

  return (
    <div data-testid="burn" className="flex flex-col gap-2 text-[11px]">
      {!b.hasUsage ? (
        <p className="text-gray-400" data-testid="burn-empty">
          Awaiting usage — token/cost burn lights up when a CLI emits <code>cliUsage</code>{' '}
          (claude reports tokens + cost directly).
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-gray-200 p-2">
              <p className="text-gray-400">tokens{partialTotals ? ' (partial)' : ''}</p>
              <p className="font-mono text-sm text-gray-700">{tokens(b.totalTokens)}</p>
              <p className="text-[10px] text-gray-400">
                {tokens(b.totalInput)} in / {tokens(b.totalOutput)} out
              </p>
            </div>
            <div className="rounded border border-gray-200 p-2">
              <p className="text-gray-400">cost{b.costComplete && !partialTotals ? '' : ' (partial)'}</p>
              <p className="font-mono text-sm text-gray-700">{cost(b.totalCost)}</p>
              {b.totalCost === null && <p className="text-[10px] text-gray-400">no cost reported</p>}
            </div>
            <div className="rounded border border-gray-200 p-2" data-testid="burn-rework">
              <p className="text-gray-400">rework{partialTotals ? ' (provisional)' : ''}</p>
              <p className="font-mono text-sm text-gray-700">
                {partialTotals ? '~' : ''}
                {b.reworkPct.toFixed(0)}%
              </p>
              <p className="text-[10px] text-gray-400">{tokens(b.reworkTokens)} tok (attempt&gt;0)</p>
            </div>
          </div>

          {partialTotals && (
            <p className="text-[10px] text-gray-400" data-testid="burn-partial">
              Token totals and rework% are from connect onward; earlier usage may be missing —
              treat rework% as provisional.
            </p>
          )}

          <div>
            <p className="mb-1 text-gray-400">per CLI</p>
            <ul className="flex flex-col gap-0.5">
              {b.perCli.map((c) => (
                <li key={c.cli} className="flex justify-between font-mono text-gray-600">
                  <span>{c.cli}</span>
                  <span>
                    {tokens(c.input + c.output)} tok · {cost(c.cost)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {b.noAdapterClis.length > 0 && (
        <p className="text-amber-600" data-testid="burn-unavailable">
          usage unavailable for {b.noAdapterClis.join(', ')} — no usage adapter (this seat doesn&apos;t
          emit <code>cliUsage</code>)
        </p>
      )}

      {b.pendingUsageClis.length > 0 && (
        <p className="text-gray-400" data-testid="burn-pending">
          usage not yet reported for {b.pendingUsageClis.join(', ')} — claude reports tokens + cost
          directly; the record can lag the dispatch or the client joined mid-run.
        </p>
      )}
    </div>
  );
}
