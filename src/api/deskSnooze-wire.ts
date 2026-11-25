/**
 * Wire shapes and calls of crew's Needs-you snooze (crew#1124, wicked-crew-api-types 0.225.0 `DeskSnooze`,
 * `DeskSnoozesResponse`, `PutDeskSnoozeBody`, `DeskSnoozeWakeResponse`). Studio pins an older api-types, so they are
 * typed here, field for field, until the pin moves.
 *
 *   GET    /api/v1/desk/snoozes         → {@link DeskSnoozesResponse} (only the snoozes still in force)
 *   PUT    /api/v1/desk/snoozes/:key    {@link PutDeskSnoozeBody} → {@link DeskSnooze}
 *   DELETE /api/v1/desk/snoozes/:key    → {@link DeskSnoozeWakeResponse}
 *
 * Refusals: 400 `desk_snooze_invalid` (an end not in the future, more than 7 days ahead, or a key over 200 characters);
 * 403 `human_operator_only` (an agent's token; an observer's gets the auth boundary's own 403); 500
 * `desk_snooze_unsaved` (nothing changed). A daemon from before crew#1124 answers 404: studio offers no snooze.
 * A snooze only defers the item on the Desk; it stays in `/system.attention[]`.
 */

import { apiFetch } from './client.js';

export interface DeskSnooze {
  /** The skin's own id for the item; opaque to the daemon. */
  key: string;
  /** ISO-8601: when the snooze ends by itself. */
  until: string;
  /** The skin's rank of the item when it was snoozed (higher is worse); `null` when not said. */
  severity: number | null;
  /** ISO-8601: when it was snoozed. */
  at: string;
  /** The actor id that snoozed it. */
  by: string;
}

export interface DeskSnoozesResponse {
  /** The snoozes still in force, soonest to end first. */
  snoozes: DeskSnooze[];
}

export interface PutDeskSnoozeBody {
  /** ISO-8601 with an offset; in the future, at most 7 days ahead. */
  until: string;
  /** A whole number 0-1000: the skin's rank of the item, higher is worse. */
  severity?: number;
}

export interface DeskSnoozeWakeResponse {
  key: string;
  /** `false` when no snooze was in force for the key. */
  woken: boolean;
}

const path = (key: string): string => `/desk/snoozes/${encodeURIComponent(key)}`;

export const deskSnoozeApi = {
  list: (): Promise<DeskSnoozesResponse> => apiFetch<DeskSnoozesResponse>('/desk/snoozes'),
  snooze: (key: string, body: PutDeskSnoozeBody): Promise<DeskSnooze> =>
    apiFetch<DeskSnooze>(path(key), { method: 'PUT', body: JSON.stringify(body) }),
  wake: (key: string): Promise<DeskSnoozeWakeResponse> => apiFetch<DeskSnoozeWakeResponse>(path(key), { method: 'DELETE' }),
};
