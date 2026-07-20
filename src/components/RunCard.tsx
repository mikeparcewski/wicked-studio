import type { SessionStatus, SessionView } from '../api/types.js';

// Status metadata — className uses wicked semantic colors
export const STATUS_STYLE: Record<SessionStatus, { label: string; className: string; color: string }> = {
  planning:       { label: 'Planning',        className: 'text-wk-muted',   color: 'rgba(230,237,243,0.55)' },
  distributing:   { label: 'Distributing',    className: 'text-wk-link',    color: '#79c0ff' },
  executing:      { label: 'Executing',        className: 'text-wk-link',    color: '#79c0ff' },
  awaiting_human: { label: 'Awaiting human',  className: 'text-wk-accent',  color: '#ffda19' },
  completed:      { label: 'Completed',        className: 'text-wk-ok',      color: '#3fb950' },
  cancelled:      { label: 'Cancelled',        className: 'text-wk-muted',   color: 'rgba(230,237,243,0.4)' },
  failed:         { label: 'Failed',           className: 'text-wk-deny',    color: '#f85149' },
};

interface Props {
  view: SessionView;
  selected: boolean;
  onSelect: (runId: string) => void;
}

export function RunCard({ view, selected, onSelect }: Props): React.ReactElement {
  const { session, units } = view;
  const style = STATUS_STYLE[session.status] ?? { label: session.status, className: '', color: 'rgba(230,237,243,0.4)' };
  const awaiting = session.status === 'awaiting_human';

  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      data-testid="run-card"
      data-run-id={session.id}
      data-status={session.status}
      aria-pressed={selected}
      className="w-full text-left rounded-lg p-4 transition"
      style={{
        background: selected ? '#1b222e' : '#161c26',
        border: selected
          ? '1px solid rgba(121,192,255,0.25)'
          : '1px solid rgba(230,237,243,0.08)',
        boxShadow: selected ? '0 0 0 1px rgba(121,192,255,0.1)' : 'none',
      }}
    >
      <div className="flex justify-between items-start gap-2 mb-1">
        <p className="font-semibold text-sm line-clamp-2 flex-1 font-mono" style={{ color: '#e6edf3' }}>
          {session.problem}
        </p>
        {awaiting && (
          <span
            data-testid="run-card-gate-flag"
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold font-mono animate-pulse"
            style={{ background: 'rgba(255,218,25,0.15)', color: '#ffda19', border: '1px solid rgba(255,218,25,0.3)' }}
          >
            gate
          </span>
        )}
      </div>
      <div className="flex justify-between items-center">
        <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>{session.id.slice(0, 8)}</p>
        <span className="text-xs font-medium font-mono" style={{ color: style.color }}>{style.label}</span>
      </div>
      <p className="text-[11px] mt-1 font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
        {units.length} unit{units.length === 1 ? '' : 's'}
      </p>
    </button>
  );
}
