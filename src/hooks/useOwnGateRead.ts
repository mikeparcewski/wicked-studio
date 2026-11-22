import { useEffect } from 'react';
import type { SessionView } from '../api/types.js';
import { ensureGate } from '../board/gateActions.js';
import { useConnectionStore } from '../store/connection.js';
import { useGateStore } from '../store/gates.js';

/** F31/T20: the visible run reads its own gate without waiting for the runs list's shared slots.
 *  A reconnect retries a read the drop made obsolete; never start one while disconnected. */
export function useOwnGateRead(runId: string | null, status: SessionView['session']['status'] | undefined): void {
  const connected = useConnectionStore((s) => s.status === 'connected');
  useEffect(() => {
    if (connected && runId !== null && status === 'awaiting_human' && useGateStore.getState().gates[runId] === undefined) void ensureGate(runId);
  }, [runId, status, connected]);
}
