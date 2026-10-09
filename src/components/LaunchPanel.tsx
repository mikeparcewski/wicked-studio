import { useState } from 'react';
import { ChatInput } from './ChatInput.js';
import type { RunMode } from './runMode.js';
import { MODE_LABELS } from './runMode.js';

export type { RunMode } from './runMode.js';

/**
 * THE LAUNCH FORM (`/runs/new`, `/p/:projectId/build/new`) — what ChatPanel kept after the run page
 * retired (S16a-3): a run lives in its session thread now (`/s/run%3A<id>`), so this surface only
 * starts one. The run mode is chosen here, before launch; a mid-run change of pace is a message in
 * the session composer (the run page's mode pill was not carried, S16a-1d).
 */

function ModePill({
  mode,
  onChange,
  readOnly = false,
}: {
  mode: RunMode;
  onChange: (m: RunMode) => void;
  readOnly?: boolean;
}): React.ReactElement {
  const modes: RunMode[] = ['ask', 'balanced', 'autonomous'];

  function handleKey(e: React.KeyboardEvent, idx: number): void {
    if (readOnly) return;
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = (idx + 1) % modes.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (idx - 1 + modes.length) % modes.length;
    } else {
      return;
    }
    e.preventDefault();
    onChange(modes[next]!);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Run mode"
      aria-disabled={readOnly || undefined}
      title={readOnly ? 'Run mode (read-only — run is complete)' : undefined}
      className="flex items-center rounded-lg overflow-hidden shrink-0"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--surface-overlay)',
        opacity: readOnly ? 0.6 : 1,
      }}
    >
      {modes.map((m, idx) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-disabled={readOnly}
          tabIndex={readOnly ? -1 : mode === m ? 0 : -1}
          onClick={readOnly ? undefined : () => onChange(m)}
          onKeyDown={readOnly ? undefined : (e) => handleKey(e, idx)}
          disabled={readOnly}
          className="px-3 py-1 text-[11px] font-mono font-medium transition-colors disabled:cursor-default"
          // The selected segment is an interactive selection → the accent
          // (mirrors the mode switcher's active fill, §5.2/§2.5); never amber —
          // that's the gate's color.
          style={
            mode === m
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'transparent', color: 'var(--ink-dim)' }
          }
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

function NewRunView({
  chatMode,
  mode,
  onModeChange,
  onLaunched,
  navigate,
  launchProjectId = null,
}: {
  chatMode: boolean;
  mode: RunMode;
  onModeChange: (m: RunMode) => void;
  onLaunched: (id: string) => void;
  navigate?: (path: string) => void;
  launchProjectId?: string | null;
}): React.ReactElement {
  const heading = chatMode
    ? 'What do you want to explore?'
    : 'What do you need built?';
  const sub = chatMode
    ? 'Ask about your repos, get answers, run searches, analyse patterns — without kicking off a full build.'
    // D1: the team model in one line — the PA scores and plans, you approve the plan, the team works it.
    : 'Describe your goal. The PA scores and plans it, you approve the plan, and the team works it.';

  return (
    <div className="flex flex-col h-full items-center justify-center">
      <div className="w-full max-w-2xl px-8 flex flex-col gap-5">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="wk-page-title">
            {heading}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </p>
        </div>
        <div className="flex justify-center">
          <ModePill mode={mode} onChange={onModeChange} />
        </div>
        <ChatInput
          embedded
          mode={mode}
          onLaunched={onLaunched}
          lockedProjectId={launchProjectId}
          {...(chatMode ? { workflowOverride: 'chat' } : {})}
          {...(navigate !== undefined ? { navigate } : {})}
        />
      </div>
    </div>
  );
}

interface Props {
  chatMode?: boolean;
  onLaunched: (runId: string) => void;
  /** App-level route navigation — threaded to ChatInput's seat sign-in warning (→ /system). */
  navigate?: (path: string) => void;
  /**
   * §4.3 pre-bind (DES-FEEDBACK-001, slice B): non-null when the launch form was entered from
   * project context (`/p/:projectId/build/new`) — the ProjectSwitcher field pre-fills and LOCKS.
   */
  launchProjectId?: string | null;
}

export function LaunchPanel({ chatMode, onLaunched, navigate, launchProjectId = null }: Props): React.ReactElement {
  const [mode, setMode] = useState<RunMode>('balanced');
  return (
    <NewRunView
      chatMode={chatMode ?? false}
      mode={mode}
      onModeChange={setMode}
      onLaunched={onLaunched}
      launchProjectId={launchProjectId}
      {...(navigate !== undefined ? { navigate } : {})}
    />
  );
}
