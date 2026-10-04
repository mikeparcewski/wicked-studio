import { useEffect } from 'react';
import type { RunAcceptanceView, SessionView } from '../api/types.js';
import type { ChainModel } from '../board/chainModel.js';
import { overrideRemovedWalkthrough } from '../board/checkState.js';
import { isDeliverGate } from '../components/gateMoveModel.js';
import type { OpenGate } from '../store/gates.js';
import { useRunAcceptanceStore } from '../store/runAcceptance.js';

/**
 * The acceptance read a session's run block needs (WT-U2): `GET /runs/:id/acceptance`, read when
 * the run's plan names a walkthrough step (the chips) or its open gate is the hand-over (the deliver
 * card's line), and again whenever the run moves — the per-step `checkState` is computed by crew at
 * every read, never stored. A run with neither is never read: no fan-out on a list, no read for a
 * plan that proves nothing. `null` = the read failed, nothing is drawn.
 */
export function useRunAcceptance(view: SessionView, chain: ChainModel, gate: OpenGate | undefined): RunAcceptanceView | null {
  const id = view.session.id;
  const walkthrough = chain.steps.some((s) => s.catalog === 'walkthrough_review' && s.state !== 'struck' && s.state !== 'replaced');
  const deliver = gate !== undefined && isDeliverGate(id, view.units, gate.ord);
  // The pair removed by the accepted plan's override (WT §4.9): crew's read is the only place
  // "end-to-end testing is yours" comes from, so it is asked for although no step names a walkthrough.
  const wants = walkthrough || deliver || overrideRemovedWalkthrough(view.session);
  const moved = `${view.session.status}:${view.session.unit_ix}:${gate?.ord ?? ''}:${gate?.receivedAt ?? ''}`;
  useEffect(() => {
    if (wants) void useRunAcceptanceStore.getState().read(id);
  }, [id, wants, moved]);
  return useRunAcceptanceStore((s) => s.byRun[id] ?? null);
}
