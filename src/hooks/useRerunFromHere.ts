import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CoreEvent, SessionView } from '../api/types.js';
import { commitGateDecision } from '../board/gateActions.js';
import { rerunOffer, type RerunOffer } from '../components/rerunModel.js';
import { useRunEventStore } from '../store/events.js';
import { useGateStore } from '../store/gates.js';

const EMPTY: CoreEvent[] = [];

export type RerunState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; phase: string }
  | { kind: 'error'; message: string };

export interface RerunFromHere {
  /** The breadcrumb's one offer for the run's open gate, or `null`. */
  offer: RerunOffer | null;
  state: RerunState;
  /** Send the rewind through THE gate decision path (undo window, `ord`, 409 gate_changed). */
  rerun: () => Promise<void>;
}

/**
 * "Rerun from here" for a run page (brainstorm-actionable idea 6): the offer off the run's units,
 * its open gate (the gate store — the live frame, or `GET /runs/:id/gate` after a reload) and its
 * event log; the move is `commitGateDecision(runId, {approve:false, action:'request_changes'})`,
 * the same call the gate card's "Request changes" makes. State resets when the gate moves.
 */
export function useRerunFromHere(view: SessionView): RerunFromHere {
  const runId = view.session.id;
  const gate = useGateStore((s) => s.gates[runId]);
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY;
  const offer = useMemo(
    () => rerunOffer({
      runId,
      status: view.session.status,
      units: view.units,
      gateOrd: gate?.ord,
      prompt: gate?.prompt,
      gateKind: gate?.gateKind ?? null,
      events,
    }),
    [runId, view.session.status, view.units, gate?.ord, gate?.prompt, gate?.gateKind, events],
  );
  const [state, setState] = useState<RerunState>({ kind: 'idle' });
  // A NEW gate (another run, or the next gate opening) starts from nothing. The gate being cleared
  // by the decision itself does not: the "sent" line must survive the answer it reports.
  const gateOrd = gate?.ord;
  useEffect(() => setState({ kind: 'idle' }), [runId]);
  useEffect(() => {
    if (gateOrd !== undefined) setState({ kind: 'idle' });
  }, [gateOrd]);

  const rerun = useCallback(async () => {
    if (offer === null) return;
    setState({ kind: 'sending' });
    try {
      const outcome = await commitGateDecision(runId, offer.decision);
      setState(outcome === 'sent' ? { kind: 'sent', phase: offer.phase } : { kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [offer, runId]);

  return { offer, state, rerun };
}
