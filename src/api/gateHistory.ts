/**
 * The decided-gate history and the standing-order routes the gate card speaks (brainstorm-actionable
 * ideas 7 and 8):
 *
 *   GET  /api/v1/gates/decided?since=<unix ms>   decided gates, newest first (wicked-crew#691)
 *   GET  /api/v1/standing-orders                 the orders in force (wicked-crew#686)
 *   POST /api/v1/standing-orders {text, rule}     make a confirmed order (201 {order})
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 */

import { apiFetch } from './client.js';

/** `GET /whoami` — the actor this studio acts as (`local` when auth is off). */
import type { DecidedGate, StandingOrderRule, StandingOrder } from 'wicked-crew-api-types';
export type { DecidedGate, StandingOrderRule, StandingOrder };

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
