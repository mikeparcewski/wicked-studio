/**
 * The standing-orders wire (Studio OS behaviour 10).
 *
 * ── TEMPORARY: hand-declared from wicked-crew-api-types 0.48.0 ─────────────────────────────────
 * crew's repo carries 0.48.0 (`packages/crew-api-types/index.d.ts`), studio pins 0.39.0. Same
 * pattern as `./teamPlan.ts`: every declaration below is a verbatim subset of 0.48.0. Delete this
 * block and import from `wicked-crew-api-types` once studio bumps to a published version that
 * carries `StandingOrdersState`. Crew bundles this dist, so the two always ship together.
 */

import { apiFetch } from './client.js';

export interface StandingOrderRule {
  scope: { kind: 'all' } | { kind: 'project'; projectId: string };
  trigger: { kind: 'gate'; phase: string } | { kind: 'finding'; severity: 'high' | 'medium' | '*' };
  action: 'approve' | 'hold' | 'notify';
  activeWhen: 'away' | 'always';
}

export interface StandingOrder {
  id: string;
  text: string;
  rule: StandingOrderRule;
  createdAt: number;
}

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
