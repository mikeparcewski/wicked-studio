import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import { markHeld } from '../board/heldRuns.js';
import { useHeldRuns } from '../store/heldRuns.js';

/**
 * (crew#1042) A surface that fetches its own runs marks them from the shared held set, the way App marks
 * the Desk's (studio#805): `isHeldRun` reads only the mark, so every verdict is a pure function of the
 * runs a surface renders. Subscribed: a hold appearing or clearing re-marks the runs and re-renders the
 * surface, and no fold keeps a stale verdict (a global read would, behind a memo).
 */
export function useHeldMarked(runs: SessionView[]): SessionView[] {
  const held = useHeldRuns((s) => s.held);
  return useMemo(() => markHeld(runs, held), [runs, held]);
}

/** {@link useHeldMarked} for one run: the run page's view, marked when a Needs-you row holds it. */
export function useHeldMarkedView(view: SessionView): SessionView {
  const held = useHeldRuns((s) => s.held.has(view.session.id));
  return useMemo(() => (held ? markHeld([view], new Set([view.session.id]))[0]! : view), [view, held]);
}
