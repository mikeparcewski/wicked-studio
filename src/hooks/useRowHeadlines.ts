import { useEffect, useMemo } from 'react';
import type { SystemAttention } from '../api/system.js';
import type { SessionView } from '../api/types.js';
import { runBenchesOf } from '../components/gateVerdictModel.js';
import { GENERIC_GATE_QUESTION, deliverRowHeadline, gateCause, gateQuestion, gateWithLogChoices, openGateFromEvents, runPoolOf } from '../board/gateHeadline.js';
import { isDeliverGate } from '../components/gateMoveModel.js';
import { useRunAcceptanceStore } from '../store/runAcceptance.js';
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
  // A hand-over row says what the dock says: QE refused it, when it did — read off the run's acceptance, fetched the
  // way the dock's card fetches it (`GET /runs/:id/acceptance`, one read per run) when no surface has read it yet.
  const acceptance = useRunAcceptanceStore((s) => s.byRun);
  const { out, unread } = useMemo(() => {
    const out = new Map<string, string>();
    const unread: string[] = [];
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
      if (gate.gateKind === 'deliver' || isDeliverGate(runId, view.units, gate.ord)) {
        if (!(runId in acceptance)) unread.push(runId);
        const refused = deliverRowHeadline(view, gate, events, acceptance[runId]?.summary);
        if (refused !== null) { out.set(a.id, refused); continue; }
      }
      const pool = runPoolOf(view);
      const benched = runBenchesOf(view.session);
      const model = sessionGateChoices({ runId, gate, units: view.units, events, pool, roster, benched });
      const q = gateQuestion(model, gateCause({ view, gate, events, model, roster, pool, benched }).headline, gate);
      if (q !== GENERIC_GATE_QUESTION && q.trim() !== '') out.set(a.id, q);
    }
    return { out, unread };
  }, [items, runs, byRun, gates, roster, acceptance]);
  const unreadKey = unread.join(',');
  useEffect(() => {
    if (unreadKey === '') return;
    for (const id of unreadKey.split(',')) void useRunAcceptanceStore.getState().read(id);
  }, [unreadKey]);
  return out;
}
