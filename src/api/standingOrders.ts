/**
 * The standing-orders wire (Studio OS behaviour 10): the away switch, the plain-words parse, the
 * create / retire, and the outbox of queued messages.
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 * The rule and the order are THE ones the gate card and the trust receipt already speak
 * (`./gateHistory.ts`, with `band` and `preset`), so an order made at a gate or from Insights is the
 * same row this list shows.
 */

import { apiFetch } from './client.js';
import type { StandingOrder, StandingOrderRule } from './gateHistory.js';

import type { QueuedStandingMessage, StandingOrdersState, ParsedStandingOrder } from 'wicked-crew-api-types';
export type { QueuedStandingMessage, StandingOrdersState, ParsedStandingOrder };

export type { StandingOrder, StandingOrderRule };

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
