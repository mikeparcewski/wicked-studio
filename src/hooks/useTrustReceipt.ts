import { useCallback, useEffect, useMemo, useState } from 'react';
import { createStandingOrder, getStandingOrders, type StandingOrder } from '../api/gateHistory.js';
import { receiptFactsOf, trustReceipt, type TrustReceiptInForce, type TrustReceiptOffer } from '../components/trustReceiptModel.js';
import { useGateStore } from '../store/gates.js';
import { useProjectsStore } from '../store/projects.js';

export interface TrustReceiptState {
  /** The offer, the order already in force, or `null` (not a low-risk preset run; orders unread). */
  receipt: TrustReceiptOffer | TrustReceiptInForce | null;
  /** The order this panel made, once made. */
  made: StandingOrder | null;
  busy: boolean;
  error: string | null;
  trust: () => Promise<void>;
}

/**
 * The Insights panel's trust receipt (brainstorm-actionable idea 13): the orders in force read once
 * per run (`GET /standing-orders`), the offer derived by `trustReceipt`, and the one write — make
 * the band-scoped plan-approval order through `POST /standing-orders`. A daemon that cannot list
 * its orders leaves the receipt `null`: nothing is offered on a guess.
 */
export function useTrustReceipt(session: {
  id: string;
  project_id?: unknown;
  workflow_id?: unknown;
  team_plan?: unknown;
}): TrustReceiptState {
  const runId = session.id;
  const gate = useGateStore((s) => s.gates[runId]);
  const projectId = typeof session.project_id === 'string' ? session.project_id : null;
  const projectName = useProjectsStore((s) => (projectId === null ? null : s.projects.find((p) => p.id === projectId)?.name ?? null));
  const [orders, setOrders] = useState<StandingOrder[] | null>(null);
  const [made, setMade] = useState<StandingOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrders(null);
    setMade(null);
    setError(null);
    let cancelled = false;
    getStandingOrders()
      .then(({ orders: o }) => { if (!cancelled) setOrders(Array.isArray(o) ? o : []); })
      .catch(() => { if (!cancelled) setOrders(null); });
    return () => { cancelled = true; };
  }, [runId]);

  const atPlanGate = gate?.gateKind === 'plan_approval' || /^\s*Approve plan rev\b/i.test(gate?.prompt ?? '');
  const receipt = useMemo(
    () => (orders === null ? null : trustReceipt(receiptFactsOf(session, projectName, atPlanGate), orders)),
    [orders, session, projectName, atPlanGate],
  );

  const trust = useCallback(async () => {
    if (receipt === null || receipt.kind !== 'offer') return;
    setBusy(true);
    setError(null);
    try {
      const { order } = await createStandingOrder(receipt.text, receipt.rule);
      setMade(order);
      setOrders((cur) => [...(cur ?? []), order]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [receipt]);

  return { receipt, made, busy, error, trust };
}
