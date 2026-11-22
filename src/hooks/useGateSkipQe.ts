import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { ApiError } from '../api/client.js';
import { GATE_RETRY_BASE_MS, GATE_RETRY_MAX_MS, getGateBounded, inGateRetrySlot } from '../board/gateActions.js';
import type { SkipQeOffer } from '../api/types.js';

/**
 * (api-types 0.146.0) A deliver gate's in-place QE skip, read from `GET /runs/:id/gate` once per gate while `on`.
 * A live `awaitingHuman` frame never carries it, so a card that opened live asks the daemon, as a reload does
 * (`gateFromInfo`). A failed read (a brief 503 included, studio#1203) is tried again with the main gate read's backoff
 * (`GATE_RETRY_*`) until it lands or the card goes. `null` until read, for another gate, and from a daemon that sends none.
 */
export function useGateSkipQe(runId: string, instance: string | null, ord: number | undefined, on: boolean): SkipQeOffer | null {
  // The gate's full identity (`gateInstance`: ord and receivedAt): a gate reopened at the same ord reads afresh.
  const key = `${runId}:${instance ?? ''}`;
  const [read, setRead] = useState<{ key: string; offer: SkipQeOffer | null } | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = new AbortController();
    const attempt = (failures: number): Promise<void> =>
      (failures === 0 ? api.getGate(runId) : getGateBounded(runId, failures, stop.signal)).then(
        (info) => { if (live) setRead({ key, offer: info.ord === ord && info.skipQe !== undefined ? info.skipQe : null }); },
        (e: unknown) => {
          if (!live) return;
          // crew's 404 is an answer (no open gate); anything else is tried again, through the retry read slots (studio#1319) so
          // many cards retrying never read at once; eligibility is rechecked once a slot is held.
          if (e instanceof ApiError && e.status === 404) { setRead({ key, offer: null }); return; }
          timer = setTimeout(() => { void inGateRetrySlot(async () => { if (live) await attempt(failures + 1); }); }, Math.min(GATE_RETRY_BASE_MS * 2 ** failures, GATE_RETRY_MAX_MS));
        },
      );
    void attempt(0);
    return () => { live = false; stop.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [runId, ord, on, key]);
  return on && read?.key === key ? read.offer : null;
}
