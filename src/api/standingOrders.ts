/**
 * The standing-orders wire (Studio OS behaviour 10): the away switch, the plain-words parse, the
 * create / retire, and the outbox of queued messages.
 *
 * ── INTEGRATION POINT ─────────────────────────────────────────────────────────────────────────
 * Hand-declared from `wicked-crew-api-types` (`StandingOrdersState` 0.50.0, `ParsedStandingOrder`
 * 0.48.0), which studio's installed contract predates. The rule and the order are THE ones the gate
 * card and the trust receipt already speak (`./gateHistory.ts`, with `band` and `preset`), so an
 * order made at a gate or from Insights is the same row this list shows. Delete this block and
 * re-export from the contract package once studio bumps to the version that carries them.
 */

import { apiFetch } from './client.js';
import type { StandingOrder, StandingOrderRule } from './gateHistory.js';

export type { StandingOrder, StandingOrderRule };

export interface QueuedStandingMessage {
  id: string;
  orderId: string;
  orderText: string;
  runId: string | null;
  text: string;
  at: number;
  status: 'queued';
}

export interface StandingOrdersState {
  away: boolean;
  awaySince: number | null;
  orders: StandingOrder[];
  outbox: QueuedStandingMessage[];
}

export interface ParsedStandingOrder {
  rule: StandingOrderRule;
  seat: string;
  refused?: string;
}

export const standingOrdersApi = {
  get: () => apiFetch<StandingOrdersState>('/standing-orders'),
  setAway: (away: boolean) =>
    apiFetch<StandingOrdersState>('/standing-orders/away', { method: 'PUT', body: JSON.stringify({ away }) }),
  parse: (text: string) =>
    apiFetch<ParsedStandingOrder>('/standing-orders/parse', { method: 'POST', body: JSON.stringify({ text }) }),
  create: (text: string, rule: StandingOrderRule) =>
    apiFetch<{ order: StandingOrder }>('/standing-orders', { method: 'POST', body: JSON.stringify({ text, rule }) }),
  remove: (id: string) =>
    apiFetch<{ removed: true }>(`/standing-orders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
