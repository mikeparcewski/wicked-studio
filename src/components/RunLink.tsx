import type { SessionStatus, SessionView } from '../api/types.js';

interface Props {
  view: SessionView;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}

function statusColor(status: SessionStatus): string {
  switch (status) {
    case 'completed':      return '#3fb950';
    case 'failed':         return '#f85149';
    case 'cancelled':      return 'rgba(230,237,243,0.25)';
    case 'awaiting_human': return '#ffda19';
    default:               return '#79c0ff';
  }
}

const TITLE_MAX = 35;

export function RunLink({ view, selectedRunId, onSelect }: Props): React.ReactElement {
  const { session, units } = view;
  const isActive = selectedRunId === session.id;
  const title = session.problem.length > TITLE_MAX
    ? session.problem.slice(0, TITLE_MAX) + '…'
    : session.problem;
  const unitCount = units.length;
  const pulse = session.status === 'awaiting_human' || session.status === 'executing'
    || session.status === 'distributing' || session.status === 'planning';

  return (
    <button
      type="button"
      data-testid="run-link"
      data-run-id={session.id}
      data-status={session.status}
      onClick={() => onSelect(session.id)}
      className="w-full text-left px-3 py-2 rounded-md"
      style={{ background: isActive ? 'rgba(0,0,0,0.35)' : 'transparent' }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.2)'; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-1 truncate text-xs leading-tight font-mono"
          style={{ color: isActive ? '#e6edf3' : 'rgba(230,237,243,0.7)' }}
          title={session.problem}
        >
          {title}
        </span>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${pulse ? 'animate-pulse' : ''}`}
          style={{ background: statusColor(session.status) }}
        />
      </div>
      <p className="text-[10px] mt-0.5 font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
        {unitCount} task{unitCount === 1 ? '' : 's'} · {session.id.slice(0, 8)}
      </p>
    </button>
  );
}
