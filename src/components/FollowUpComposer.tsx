import { useState } from 'react';
import type { AgentSession } from '../api/types.js';
import { ChatInput } from './ChatInput.js';

/**
 * The terminal-run composer (DES-RUN-NARRATOR §7; usability review 2026-08-31
 * finding #8): a finished run's footer used to wear the FULL launch composer —
 * "What do you need built?", gate chip, project switcher — with nothing saying
 * whether it steered THIS run or started a new one. Now a dead run's footer is
 * one honest line plus one labelled action; the launch form appears only after
 * the operator asks for it, under the label that says exactly what it does.
 */
export function FollowUpComposer({
  session,
  onLaunched,
  navigate,
}: {
  session: AgentSession;
  onLaunched: (runId: string) => void;
  navigate?: ((path: string) => void) | undefined;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const projectId = typeof session.project_id === 'string' ? session.project_id : null;
  const label = projectId !== null ? 'Start a follow-up run in this project' : 'Start a follow-up run';

  if (!open) {
    return (
      <div
        data-testid="followup-bar"
        className="px-5 py-3 shrink-0 flex items-center gap-3"
        style={{ borderTop: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
      >
        <p className="text-xs font-mono flex-1" style={{ color: 'var(--ink-dim)' }}>
          This run is finished — steering is closed.
        </p>
        <button
          type="button"
          data-testid="followup-open"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold font-mono transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-body)', border: '1px solid var(--surface-overlay)' }}
        >
          {label} →
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="followup-composer"
      className="px-5 py-3 shrink-0 flex flex-col gap-1"
      style={{ borderTop: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <p data-testid="followup-label" className="text-xs font-semibold font-mono flex-1" style={{ color: 'var(--ink-body)' }}>
          {label} — a NEW run, separate from this one
        </p>
        <button
          type="button"
          data-testid="followup-close"
          onClick={() => setOpen(false)}
          aria-label="Close the follow-up composer"
          className="shrink-0 text-xs font-mono opacity-60 hover:opacity-100"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
        >
          ✕
        </button>
      </div>
      <ChatInput
        embedded
        onLaunched={onLaunched}
        lockedProjectId={projectId}
        {...(navigate !== undefined ? { navigate } : {})}
      />
    </div>
  );
}
