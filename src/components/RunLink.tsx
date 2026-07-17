import type { SessionStatus, SessionView } from '../api/types.js';

interface Props {
  view: SessionView;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}

function StatusDot({ status }: { status: SessionStatus }): React.ReactElement {
  if (status === 'completed') {
    return <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />;
  }
  if (status === 'failed') {
    return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />;
  }
  if (status === 'cancelled') {
    return <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" />;
  }
  if (status === 'awaiting_human') {
    return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  }
  // executing / distributing / planning
  return <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />;
}

const TITLE_MAX = 35;

export function RunLink({ view, selectedRunId, onSelect }: Props): React.ReactElement {
  const { session, units } = view;
  const isActive = selectedRunId === session.id;
  const title = session.problem.length > TITLE_MAX
    ? session.problem.slice(0, TITLE_MAX) + '\u2026'
    : session.problem;
  const unitCount = units.length;

  return (
    <button
      type="button"
      data-testid="run-link"
      data-run-id={session.id}
      data-status={session.status}
      onClick={() => onSelect(session.id)}
      className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
        isActive ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-1 truncate text-xs text-zinc-200 leading-tight"
          title={session.problem}
        >
          {title}
        </span>
        <StatusDot status={session.status} />
      </div>
      <p className="text-[10px] text-zinc-500 mt-0.5">
        {unitCount} task{unitCount === 1 ? '' : 's'} \u00b7 {session.id.slice(0, 8)}
      </p>
    </button>
  );
}
