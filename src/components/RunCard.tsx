import type { SessionStatus, SessionView } from '../api/types.js';
import { edgeStateOf, LiveEdge } from './LiveEdge.js';
import { humanTitle } from './runIdentity.js';

// Status metadata — colors speak the §2.6 status layer
export const STATUS_STYLE: Record<SessionStatus, { label: string; color: string }> = {
  planning:       { label: 'Planning',        color: 'var(--ink-muted)' },
  distributing:   { label: 'Distributing',    color: 'var(--status-run)' },
  executing:      { label: 'Executing',        color: 'var(--status-run)' },
  awaiting_human: { label: 'Awaiting human',  color: 'var(--status-gate)' },
  completed:      { label: 'Completed',        color: 'var(--status-done)' },
  cancelled:      { label: 'Cancelled',        color: 'var(--ink-dim)' },
  failed:         { label: 'Failed',           color: 'var(--status-fail)' },
};

interface Props {
  view: SessionView;
  selected: boolean;
  onSelect: (runId: string) => void;
}

export function RunCard({ view, selected, onSelect }: Props): React.ReactElement {
  const { session, units } = view;
  const style = STATUS_STYLE[session.status] ?? { label: session.status, color: 'var(--ink-dim)' };
  const awaiting = session.status === 'awaiting_human';

  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      data-testid="run-card"
      data-run-id={session.id}
      data-status={session.status}
      aria-pressed={selected}
      className="w-full text-left rounded-lg p-4 transition relative overflow-hidden"
      style={{
        background: selected ? 'var(--surface-card)' : 'var(--surface-rail)',
        border: selected
          ? '1px solid var(--accent-dim)'
          : '1px solid var(--surface-raised)',
        boxShadow: selected ? '0 0 0 1px var(--accent-subtle)' : 'none',
      }}
    >
      {/* Same treatment as the board card, so a run reads identically on both surfaces. */}
      <LiveEdge state={edgeStateOf([session.status])} />
      <div className="flex justify-between items-start gap-2 mb-1">
        <p
          className="font-semibold text-sm line-clamp-2 flex-1 font-mono"
          style={{ color: 'var(--ink-high)' }}
          title={session.problem}
        >
          {/* Review #2: the human title leads; the raw prompt is hover-only. */}
          {humanTitle(session.problem)}
        </p>
        {awaiting && (
          <span
            data-testid="run-card-gate-flag"
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold font-mono animate-pulse"
            style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)', border: '1px solid var(--status-gate-dim)' }}
          >
            gate
          </span>
        )}
      </div>
      <div className="flex justify-between items-center">
        <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>{session.id.slice(0, 8)}</p>
        <span className="text-xs font-medium font-mono" style={{ color: style.color }}>{style.label}</span>
      </div>
      <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--ink-dim)' }}>
        {units.length} unit{units.length === 1 ? '' : 's'}
      </p>
    </button>
  );
}
