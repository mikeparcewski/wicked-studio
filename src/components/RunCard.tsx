import type { SessionStatus, SessionView } from '../api/types.js';

/** The 7 core run statuses, with a distinct label + color each (§11.6). */
export const STATUS_STYLE: Record<SessionStatus, { label: string; className: string }> = {
  planning: { label: 'Planning', className: 'text-gray-500' },
  distributing: { label: 'Distributing', className: 'text-purple-600' },
  executing: { label: 'Executing', className: 'text-blue-600' },
  awaiting_human: { label: 'Awaiting human', className: 'text-yellow-600' },
  completed: { label: 'Completed', className: 'text-green-600' },
  cancelled: { label: 'Cancelled', className: 'text-gray-400' },
  failed: { label: 'Failed', className: 'text-red-600' },
};

interface Props {
  view: SessionView;
  selected: boolean;
  onSelect: (runId: string) => void;
}

export function RunCard({ view, selected, onSelect }: Props): React.ReactElement {
  const { session, units } = view;
  const style = STATUS_STYLE[session.status] ?? { label: session.status, className: 'text-gray-500' };
  const awaiting = session.status === 'awaiting_human';

  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      data-testid="run-card"
      data-run-id={session.id}
      data-status={session.status}
      aria-pressed={selected}
      className={`w-full text-left rounded-lg border p-4 bg-white shadow-sm transition ${
        selected ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex justify-between items-start gap-2 mb-1">
        <p className="font-semibold text-sm line-clamp-2 flex-1">{session.problem}</p>
        {awaiting && (
          <span
            data-testid="run-card-gate-flag"
            className="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-700"
          >
            gate
          </span>
        )}
      </div>
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-400 font-mono">{session.id.slice(0, 8)}</p>
        <span className={`text-xs font-medium ${style.className}`}>{style.label}</span>
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        {units.length} unit{units.length === 1 ? '' : 's'}
      </p>
    </button>
  );
}
