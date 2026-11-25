/**
 * Snoozing a Needs-you item (crew#1124; DES-desk-v2 §6 item 6). Pure in every input, `now` included.
 *
 * - The snooze key is the item INSTANCE: the row's key and its clock (`gate:<run>@<at>`), the inbox's own seen id. A
 *   new decision on the same job is a new instance, so it is never hidden by an older snooze.
 * - A snooze is in force while its end is still ahead AND the item is no worse than when it was snoozed: the row's
 *   rank now (`NeedRow.severity`) is at most the rank stored with the snooze. One that gets worse comes back at once.
 * - It only defers the item on the Desk's inbox: the item stays in crew's attention read.
 */

import type { NeedRow } from './needsYou.js';
import type { DeskSnooze } from '../api/deskSnooze-wire.js';

/** crew's limit on a snooze key, and on how far ahead a snooze may end. */
export const SNOOZE_KEY_MAX = 200;
export const SNOOZE_MAX_MS = 7 * 24 * 3_600_000;

export function snoozeKey(row: Pick<NeedRow, 'key' | 'at'>): string {
  return `${row.key}@${row.at ?? ''}`;
}

/** A row the inbox can offer to snooze: one item (never a folded group), with a key crew takes. */
export function snoozable(row: NeedRow): boolean {
  return row.members === undefined && snoozeKey(row).length <= SNOOZE_KEY_MAX;
}

/** The snooze holding this row back now, or null. */
export function snoozeOf(row: NeedRow, byKey: Readonly<Record<string, DeskSnooze>>, now: number): DeskSnooze | null {
  const s = byKey[snoozeKey(row)];
  if (s === undefined) return null;
  const end = Date.parse(s.until);
  if (!Number.isFinite(end) || end <= now) return null;
  if (s.severity !== null && row.severity > s.severity) return null;
  return s;
}

/** The rows the inbox shows, and the ones snoozed (with their snooze), in the order given. */
export function splitSnoozed(rows: readonly NeedRow[], byKey: Readonly<Record<string, DeskSnooze>>, now: number): { awake: NeedRow[]; snoozed: Array<{ row: NeedRow; snooze: DeskSnooze }> } {
  const awake: NeedRow[] = [];
  const snoozed: Array<{ row: NeedRow; snooze: DeskSnooze }> = [];
  for (const row of rows) {
    const s = snoozeOf(row, byKey, now);
    if (s === null) awake.push(row);
    else snoozed.push({ row, snooze: s });
  }
  return { awake, snoozed };
}

export interface SnoozeChoice {
  id: 'hour' | 'tomorrow' | 'days';
  label: string;
  /** ISO-8601 (UTC, `Z`): crew's schema takes any offset. */
  until: string;
}

/** The ends offered: an hour, tomorrow at 9:00 local time, three days. Each is in the future and within crew's week. */
export function snoozeChoices(now: number): SnoozeChoice[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { id: 'hour', label: 'For an hour', until: new Date(now + 3_600_000).toISOString() },
    { id: 'tomorrow', label: 'Until tomorrow 9:00', until: tomorrow.toISOString() },
    { id: 'days', label: 'For 3 days', until: new Date(now + 3 * 24 * 3_600_000).toISOString() },
  ];
}

/** When a snooze ends, in the person's words: "today 14:05", "tomorrow 9:00", "Fri 27 Nov 9:00". */
export function snoozeEndWords(until: string, now: number): string {
  const end = new Date(Date.parse(until));
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const time = `${end.getHours()}:${String(end.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((day(end) - day(new Date(now))) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  return `${end.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
