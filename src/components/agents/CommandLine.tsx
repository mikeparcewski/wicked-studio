import { useEffect, useRef, useState } from 'react';
import type { CopyCommand } from '../../board/agentsCopy.js';

/** One command with Copy (DES-seats-page §4.4): the Agents modal's fix steps, the setup steps and the Skills page. */
export function Command({ c }: { c: CopyCommand }): React.ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current !== null) clearTimeout(timer.current); }; }, []);
  const copy = (): void => {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    const flash = (s: 'copied' | 'failed'): void => {
      if (!mounted.current) return;
      setState(s);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2000);
    };
    if (clip === undefined || typeof clip.writeText !== 'function') { flash('failed'); return; }
    clip.writeText(c.line).then(() => flash('copied'), () => flash('failed'));
  };
  // One line that scrolls sideways (codex r9 WRAP): a command never breaks mid-path or mid-flag (§8),
  // and the characters stay the real ones, so a hand-selected copy still runs.
  return (
    <div className="wk-agents-cmd">
      <code data-testid="agents-command">{c.display}</code>
      <button type="button" data-testid="agents-copy" data-command-kind={c.label} data-state={state} onClick={copy}
        aria-label={state === 'copied' ? `Copied the ${c.label} command` : state === 'failed' ? `Couldn’t copy the ${c.label} command` : `Copy the ${c.label} command`} className="wk-btn wk-btn--secondary wk-agents-copy">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
    </div>
  );
}
