/**
 * The delivery freeze wire — `GET|PUT /api/v1/deliveries/freeze` (wicked-crew#694): one switch that
 * holds every deliver gate. While `frozen`, crew refuses an approve of a gate that would run a
 * deliver unit with 409 `{code: "deliveries_frozen"}` (and the post-hoc deliver the same way); the
 * gate stays open, so unfreezing lets the same approve through. Audited by crew.
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 */

import { ApiError } from './errors.js';
import { apiFetch } from './client.js';

import type { DeliveryFreezeState, PutDeliveryFreezeBody } from 'wicked-crew-api-types';
export type { DeliveryFreezeState, PutDeliveryFreezeBody };

export const deliveryFreezeApi = {
  get: () => apiFetch<DeliveryFreezeState>('/deliveries/freeze'),
  put: (body: PutDeliveryFreezeBody) =>
    apiFetch<DeliveryFreezeState>('/deliveries/freeze', { method: 'PUT', body: JSON.stringify(body) }),
};

/** crew's 409 for an approve (or a post-hoc deliver) the freeze held. */
export function isDeliveriesFrozen(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 409) return false;
  const body = e.body;
  return typeof body === 'object' && body !== null && (body as Record<string, unknown>)['code'] === 'deliveries_frozen';
}

/** What freezing does, said before the click. */
export const FREEZE_CONSEQUENCE =
  'Holds every deliver gate: no run pushes a branch or opens a PR until you unfreeze. '
  + 'Open gates stay open and nothing is cancelled. Recorded in the audit trail.';

/** What unfreezing does, said before the click. */
export const UNFREEZE_CONSEQUENCE =
  'Deliver gates can be approved again. Nothing pushes by itself: each held run still waits for its approve.';

/** The banner line while frozen: who, since when, why. */
export function frozenBannerText(s: DeliveryFreezeState): string {
  const who = s.by !== null ? ` by ${s.by}` : '';
  const at = s.since !== null ? Date.parse(s.since) : NaN;
  const when = Number.isFinite(at)
    ? ` since ${new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : '';
  const why = s.reason !== null ? ` · ${s.reason}` : '';
  return `Deliveries frozen${who}${when}${why}`;
}
