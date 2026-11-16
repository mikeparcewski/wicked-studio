import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { gateActionsOf, type GateAction } from '../board/gateContract.js';
import { gateInstance } from '../board/proposalCard.js';
import type { OpenGate } from '../store/gates.js';

/**
 * (studio#1170, api-types 0.211.0) EVERY answer a run's open gate takes now. A gate that came from `GET /runs/:id/gate`
 * carries the list (`gateFromInfo`), and a read that carried none is a daemon without it: no second read. A gate opened by
 * a live `awaitingHuman` frame (which never carries the list) is read ONCE for it. `undefined` until read, for another
 * gate, on a failed read, and from a daemon that sends none: the card then keeps its own resolver.
 */
export function useGateActions(runId: string, gate: OpenGate | undefined): readonly GateAction[] | undefined {
  const instance = gateInstance(gate);
  const known = gate?.actions;
  const needsRead = gate !== undefined && known === undefined && gate.fromRead !== true;
  const ord = gate?.ord;
  const key = `${runId}:${instance ?? ''}`;
  const [read, setRead] = useState<{ key: string; actions: GateAction[] | undefined } | null>(null);
  useEffect(() => {
    if (!needsRead) return undefined;
    let live = true;
    api.getGate(runId).then(
      (info) => { if (live) setRead({ key, actions: (info as { ord?: unknown }).ord === ord ? gateActionsOf(info) : undefined }); },
      () => { if (live) setRead({ key, actions: undefined }); },
    );
    return () => { live = false; };
  }, [runId, ord, key, needsRead]);
  if (known !== undefined) return known;
  return read?.key === key ? read.actions : undefined;
}
