import { useMemo } from 'react';
import type { SystemAttention } from '../api/system.js';
import type { SessionView } from '../api/types.js';
import { runBenchesOf } from '../components/gateVerdictModel.js';
import { GENERIC_GATE_QUESTION, gateCause, gateQuestion, gateWithLogChoices, openGateFromEvents, runPoolOf } from '../board/gateHeadline.js';
import { sessionGateChoices } from '../board/gateRowModel.js';
import { useGateStore } from '../store/gates.js';
import { useRoster } from './useRoster.js';
import { useRunEventsFor } from './useRunEvents.js';

/** The run an attention item's gate is on, when it opens one. */
function gateRunOf(a: SystemAttention): string | null {
  if (a.action?.kind === 'open-gate' && a.action.target !== '') return a.action.target;
  return a.action?.kind === 'open-gate' ? a.runId ?? null : null;
}

/**
 * The plain-cause headline of each attention item that opens a gate (`a.id` → the dock's question, or absent while
 * its run's log is unread, the gate is gone, or the gate says nothing more than "waiting on your answer"). Reads
 * the same facts the dock reads (the run, its log, its open gate, the roster) through the one source,
 * `board/gateHeadline.ts`, so a row and the dock never word one decision two ways.
 */
export function useRowHeadlines(items: readonly SystemAttention[], runs: readonly SessionView[]): ReadonlyMap<string, string> {
  const roster = useRoster();
  const gates = useGateStore((s) => s.gates);
  const ids = useMemo(() => items.map(gateRunOf).filter((id): id is string => id !== null), [items]);
  const byRun = useRunEventsFor(ids);
  return useMemo(() => {
    const out = new Map<string, string>();
    const views = new Map(runs.map((v) => [v.session.id, v]));
    for (const a of items) {
      const runId = gateRunOf(a);
      if (runId === null) continue;
      const view = views.get(runId);
      const events = byRun[runId];
      if (view === undefined || events === undefined) continue;
      const ord = a.action?.ord ?? null;
      const live = gates[runId];
      const open = live !== undefined && (ord === null || live.ord === ord) ? live : openGateFromEvents(runId, events, ord);
      if (open === null) continue;
      const gate = gateWithLogChoices(open, events);
      const pool = runPoolOf(view);
      const benched = runBenchesOf(view.session);
      const model = sessionGateChoices({ runId, gate, units: view.units, events, pool, roster, benched });
      const q = gateQuestion(model, gateCause({ view, gate, events, model, roster, pool, benched }).headline, gate);
      if (q !== GENERIC_GATE_QUESTION && q.trim() !== '') out.set(a.id, q);
    }
    return out;
  }, [items, runs, byRun, gates, roster]);
}
