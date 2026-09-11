import { useEffect, useRef, useState } from 'react';

/**
 * A real button that puts a command on the clipboard — the keyboard-reachable half of a "copyable"
 * `<code>` (F-255-06). A `user-select: all` span is a mouse affordance only: not focusable, no
 * action, no accessible name. This is the same clipboard pattern as the rail's file-path copy
 * (`RightPanel`: `navigator.clipboard.writeText` + a transient "copied"); where the clipboard API is
 * unavailable (an insecure origin, an old embedder) the label says "copy failed" instead of
 * pretending. Accessible name: `copy <command>` — the visible label stays one word.
 */
export function CopyButton({ command }: { command: string }): React.ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  function flash(next: 'copied' | 'failed'): void {
    setState(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState('idle');
      timer.current = null;
    }, 2000);
  }

  function onCopy(): void {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clip === undefined || typeof clip.writeText !== 'function') {
      flash('failed');
      return;
    }
    clip
      .writeText(command)
      .then(() => flash('copied'))
      .catch(() => flash('failed'));
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`copy ${command}`}
      title={`copy ${command} to the clipboard`}
      data-testid="copy-command"
      data-command={command}
      data-state={state}
      className="px-1.5 rounded text-[10px] font-mono font-semibold align-baseline"
      style={{
        background: 'var(--surface-raised)',
        color: state === 'failed' ? 'var(--status-fail)' : 'var(--ink-muted)',
        border: '1px solid var(--surface-rail)',
        cursor: 'pointer',
      }}
    >
      {state === 'copied' ? 'copied' : state === 'failed' ? 'copy failed' : 'copy'}
    </button>
  );
}
