import { useSteeringStore, type SteeringAction } from '../store/steering.js';

interface Props {
  runId: string;
}

const ACTION_STYLE: Record<SteeringAction, { label: string; className: string }> = {
  approve: { label: 'Approved', className: 'text-green-700' },
  'approve-with-steer': { label: 'Approved + steered', className: 'text-amber-700' },
  reject: { label: 'Rejected', className: 'text-red-700' },
  cancel: { label: 'Cancelled run', className: 'text-gray-700' },
};

/**
 * FR-8b Steering timeline — each `AwaitingHuman` → `confirmGate` intervention the operator
 * took, in order, with the amended instruction shown. Sourced from the client-side steering
 * record (there is no engine event for the human's chosen action). The effect is labeled
 * **as recorded** — honest about its thinness (the operator's action, forward-only).
 */
export function SteeringTimeline({ runId }: Props): React.ReactElement {
  const entries = useSteeringStore((s) => s.entries).filter((e) => e.runId === runId);

  if (entries.length === 0) {
    return (
      <p data-testid="steering-timeline" className="text-xs text-gray-400">
        No interventions recorded this session. Operator gate actions (approve / reject /
        amend) appear here as they happen.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="steering-scope-note" className="text-[10px] text-gray-400">
        Client-recorded, this session only — cleared on reload. The daemon keeps no per-action
        gate history, so this list is forward-only from when this client connected.
      </p>
      <ol data-testid="steering-timeline" className="flex flex-col gap-2">
        {entries.map((e) => {
        const style = ACTION_STYLE[e.action];
        return (
          <li
            key={e.seq}
            data-testid="steering-entry"
            className="rounded border border-gray-200 p-2 text-[11px]"
          >
            <div className="flex items-center justify-between">
              <span className={`font-semibold ${style.className}`}>{style.label}</span>
              <span className="text-gray-400">
                {typeof e.ord === 'number' ? `before unit #${e.ord}` : '—'}
              </span>
            </div>
            {e.amend && (
              <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-1.5 text-gray-600">
                <span className="font-medium">amended instruction:</span> {e.amend}
              </p>
            )}
            <p className="mt-1 text-[10px] text-gray-400">
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
