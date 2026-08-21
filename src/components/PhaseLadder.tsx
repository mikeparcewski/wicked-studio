import type { RunModel, UnitModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

const STATUS_DOT: Record<UnitModel['status'], { bg: string; border: string; color: string; label: string }> = {
  pending:     { bg: 'var(--surface-raised)', border: 'var(--surface-raised)', color: 'var(--ink-dim)', label: 'pending' },
  distributed: { bg: 'var(--accent-subtle)', border: 'var(--accent)',      color: 'var(--accent)',      label: 'dispatched' },
  done:        { bg: 'var(--status-run-dim)',   border: 'var(--status-run)',                color: 'var(--status-run)',               label: 'done' },
  rejected:    { bg: 'var(--status-fail-dim)',   border: 'var(--status-fail)',                color: 'var(--status-fail)',               label: 'rejected' },
};

const STAGE_COLOR: Record<UnitModel['stage'], string> = {
  recon:  'var(--accent)',
  build:  'var(--status-run)',
  review: 'var(--accent-dim)',
  test:   'var(--status-gate)',
};

export function PhaseLadder({ model }: Props): React.ReactElement {
  const { units, session } = model;

  const humanGateAt = (ord: number): boolean => {
    const hc = session.human_confirm;
    if (hc === 'all') return true;
    if (hc === 'none') return false;
    return hc.before === ord;
  };

  if (units.length === 0) {
    return (
      <div data-testid="phase-ladder" className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
        No units planned yet.
      </div>
    );
  }

  return (
    <div data-testid="phase-ladder" className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider font-mono" style={{ color: 'var(--ink-dim)' }}>
        Phase ladder
      </p>
      <ol className="flex flex-wrap items-stretch gap-1">
        {units.map((u, i) => {
          if (!u.resolved) {
            return (
              <li
                key={u.ord}
                className="flex items-center gap-1"
                data-testid="ladder-unit"
                data-ord={u.ord}
                data-resolving="true"
              >
                {i > 0 && <span className="h-px w-3" style={{ background: 'var(--surface-raised)' }} aria-hidden />}
                <div
                  className="flex min-w-[3.5rem] flex-col items-center rounded px-2 py-1 font-mono"
                  style={{
                    background: 'var(--surface-raised)',
                    border: '1px dashed var(--surface-raised)',
                    color: 'var(--ink-dim)',
                  }}
                  title={`unit #${u.ord} — resolving (awaiting snapshot)`}
                >
                  <span className="text-[10px] font-semibold">#{u.ord}</span>
                  <span className="text-[9px] italic">resolving…</span>
                </div>
              </li>
            );
          }
          const dot = STATUS_DOT[u.status];
          const isCurrent = u.ord === session.unit_ix + 1;
          const gate = u.gateEvals.length > 0;
          const gateDenied = u.gateEvals.some((g) => !g.combined) || u.status === 'rejected';
          const human = humanGateAt(u.ord);
          const stageColor = STAGE_COLOR[u.stage] ?? 'var(--ink-dim)';
          return (
            <li key={u.ord} className="flex items-center gap-1" data-testid="ladder-unit" data-ord={u.ord}>
              {i > 0 && <span className="h-px w-3" style={{ background: 'var(--surface-raised)' }} aria-hidden />}
              <div
                className="flex min-w-[3.5rem] flex-col items-center rounded px-2 py-1 font-mono"
                style={{
                  background: dot.bg,
                  border: `1px solid ${isCurrent ? 'var(--accent)' : dot.border}`,
                  boxShadow: isCurrent ? '0 0 0 2px var(--accent-subtle)' : 'none',
                  color: dot.color,
                }}
                title={`unit #${u.ord} — ${u.stage} — ${dot.label}`}
              >
                <span className="text-[10px] font-semibold" style={{ color: 'var(--ink-muted)' }}>#{u.ord}</span>
                <span className="text-[9px] font-medium uppercase" style={{ color: stageColor }}>{u.stage}</span>
                <span className="text-[9px]">{dot.label}</span>
              </div>
              {(gate || human) && (
                <span
                  data-testid="ladder-gate"
                  className="text-xs"
                  style={{ color: gateDenied ? 'var(--status-fail)' : gate ? 'var(--status-run)' : 'var(--ink-dim)' }}
                  title={
                    gate
                      ? `gate evaluated (${gateDenied ? 'denied' : 'allowed'})`
                      : 'human-confirm gate (policy)'
                  }
                >
                  ◆
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
