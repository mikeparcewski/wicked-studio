import { useState } from 'react';
import type { WorkUnit } from '../api/types.js';
import { useVerdictDiff } from '../hooks/useVerdictDiff.js';

/**
 * The verdict diff toggle (brainstorm idea 2): the reviewer's failing criteria beside what the
 * creator claimed, so "why did it fail" reads on the gate card without the timeline. Collapsed by
 * default; opening it reads the creator's transcript once.
 */
export function VerdictDiff({ runId, units, reviewedOrd, items }: {
  runId: string;
  units: readonly WorkUnit[];
  reviewedOrd: number | null;
  items: readonly string[];
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const diff = useVerdictDiff(runId, units, reviewedOrd, items, open);
  return (
    <div className="mb-2" data-testid="verdict-diff" data-open={String(open)} data-state={diff.state}>
      <button
        type="button"
        data-testid="verdict-diff-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] font-mono"
        style={{ color: 'var(--ink-dim)' }}
      >
        {open ? '▾' : '▸'} Why it failed — the reviewer&apos;s {items.length} failing item{items.length === 1 ? '' : 's'} beside what {diff.creator ?? 'the creator'} claimed
      </button>
      {open && (
        <table className="w-full mt-1 text-[10px] font-mono" style={{ borderCollapse: 'collapse', color: 'var(--ink-body)' }}>
          <thead>
            <tr style={{ color: 'var(--ink-dim)', textAlign: 'left' }}>
              <th className="pr-2 font-normal" style={{ width: '50%' }}>Reviewer: failing</th>
              <th className="font-normal">{diff.creator ?? 'Creator'} claimed</th>
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((r) => (
              <tr key={r.criterion} data-testid="verdict-diff-row" style={{ borderTop: '1px solid var(--surface-raised)', verticalAlign: 'top' }}>
                <td data-testid="verdict-diff-criterion" className="pr-2 py-1" style={{ color: 'var(--status-fail)', overflowWrap: 'anywhere' }}>
                  {r.criterion}
                </td>
                <td data-testid="verdict-diff-claim" className="py-1" style={{ overflowWrap: 'anywhere', ...(r.claim === null ? { color: 'var(--ink-dim)' } : {}) }}>
                  {diff.state === 'loading' ? 'reading…' : r.claim ?? 'no claim about this'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && diff.note !== null && (
        <p data-testid="verdict-diff-note" className="text-[10px] font-mono mt-1" style={{ color: 'var(--ink-dim)' }}>
          {diff.note}
        </p>
      )}
    </div>
  );
}
