import { useEffect, useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import type { NeedRow } from '../board/needsYou.js';
import { ensureGate, inGateSlot, refreshGate } from '../board/gateActions.js';
import { useConnectionStore } from '../store/connection.js';
import { needsRecheck, useGateStore } from '../store/gates.js';

/** The read a shown waiting run needs: its gate when none is cached, a re-read when a reconnect made the cached one
 *  doubtful (F31, studio#1023), else nothing. */
function readShownGate(runId: string): Promise<void> {
  if (useGateStore.getState().gates[runId] === undefined) return ensureGate(runId);
  if (needsRecheck(runId)) return refreshGate(runId);
  return Promise.resolve();
}

/** F31/T20: the visible run reads its own gate without waiting for a list's shared slots. crew#1775: a reconnect
 *  re-reads the gate it holds (no runs-list pass does that any more). Never starts a read while disconnected. */
export function useOwnGateRead(runId: string | null, status: SessionView['session']['status'] | undefined): void {
  const connected = useConnectionStore((s) => s.status === 'connected');
  useEffect(() => {
    if (connected && runId !== null && status === 'awaiting_human') void readShownGate(runId);
  }, [runId, status, connected]);
}

/**
 * crew#1775: the gates of the waiting runs a list shows (the needs queue), read in the list's order through the
 * shared slots (`inGateSlot`, at most `GATE_READS_IN_FLIGHT` on their way). A page reads only the gates it shows:
 * the runs list reads none, so a session or editor page never queues behind every other waiting run's gate.
 */
export function useShownGateReads(runIds: readonly string[]): void {
  const connected = useConnectionStore((s) => s.status === 'connected');
  const key = runIds.join('\n');
  useEffect(() => {
    if (!connected || key === '') return;
    let cancelled = false;
    for (const id of key.split('\n')) {
      void inGateSlot(async () => {
        if (!cancelled) await readShownGate(id);
      });
    }
    return () => { cancelled = true; };
  }, [key, connected]);
}

/** The run of each decision row a needs list shows (`gate:<run>`), group members included, in the list's order. */
export function gateRunIdsOf(rows: readonly NeedRow[]): string[] {
  const out: string[] = [];
  const visit = (r: NeedRow): void => {
    if (r.kind === 'gate' && r.key.startsWith('gate:')) out.push(r.key.slice('gate:'.length));
    for (const m of r.members ?? []) visit(m);
  };
  for (const r of rows) visit(r);
  return [...new Set(out)];
}

/** {@link useShownGateReads} over a needs list's rows. */
export function useNeedRowGateReads(rows: readonly NeedRow[]): void {
  const ids = useMemo(() => gateRunIdsOf(rows), [rows]);
  useShownGateReads(ids);
}
