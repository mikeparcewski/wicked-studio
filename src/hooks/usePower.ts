import { useMemo } from 'react';
import { create } from 'zustand';
import { powerOf, type PowerState } from '../api/power.js';
import type { SessionView } from '../api/types.js';
import { mergePower } from '../board/powerMode.js';
import { useCapabilities } from '../store/capabilities.js';
import { useRunEventStore } from '../store/events.js';

/** The answers to this page's own flips and raises (`POST /runs/:id/power|rigor` return the run's PowerView), by run:
 *  the header shows them before the next session read lands. */
export const usePowerLocal = create<{ byRun: Record<string, PowerState> }>(() => ({ byRun: {} }));

export function rememberPower(runId: string, p: PowerState): void {
  usePowerLocal.setState((s) => ({ byRun: { ...s.byRun, [runId]: p } }));
}

/**
 * A run's power-mode state as it stands now, or null when there is nothing to show: the daemon does not run power
 * mode (`capabilities.powerMode`), or the run has no power state (a phased run on an older engine).
 */
export function usePower(view: SessionView | null | undefined): PowerState | null {
  const cap = useCapabilities((s) => s.powerMode);
  const id = view?.session.id ?? '';
  const events = useRunEventStore((s) => s.byRun[id]);
  const local = usePowerLocal((s) => s.byRun[id]) ?? null;
  const session = view?.session;
  return useMemo(() => (cap && session !== undefined ? mergePower(powerOf(session), events, local) : null), [cap, session, events, local]);
}
