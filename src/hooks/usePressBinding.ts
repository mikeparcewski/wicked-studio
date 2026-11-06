import { useCallback, useRef, useState } from 'react';

/**
 * A PRESS COUNTS ONLY FOR WHAT IT BEGAN ON (DES-CATALOG-002 §2.7.3 rule 6, kept by rev 7 §2.8.1). Each reply names
 * the target it answers (a proposal pid, a plan's `run:ord:planRev`, an offer). At pointer-down or key-down the target
 * is captured; if it changed before the press completes, nothing is sent and the passage says so, with no time limit.
 * A reply whose target changed while it had focus or the pointer is DISARMED until a fresh focus or pointer entry, so
 * Enter on a button that kept focus through a re-plan never approves the new plan. The server still decides (409s).
 */
export interface PressNote { replyId: string; text: string }

export function usePressBinding(): {
  /** The props a reply button spreads. `target` is the reply's target in THIS render; `changed` words the disarm. */
  bind: (replyId: string, target: string, act: () => void, changed: string) => React.ButtonHTMLAttributes<HTMLButtonElement>;
  note: PressNote | null;
  clearNote: () => void;
} {
  const latest = useRef(new Map<string, string>());
  const armed = useRef(new Map<string, string>());
  const down = useRef(new Map<string, string>());
  const [note, setNote] = useState<PressNote | null>(null);
  const clearNote = useCallback(() => setNote(null), []);
  const bind = (replyId: string, target: string, act: () => void, changed: string): React.ButtonHTMLAttributes<HTMLButtonElement> => {
    latest.current.set(replyId, target);
    const arm = (): void => { armed.current.set(replyId, latest.current.get(replyId) ?? target); };
    return {
      onFocus: arm,
      onPointerEnter: arm,
      onPointerDown: () => { down.current.set(replyId, latest.current.get(replyId) ?? target); },
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') down.current.set(replyId, latest.current.get(replyId) ?? target);
      },
      onClick: () => {
        const now = latest.current.get(replyId) ?? null;
        const began = down.current.get(replyId);
        down.current.delete(replyId);
        const was = armed.current.get(replyId);
        if (now === null) return;
        if (began !== undefined && began !== now) {
          setNote({ replyId, text: 'The job changed while you pressed. Nothing was sent.' });
          return;
        }
        if (was !== undefined && was !== now) {
          setNote({ replyId, text: `${changed} Nothing was sent.` });
          return;
        }
        setNote(null);
        act();
      },
    };
  };
  return { bind, note, clearNote };
}
