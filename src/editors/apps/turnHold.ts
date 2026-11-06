import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { CoreEvent, SessionView } from '../../api/types.js';
import { rulesHoldAt } from '../../board/assuranceModel.js';
import { useRunEventStore } from '../../store/events.js';
import { useGateStore, type OpenGate } from '../../store/gates.js';

/**
 * (F22) Whether an app turn's run is held on steering rules no judge ruled on ("the work was not rejected"): the ONE
 * reading the app page uses for the chat's gate, its busy line and the "Needs you" strip.
 *
 * Each gate the run opens is read against the run's RECORDED trail once (`GET /runs/:id/events`, merged into the shared
 * log), so the hold is this attempt's whatever the live buffer missed or kept on a reconnect; only then is it `held`.
 * Before that, the polled unit record may still say so (`heldNow`): that styles the step as waiting, never answers.
 * A failed read is tried again after 5 s. A framed studio answers nothing, so it reads nothing. Reads are shared by
 * gate instance (run, ord, receivedAt), so the chat and the strip ask once between them.
 */
export interface TurnHold {
  /** The run's open gate, when the gate store holds one. */
  gate: OpenGate | undefined;
  /** The run's shared event log (null: none read yet). */
  events: CoreEvent[] | null;
  /** The unit record or the log says the gate is a rules hold (styling only). */
  heldNow: boolean;
  /** This gate's recorded trail was read and it shows a rules hold: the chat answers it, the strip counts it. */
  held: boolean;
}

const RETRY_MS = 5000;
const reads = new Map<string, Promise<void>>();
const done = new Set<string>();

/** Tests: forget every read (module state outlives a render). */
export function resetTurnHoldReads(): void {
  reads.clear();
  done.clear();
}

function readTrail(key: string, runId: string): Promise<void> {
  const open = reads.get(key);
  if (open !== undefined) return open;
  const p = api.getRunEvents(runId).then(
    ({ events }) => {
      useRunEventStore.getState().hydrate(runId, events);
      done.add(key);
    },
    (err: unknown) => {
      reads.delete(key);
      throw err;
    },
  );
  reads.set(key, p);
  return p;
}

export function useTurnRulesHold(runId: string | null, view: SessionView | null, opts: { running: boolean; framed: boolean }): TurnHold {
  const gate = useGateStore((s) => (runId === null ? undefined : s.gates[runId]));
  const events = useRunEventStore((s) => (runId === null ? undefined : s.byRun[runId])) ?? null;
  const live = runId !== null && opts.running && gate !== undefined;
  const key = live && !opts.framed && gate !== undefined ? `${runId}:${gate.ord}:${gate.receivedAt}` : null;
  const [readFor, setReadFor] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (key === null || runId === null) return undefined;
    if (done.has(key)) { setReadFor(key); return undefined; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    readTrail(key, runId).then(
      () => { if (alive) setReadFor(key); },
      () => { if (alive) timer = setTimeout(() => setTick((n) => n + 1), RETRY_MS); },
    );
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
  }, [key, runId, tick]);
  const verified = key !== null && readFor === key;
  const heldNow = live && gate !== undefined && view !== null && rulesHoldAt(verified ? events : null, view.units, gate.ord).held;
  return { gate, events, heldNow, held: verified && heldNow };
}
