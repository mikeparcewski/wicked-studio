import { useEffect, useState } from 'react';
import {
  CLOSE_NOTE,
  undoDecision,
  undoHeadline,
  useUndoQueue,
} from '../board/undoQueue.js';

/** One toast, ready to render: every string is decided here, never in the skin. */
export interface UndoToastView {
  id: number;
  verb: 'approve' | 'reject';
  /** "Approving in 10 s" — counts down while the window is open. */
  headline: string;
  /** What will happen when it sends. */
  preview: string;
  /** The page-close contract. */
  closeNote: string;
  undo: () => void;
}

/** The queued decisions as toasts, re-read on a short tick so the countdown moves. */
export function useUndoToasts(): UndoToastView[] {
  const pending = useUndoQueue((s) => s.pending);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (pending.length === 0) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [pending]);
  return pending.map((p) => ({
    id: p.id,
    verb: p.verb,
    headline: undoHeadline(p, Math.min(now, p.dueAt)),
    preview: p.preview,
    closeNote: CLOSE_NOTE,
    undo: () => undoDecision(p.id),
  }));
}
