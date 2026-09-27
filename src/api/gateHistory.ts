/**
 * The decided-gate history and the standing-order routes the gate card speaks (brainstorm-actionable
 * ideas 7 and 8):
 *
 *   GET  /api/v1/gates/decided?since=<unix ms>   decided gates, newest first (wicked-crew#691)
 *   GET  /api/v1/standing-orders                 the orders in force (wicked-crew#686)
 *   POST /api/v1/standing-orders {text, rule}     make a confirmed order (201 {order})
 *
 * ── INTEGRATION POINT ─────────────────────────────────────────────────────────────────────────
 * The shapes below mirror `DecidedGate` / `DecidedGatesResponse` (api-types 0.53.0) and
 * `StandingOrderRule` / `StandingOrder` / `StandingOrdersState` (0.50.0, `band` 0.53.0), which
 * studio's installed contract predates. Delete this block and re-export from the contract package
 * the moment studio bumps to the api-types version that carries them.
 */

import { apiFetch } from './client.js';

export interface DecidedGate {
  runId: string;
  ord: number | null;
  /** Unix millis. */
  decidedAt: number;
  decision: 'approve' | 'request_changes' | 'reject' | 'edit_plan';
  /** A person's actor id, or `standing-order:<id>`. */
  actor: string;
  byOrder: boolean;
  gateKind: string | null;
  phase: string | null;
  projectId: string | null;
  band: string | null;
  creator: { seat: string; phase: string | null; ord: number } | null;
  /** A standing order could have approved this gate (crew's own invariant). */
  orderApprovable: boolean;
}

export interface StandingOrderRule {
  scope: { kind: 'all' } | { kind: 'project'; projectId: string };
  trigger: { kind: 'gate'; phase: string; band?: string } | { kind: 'finding'; severity: 'high' | 'medium' | '*' };
  action: 'approve' | 'hold' | 'notify';
  activeWhen: 'away' | 'always';
}

export interface StandingOrder {
  id: string;
  text: string;
  rule: StandingOrderRule;
  createdAt: number;
}

/** `GET /whoami` — the actor this studio acts as (`local` when auth is off). */
export function getWhoami(): Promise<{ actor: { id: string } }> {
  return apiFetch<{ actor: { id: string } }>('/whoami');
}

export function getDecidedGates(since: number): Promise<{ gates: DecidedGate[] }> {
  return apiFetch<{ gates: DecidedGate[] }>(`/gates/decided?since=${Math.max(0, Math.floor(since))}`);
}

export function getStandingOrders(): Promise<{ orders: StandingOrder[] }> {
  return apiFetch<{ orders: StandingOrder[] }>('/standing-orders');
}

export function createStandingOrder(text: string, rule: StandingOrderRule): Promise<{ order: StandingOrder }> {
  return apiFetch<{ order: StandingOrder }>('/standing-orders', { method: 'POST', body: JSON.stringify({ text, rule }) });
}
