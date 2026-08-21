import { useSteeringStore, type SteeringAction } from '../store/steering.js';

interface Props {
  runId: string;
}

const ACTION_STYLE: Record<SteeringAction, { label: string; color: string }> = {
  approve:            { label: 'Approved',          color: 'var(--status-run)' },
  'approve-with-steer':{ label: 'Approved + steered',color: 'var(--status-gate)' },
  reject:             { label: 'Rejected',           color: 'var(--status-fail)' },
  cancel:             { label: 'Cancelled run',      color: 'var(--ink-muted)' },
};

export function SteeringTimeline({ runId }: Props): React.ReactElement {
  const entries = useSteeringStore((s) => s.entries).filter((e) => e.runId === runId);

  if (entries.length === 0) {
    return (
      <p data-testid="steering-timeline" className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
        No interventions recorded this session. Operator gate actions (approve / reject /
        amend) appear here as they happen.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="steering-scope-note" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
        Client-recorded, this session only — daemon keeps no per-action history, cleared on reload.
      </p>
      <ol data-testid="steering-timeline" className="flex flex-col gap-2">
        {entries.map((e) => {
          const s = ACTION_STYLE[e.action];
          return (
            <li
              key={e.seq}
              data-testid="steering-entry"
              className="rounded p-2 text-[11px]"
              style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold font-mono" style={{ color: s.color }}>{s.label}</span>
                <span className="font-mono" style={{ color: 'var(--ink-dim)' }}>
                  {typeof e.ord === 'number' ? `before unit #${e.ord}` : '—'}
                </span>
              </div>
              {e.amend && (
                <p
                  className="mt-1 whitespace-pre-wrap rounded p-1.5 font-mono"
                  style={{ background: 'var(--surface-rail)', color: 'var(--ink-muted)' }}
                >
                  <span className="font-medium" style={{ color: 'var(--ink-high)' }}>amended instruction:</span> {e.amend}
                </p>
              )}
              <p className="mt-1 text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                effect: {e.action === 'approve-with-steer'
                  ? 'steers the next unit'
                  : e.action === 'approve'
                    ? 'run advances'
                    : e.action === 'reject'
                      ? 'run rejected'
                      : 'run cancelled'}{' '}
                — as recorded
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
