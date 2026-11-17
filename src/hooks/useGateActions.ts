import { useEffect } from 'react';
import { refreshGate } from '../board/gateActions.js';
import type { GateAction } from '../board/gateContract.js';
import type { OpenGate } from '../store/gates.js';
import { useCapabilities } from '../store/capabilities.js';

/**
 * Per run: what its newest list read began under — the gate's ord and the card's `refresh` key. Module-level, so a card
 * that mounts again (navigation) knows whether the cached list predates what it depends on now.
 */
const readUnder = new Map<string, { ord: number; refresh: string; live: number | null }>();
/** Tests: forget every read. */
export function resetGateActionReadsForTest(): void {
  readUnder.clear();
}

/**
 * (studio#1170, api-types 0.211.0) EVERY answer a run's open gate takes now, off the gate itself, from a daemon whose
 * `capabilities.gateActions` says it serves them. Reads go through the store's own gate read (`refreshGate`): the whole
 * gate is replaced by what the daemon says now, so a list is never attached to a gate it was not read for.
 *
 * A read gate carries its list (`actionsRead`; none = a daemon without it: never read again). A gate a live frame
 * opened carries none and is read. A list is read again whenever `refresh` (what makes it stale without a new gate: a
 * QE acceptance that passed, a seat signed in) differs from the key its newest read began under — on a change while
 * mounted, on a mount after one, and when the key moved while a read was on its way (the newer read wins).
 * `undefined` = no list: the card keeps its own resolver.
 */
export function useGateActions(runId: string, gate: OpenGate | undefined, refresh = ''): readonly GateAction[] | undefined {
  const served = useCapabilities((c) => c.gateActions);
  const ord = gate?.ord;
  const hasList = gate?.actions !== undefined;
  const noList = gate !== undefined && !hasList && gate.actionsRead === true;
  // A gate a live frame opened is told apart from the next one at the same ord by its arrival.
  const live = gate !== undefined && !hasList && gate.actionsRead !== true ? gate.receivedAt : null;
  useEffect(() => {
    if (!served || ord === undefined || noList) return;
    const began = readUnder.get(runId);
    const same = began !== undefined && began.ord === ord && began.refresh === refresh;
    if (live !== null) {
      // This live gate's read (under this key) is on its way, or done: nothing to do.
      if (same && began.live === live) return;
    } else if (same) {
      return; // the list was read under this key
    } else if (began === undefined) {
      // A list some other read brought (a page load, the runs poller) is current for the key it is first shown under.
      readUnder.set(runId, { ord, refresh, live: null });
      return;
    }
    readUnder.set(runId, { ord, refresh, live });
    void refreshGate(runId);
  }, [runId, ord, refresh, served, noList, live]);
  return gate?.actions;
}
