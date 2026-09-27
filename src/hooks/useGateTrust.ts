import { useCallback, useEffect, useState } from 'react';
import {
  createStandingOrder,
  getDecidedGates,
  getStandingOrders,
  getWhoami,
  type DecidedGate,
  type StandingOrder,
} from '../api/gateHistory.js';
import { HISTORY_DAYS, type RuleOffer } from '../components/gateTrustModel.js';

const DAY = 86_400_000;

export interface GateTrust {
  /** The decided-gate history, or `null` until read (and on a daemon that cannot serve it). */
  gates: DecidedGate[] | null;
  /** The orders in force, or `null` when they could not be read (then nothing is offered). */
  orders: StandingOrder[] | null;
  /** The actor this studio acts as; `null` when the daemon cannot say ("you" is then any person);
   *  `undefined` while it is still being read (nothing is offered until then). */
  me: string | null | undefined;
  /** The order this card made, once made. */
  made: StandingOrder | null;
  busy: boolean;
  error: string | null;
  makeRule: (offer: RuleOffer) => Promise<void>;
}

/**
 * The gate card's trust reads (brainstorm-actionable ideas 7 and 8): the last `HISTORY_DAYS` of
 * decided gates and the standing orders in force, read once per gate (`runId`, `ord`), and the one
 * write — make the offered order through `POST /standing-orders`. A daemon without the history
 * route leaves `gates` null: the card shows no record and offers nothing, never a guess.
 */
export function useGateTrust(runId: string, ord: number | undefined, enabled: boolean): GateTrust {
  const [gates, setGates] = useState<DecidedGate[] | null>(null);
  const [orders, setOrders] = useState<StandingOrder[] | null>(null);
  const [made, setMade] = useState<StandingOrder | null>(null);
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A new gate (or a host that stopped passing trust facts) starts from nothing: never a previous
    // gate's history driving this one's record or offer while the reads are in flight.
    setGates(null);
    setOrders(null);
    setMe(undefined);
    setMade(null);
    setError(null);
    if (!enabled) return;
    let cancelled = false;
    getWhoami()
      .then(({ actor }) => { if (!cancelled) setMe(typeof actor?.id === 'string' ? actor.id : null); })
      .catch(() => { if (!cancelled) setMe(null); });
    getDecidedGates(Date.now() - HISTORY_DAYS * DAY)
      .then(({ gates: g }) => { if (!cancelled) setGates(Array.isArray(g) ? g : []); })
      .catch(() => { if (!cancelled) setGates(null); });
    getStandingOrders()
      .then(({ orders: o }) => { if (!cancelled) setOrders(Array.isArray(o) ? o : []); })
      .catch(() => { if (!cancelled) setOrders(null); });
    return () => { cancelled = true; };
  }, [enabled, runId, ord]);

  const makeRule = useCallback(async (offer: RuleOffer) => {
    setBusy(true);
    setError(null);
    try {
      const { order } = await createStandingOrder(offer.text, offer.rule);
      setMade(order);
      setOrders((cur) => [...(cur ?? []), order]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return { gates, orders, me, made, busy, error, makeRule };
}
