import { useEffect, useRef } from 'react';
import { refreshGate } from '../board/gateActions.js';
import type { GateAction } from '../board/gateContract.js';
import { gateInstance } from '../board/proposalCard.js';
import type { OpenGate } from '../store/gates.js';
import { useCapabilities } from '../store/capabilities.js';

/**
 * (studio#1170, api-types 0.211.0) EVERY answer a run's open gate takes now, off the gate itself (from a daemon whose
 * `capabilities.gateActions` says it serves them). A gate built from
 * `GET /runs/:id/gate` carries the read's list (`actionsRead`; no list = a daemon without it). A gate a live
 * `awaitingHuman` frame opened (which never carries the list) is read ONCE, through the store's own read
 * (`refreshGate`): the whole gate is replaced by what the daemon says now, so a list is never attached to a gate it
 * was not read for. `refresh` (when it changes, while this gate is open) reads it again: what makes the list stale —
 * a QE acceptance that passed, a seat signed in — is not a new gate. `undefined` = no list: keep the card's resolver.
 */
export function useGateActions(runId: string, gate: OpenGate | undefined, refresh = ''): readonly GateAction[] | undefined {
  const instance = gateInstance(gate);
  // Only a daemon that serves the list (`capabilities.gateActions`) is asked for it.
  const served = useCapabilities((c) => c.gateActions);
  const needsRead = served && gate !== undefined && gate.actions === undefined && gate.actionsRead !== true;
  useEffect(() => {
    if (needsRead) void refreshGate(runId);
  }, [runId, instance, needsRead]);
  // A change of what the list depends on, after the first render of this gate: read it again.
  const seen = useRef<{ instance: string | null; refresh: string } | null>(null);
  useEffect(() => {
    const prev = seen.current;
    seen.current = { instance, refresh };
    // Only a gate that HAS a list can hold a stale one (a daemon without it has nothing to re-read).
    if (gate?.actions === undefined || prev === null || prev.instance !== instance || prev.refresh === refresh) return;
    void refreshGate(runId);
  }, [runId, instance, refresh, gate]);
  return gate?.actions;
}
