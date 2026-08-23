import type { SessionStatus, SessionView } from '../api/types.js';
import { useMembershipStore } from '../store/membership.js';
import { MODE_SPECS } from './ModeSwitcher.js';
import { runTitle, runWhenWord, WHEN_TITLE } from './runIdentity.js';

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
  // §7.5 (slice Y2, EC40): the synthesized display title — truncated intent +
  // short-id + attempt ordinal — so identical prompts never render identical
  // rows. The short-id moves INTO the title; the meta line gains the attach
  // clock (the membership mirror — a store read, never a fetch).
  const title = runTitle(session, TITLE_MAX);
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun[session.id]);
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
      className={`w-full text-left px-3 py-2 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-dim ${
        isActive ? 'bg-surface-raised' : 'bg-transparent hover:bg-surface-card focus-visible:bg-surface-card'
      }`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="shrink-0 text-[11px]" title={spec.label}>
          {spec.glyph}
        </span>
        <span
          data-testid="run-title"
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
        {spec.label} · {unitCount} task{unitCount === 1 ? '' : 's'} ·{' '}
        <span data-testid="run-when" title={WHEN_TITLE}>{runWhenWord(attachedAt, Date.now())}</span>
      </p>
    </button>
  );
}
