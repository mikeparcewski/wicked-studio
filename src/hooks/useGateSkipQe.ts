import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { SkipQeOffer } from '../api/types.js';

/**
 * (api-types 0.146.0) A deliver gate's in-place QE skip, read from `GET /runs/:id/gate` once per gate while `on`.
 * A live `awaitingHuman` frame never carries it, so a card that opened live asks the daemon, as a reload does
 * (`gateFromInfo`). `null` until read, on a failed read, for another gate, and from a daemon that sends none.
 */
export function useGateSkipQe(runId: string, instance: string | null, ord: number | undefined, on: boolean): SkipQeOffer | null {
  // The gate's full identity (`gateInstance`: ord and receivedAt): a gate reopened at the same ord reads afresh.
  const key = `${runId}:${instance ?? ''}`;
  const [read, setRead] = useState<{ key: string; offer: SkipQeOffer | null } | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    api.getGate(runId).then(
      (info) => { if (live) setRead({ key, offer: info.ord === ord && info.skipQe !== undefined ? info.skipQe : null }); },
      () => { if (live) setRead({ key, offer: null }); },
    );
    return () => { live = false; };
  }, [runId, ord, on, key]);
  return on && read?.key === key ? read.offer : null;
}
