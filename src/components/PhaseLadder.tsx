import type { RunModel, UnitModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

const STATUS_DOT: Record<UnitModel['status'], { bg: string; border: string; color: string; label: string }> = {
  pending:     { bg: 'rgba(230,237,243,0.04)', border: 'rgba(230,237,243,0.15)', color: 'rgba(230,237,243,0.3)', label: 'pending' },
  distributed: { bg: 'rgba(121,192,255,0.08)', border: '#79c0ff',               color: '#79c0ff',               label: 'dispatched' },
  done:        { bg: 'rgba(63,185,80,0.08)',   border: '#3fb950',                color: '#3fb950',               label: 'done' },
  rejected:    { bg: 'rgba(248,81,73,0.08)',   border: '#f85149',                color: '#f85149',               label: 'rejected' },
};

const STAGE_COLOR: Record<UnitModel['stage'], string> = {
  recon:  '#79c0ff',
  build:  '#3fb950',
  review: '#a78bfa',
  test:   '#ffda19',
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
      <div data-testid="phase-ladder" className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
        No units planned yet.
      </div>
    );
  }

  return (
    <div data-testid="phase-ladder" className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
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
                {i > 0 && <span className="h-px w-3" style={{ background: 'rgba(230,237,243,0.08)' }} aria-hidden />}
                <div
                  className="flex min-w-[3.5rem] flex-col items-center rounded px-2 py-1 font-mono"
                  style={{
                    background: 'rgba(230,237,243,0.03)',
                    border: '1px dashed rgba(230,237,243,0.15)',
                    color: 'rgba(230,237,243,0.3)',
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
          const stageColor = STAGE_COLOR[u.stage] ?? 'rgba(230,237,243,0.4)';
          return (
            <li key={u.ord} className="flex items-center gap-1" data-testid="ladder-unit" data-ord={u.ord}>
              {i > 0 && <span className="h-px w-3" style={{ background: 'rgba(230,237,243,0.08)' }} aria-hidden />}
              <div
                className="flex min-w-[3.5rem] flex-col items-center rounded px-2 py-1 font-mono"
                style={{
                  background: dot.bg,
                  border: `1px solid ${isCurrent ? '#79c0ff' : dot.border}`,
                  boxShadow: isCurrent ? '0 0 0 2px rgba(121,192,255,0.2)' : 'none',
                  color: dot.color,
                }}
                title={`unit #${u.ord} — ${u.stage} — ${dot.label}`}
              >
                <span className="text-[10px] font-semibold" style={{ color: 'rgba(230,237,243,0.7)' }}>#{u.ord}</span>
                <span className="text-[9px] font-medium uppercase" style={{ color: stageColor }}>{u.stage}</span>
                <span className="text-[9px]">{dot.label}</span>
              </div>
              {(gate || human) && (
                <span
                  data-testid="ladder-gate"
                  className="text-xs"
                  style={{ color: gateDenied ? '#f85149' : gate ? '#3fb950' : 'rgba(230,237,243,0.3)' }}
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
