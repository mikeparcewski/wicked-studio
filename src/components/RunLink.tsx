import type { SessionStatus, SessionView } from '../api/types.js';
import { MODE_SPECS } from './ModeSwitcher.js';

interface Props {
  view: SessionView;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}

function statusColor(status: SessionStatus): string {
  switch (status) {
    case 'completed':      return 'var(--status-done)';
    case 'failed':         return 'var(--status-fail)';
    case 'cancelled':      return 'var(--ink-dim)';
    case 'awaiting_human': return 'var(--status-gate)';
    default:               return 'var(--status-run)';
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
  // A run item names its MODE (DES-UXFIX-001 §1 spine, slice 3 — the F4 fix for
  // "visually identical truncated work items"): `workflow_id` stays internal
  // (V5) — what the user reads is the spine word + glyph, Chat or Build.
  const kind = !session.workflow_id || session.workflow_id === 'chat' ? 'chat' : 'build';
  const spec = MODE_SPECS[kind];

  return (
    <button
      type="button"
      data-testid="run-link"
      data-run-id={session.id}
      data-status={session.status}
      data-kind={kind}
      onClick={() => onSelect(session.id)}
      className={`w-full text-left px-3 py-2 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${
        isActive ? 'bg-black/35' : 'bg-transparent hover:bg-black/20 focus-visible:bg-black/20'
      }`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="shrink-0 text-[11px]" title={spec.label}>
          {spec.glyph}
        </span>
        <span
          className="flex-1 truncate text-xs leading-tight font-mono"
          style={{ color: isActive ? 'var(--ink-high)' : 'var(--ink-muted)' }}
          title={session.problem}
        >
          {title}
        </span>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${pulse ? 'animate-pulse' : ''}`}
          style={{ background: statusColor(session.status) }}
        />
      </div>
      <p className="text-[10px] mt-0.5 font-mono" style={{ color: 'var(--ink-dim)' }}>
        {spec.label} · {unitCount} task{unitCount === 1 ? '' : 's'} · {session.id.slice(0, 8)}
      </p>
    </button>
  );
}
