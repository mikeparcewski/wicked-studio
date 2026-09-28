import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { WorkUnit } from '../api/types.js';
import { phaseLabel } from './gateVerdictModel.js';
import { unitKey } from './NarratorFeed.js';

/**
 * What a pre-run gate asks the operator to approve (studio#232): the phase that just FINISHED —
 * named, with its output one click away — and one line on what runs next. The engine's prompt
 * ("Approve unit N before it runs: <phase> — <intent>") echoes the NEXT unit's intent, the same
 * text on every gate; this block leads the card so the reviewer reviews the work, not the brief.
 *
 * The output is read (`GET /runs/:id/units/:unitKey/output`) only when the operator opens it.
 */
export function GateUnderReview({ runId, units, reviewed, next }: {
  runId: string;
  units: readonly WorkUnit[];
  reviewed: WorkUnit;
  next: WorkUnit | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const key = unitKey(runId, reviewed.id, reviewed.ord);
  const [read, setRead] = useState<{ key: string; text: string | null; note: string | null } | null>(null);
  useEffect(() => {
    if (!open || read?.key === key) return;
    let cancelled = false;
    api.getUnitOutput(runId, key)
      .then(({ output, outputUnavailable }) => {
        if (!cancelled) setRead({ key, text: output, note: output === null ? (outputUnavailable ?? 'no transcript stored for this phase') : null });
      })
      .catch(() => { if (!cancelled) setRead({ key, text: null, note: "the phase's output could not be read" }); });
    return () => { cancelled = true; };
  }, [open, key, runId, read?.key]);

  const phase = phaseLabel(runId, units, reviewed.ord);
  const shown = read !== null && read.key === key ? read : null;
  return (
    <div data-testid="gate-under-review" data-reviewed-ord={reviewed.ord} className="mb-3">
      <p className="text-sm" style={{ color: 'var(--ink-high)' }}>
        <span className="font-semibold">Under review: {phase}</span>
        <span className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}> · unit #{reviewed.ord} finished{reviewed.assigned_cli ? ` on ${reviewed.assigned_cli}` : ''}</span>
      </p>
      {next !== null && (
        <p data-testid="gate-next" className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
          Approve runs next: {phaseLabel(runId, units, next.ord)} (unit #{next.ord})
        </p>
      )}
      <details className="mt-1" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary data-testid="gate-under-review-toggle" className="text-[11px] font-mono cursor-pointer select-none" style={{ color: 'var(--ink-dim)' }}>
          read {phase}&apos;s output
        </summary>
        {shown === null ? (
          open && <p className="text-[11px] font-mono mt-1" style={{ color: 'var(--ink-dim)' }}>reading…</p>
        ) : shown.text !== null ? (
          <pre
            data-testid="gate-under-review-output"
            className="text-[11px] font-mono overflow-auto max-h-64 mt-1 p-2 rounded"
            style={{ background: 'var(--surface-base)', color: 'var(--ink-body)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {shown.text}
          </pre>
        ) : (
          <p data-testid="gate-under-review-note" className="text-[11px] font-mono mt-1" style={{ color: 'var(--ink-dim)' }}>{shown.note}</p>
        )}
      </details>
    </div>
  );
}
