import { useSteeringStore, type SteeringAction } from '../store/steering.js';

interface Props {
  runId: string;
}

const ACTION_STYLE: Record<SteeringAction, { label: string; color: string }> = {
  approve:            { label: 'Approved',          color: '#3fb950' },
  'approve-with-steer':{ label: 'Approved + steered',color: '#ffda19' },
  reject:             { label: 'Rejected',           color: '#f85149' },
  cancel:             { label: 'Cancelled run',      color: 'rgba(230,237,243,0.5)' },
};

export function SteeringTimeline({ runId }: Props): React.ReactElement {
  const entries = useSteeringStore((s) => s.entries).filter((e) => e.runId === runId);

  if (entries.length === 0) {
    return (
      <p data-testid="steering-timeline" className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
        No interventions recorded this session. Operator gate actions (approve / reject /
        amend) appear here as they happen.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="steering-scope-note" className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
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
              style={{ background: '#161c26', border: '1px solid rgba(230,237,243,0.07)' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold font-mono" style={{ color: s.color }}>{s.label}</span>
                <span className="font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
                  {typeof e.ord === 'number' ? `before unit #${e.ord}` : '—'}
                </span>
              </div>
              {e.amend && (
                <p
                  className="mt-1 whitespace-pre-wrap rounded p-1.5 font-mono"
                  style={{ background: '#0f1419', color: 'rgba(230,237,243,0.6)' }}
                >
                  <span className="font-medium" style={{ color: '#e6edf3' }}>amended instruction:</span> {e.amend}
                </p>
              )}
              <p className="mt-1 text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
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
