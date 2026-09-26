import type { PhaseSelection } from '../hooks/useLaunchPlan.js';
import { entryMarks } from '../board/planModel.js';

/**
 * The phase picker (DES-TEAMING-002 §8.12): the engine's catalog (`GET /catalog`) as options, the
 * person's ordered selection, and the files the work will touch. A skin over `usePhaseSelection` —
 * the options are whatever the catalog serves, never a list of our own.
 */
export function PhasePicker({ model, touch = true, emptyText }: {
  model: PhaseSelection;
  /** Offer the touch field (a launch); a mid-run edit carries no touch set. */
  touch?: boolean;
  emptyText?: string;
}): React.ReactElement {
  const { catalog, entries, picked } = model;
  return (
    <div
      data-testid="phase-picker"
      data-catalog-state={catalog}
      className="flex flex-col gap-2 rounded-xl px-3 py-2"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>
          Phases
        </span>
        {catalog === 'loading' && (
          <span className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>loading the catalog…</span>
        )}
        {catalog === 'unsupported' && (
          <span data-testid="phase-catalog-unsupported" className="text-[11px]" style={{ color: 'var(--status-gate)' }}>
            This daemon has no phase catalog. Upgrade wicked-crew to compose a plan.
          </span>
        )}
        {catalog === 'error' && (
          <span data-testid="phase-catalog-error" className="text-[11px]" style={{ color: 'var(--status-fail)' }}>
            Could not load the phase catalog.
          </span>
        )}
        {catalog === 'ready' && entries.map((e) => {
          const marks = entryMarks(e);
          return (
            <button
              key={e.id}
              type="button"
              data-testid="phase-option"
              data-catalog={e.id}
              title={[e.description ?? e.id, ...marks].join(' · ')}
              onClick={() => model.add(e.id)}
              className="rounded-lg px-2 py-0.5 text-[11px] font-mono"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            >
              + {e.id}
            </button>
          );
        })}
      </div>

      <ol data-testid="phase-selection" className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
        {picked.length === 0 ? (
          <li style={{ color: 'var(--ink-dim)' }}>
            {emptyText ?? 'No phases picked: the launch uses the workflow chosen under +.'}
          </li>
        ) : (
          picked.map((p, i) => (
            <li
              key={`${p.catalog}-${i}`}
              data-testid="phase-selected"
              data-catalog={p.catalog}
              className="flex items-center gap-1 rounded-lg px-2 py-0.5"
              style={{ background: 'var(--accent-subtle)', color: 'var(--ink-high)' }}
            >
              <span style={{ color: 'var(--ink-dim)' }}>{i + 1}.</span> {p.catalog}
              <button
                type="button"
                aria-label={`Remove ${p.catalog}`}
                data-testid="phase-remove"
                onClick={() => model.remove(i)}
                style={{ color: 'var(--ink-dim)' }}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ol>

      {touch && <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Files this will change (optional, one per line). Leave it empty and the PA scopes the plan first.
        <textarea
          data-testid="plan-touch"
          rows={2}
          value={model.touchText}
          onChange={(e) => model.setTouchText(e.target.value)}
          placeholder="src/auth/login.ts"
          className="rounded-lg px-2 py-1 font-mono resize-y"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
        />
      </label>}
    </div>
  );
}
