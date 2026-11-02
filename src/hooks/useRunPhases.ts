import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import { powerPhases, powerTimeline } from '../board/powerMode.js';
import { useRunEvents } from './useRunEvents.js';
import { usePower } from './usePower.js';
import type { RunPhase } from '../store/runPluginView.js';

const TERMINAL = ['completed', 'cancelled', 'failed'];
const NONE: readonly RunPhase[] = [];

/**
 * A power BUILD's phases (operator 2026-10-30: one phase report per phase), the one reading the thread and the Details
 * panel share: switched on, or an orchestrator already took turns. A phased run (or power off) has none.
 */
export function useRunPhases(view: SessionView): readonly RunPhase[] {
  const runEvents = useRunEvents(view.session.id).events;
  const power = usePower(view);
  return useMemo(() => {
    if (power === null) return NONE;
    const items = powerTimeline(runEvents, power);
    if (items.length === 0 || !(power.on || items.some((i) => i.kind === 'turn'))) return NONE;
    return powerPhases(view.units, power, runEvents, TERMINAL.includes(view.session.status));
  }, [power, runEvents, view.units, view.session.status]);
}
