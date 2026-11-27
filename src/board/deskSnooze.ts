/**
 * Snoozing a Needs-you item (crew#1124; DES-desk-v2 §6 item 6). Pure in every input, `now` included.
 *
 * - The snooze key is the item INSTANCE: the row's key and the daemon's identity of this occurrence
 *   (`NeedRow.instance`: `fail:<run>@ended:<ms>`), the same live and after a reload. A new failure or onboarding is a
 *   new instance, so it is never hidden by an older snooze. A row with no such identity can't be snoozed: a stalled
 *   run or chat or a campaign (only studio's clock tells them apart), a gate (a run can ask again at the same ord and
 *   no gate frame or read names the occurrence) and a steer ask (its id is minted by this browser).
 * - A snooze is in force while its end is still ahead AND the item is no worse than when it was snoozed: the row's
 *   rank now ({@link snoozeRank}) is at most the rank stored with the snooze. One that gets worse comes back at once.
 * - Such a studio-key snooze only defers the item on the Desk's inbox: the item stays in crew's attention read.
 * - (studio#1430) A ranked crew snoozes too: an attention item it marks with `snooze: {key, rank}` (a run's own open
 *   gate) is snoozed with crew's key, so crew holds it out of `attention[]` (and /needs, the badge and every count) and
 *   lists it in `snoozed[]`. {@link snoozeTargetOf} picks crew's key wherever crew has one for the row's run, which is
 *   how a gate, never snoozable with studio's own key, gets a Snooze on a ranked crew. Every surface that reads
 *   studio's fold treats a run crew holds ({@link crewHeldRuns}) as snoozed; Wake ends it by the held item's key.
 */

import type { NeedRow } from './needsYou.js';
import type { DeskSnooze } from '../api/deskSnooze-wire.js';
import type { SystemSnapshot, SystemSnoozed } from '../api/system.js';
import { needRunId } from './deskModel.js';

/** crew's limit on a snooze key, and on how far ahead a snooze may end. */
export const SNOOZE_KEY_MAX = 200;
export const SNOOZE_MAX_MS = 7 * 24 * 3_600_000;

export function snoozeKey(row: Pick<NeedRow, 'key' | 'instance'>): string {
  return `${row.key}@${row.instance ?? ''}`;
}

/** A row the inbox can offer to snooze: one item (never a folded group) with a daemon identity, and a key crew takes. */
export function snoozable(row: NeedRow): boolean {
  return row.members === undefined && row.instance !== undefined && snoozeKey(row).length <= SNOOZE_KEY_MAX;
}

/** The row's rank as crew stores it with a snooze: a whole number 0-1000. */
export function snoozeRank(row: Pick<NeedRow, 'severity'>): number {
  return Math.max(0, Math.min(1000, Math.round(row.severity)));
}

/** The snooze holding this row back now, or null. */
export function snoozeOf(row: NeedRow, byKey: Readonly<Record<string, DeskSnooze>>, now: number): DeskSnooze | null {
  const s = byKey[snoozeKey(row)];
  if (s === undefined) return null;
  const end = Date.parse(s.until);
  if (!Number.isFinite(end) || end <= now) return null;
  if (s.severity !== null && snoozeRank(row) > s.severity) return null;
  return s;
}

/** The last /system read, as the holds are judged against it. */
export interface HoldRead {
  snapshot: SystemSnapshot | null;
  /** When the newest successful read was asked (this browser's clock), or null before one. */
  askedAt: number | null;
  /** The newest read failed (its snapshot is the older one kept). */
  failed: boolean;
}

/** (studio#1430, DES-S-NEEDS-HOLDS) The runs a ranked crew holds back for a person's snooze (`/system.snoozed[]`), each
 *  with its held item. A hold holds the run's open gate (its gate row, {@link crewHeldOf}) and nothing else. Fail-open:
 *  it counts only while the last /system read SUCCEEDED, its end is still ahead, this page holds the run's gate, and the
 *  read was asked after everything this page saw for the run (`seenAt`: that gate's arrival, and a Wake of the hold's
 *  key, both on this browser's clock; `undefined`, nothing to judge by, holds nothing). Otherwise the item shows: a
 *  snoozed item can come back for one poll, work is never hidden. Empty against an older crew. */
export function crewHeldRuns(read: HoldRead, now: number, seenAt: (runId: string, wakeKey: string | null) => number | undefined): ReadonlyMap<string, SystemSnoozed> {
  const out = new Map<string, SystemSnoozed>();
  const { snapshot, askedAt } = read;
  if (read.failed || askedAt === null || snapshot === null || snapshot.ranked !== true) return out;
  for (const h of snapshot.snoozed ?? []) {
    if (h.runId == null || out.has(h.runId) || (h.until !== null && h.until <= now)) continue;
    const seen = seenAt(h.runId, h.wakeKey);
    if (seen === undefined || seen >= askedAt) continue;
    out.set(h.runId, h);
  }
  return out;
}

/** A row crew holds back, or null: only a run's gate row (a failure, a stall or any other row of a held run shows). */
export function crewHeldOf(row: NeedRow, held: ReadonlyMap<string, SystemSnoozed>): SystemSnoozed | null {
  if (row.kind !== 'gate') return null;
  const id = needRunId(row);
  return id === null ? null : held.get(id) ?? null;
}

/** The rows whose run no ranked crew holds back (studio#1430): what a project's count counts. */
export function withoutCrewHeld(rows: readonly NeedRow[], held: ReadonlyMap<string, SystemSnoozed>): NeedRow[] {
  return held.size === 0 ? [...rows] : rows.filter((r) => crewHeldOf(r, held) === null);
}

/** One snoozed row: when it comes back (ISO; null when not said) and the key Wake now ends (null: no wake offered). */
export interface SnoozedRow { row: NeedRow; until: string | null; wakeKey: string | null; crew: boolean }

/** The rows the inbox shows, and the ones snoozed, in the order given: studio's own snoozes, and (studio#1430) every
 *  row of a run a ranked crew holds back, so the inbox counts what /needs counts. */
export function splitSnoozed(rows: readonly NeedRow[], byKey: Readonly<Record<string, DeskSnooze>>, now: number, held: ReadonlyMap<string, SystemSnoozed> = new Map()): { awake: NeedRow[]; snoozed: SnoozedRow[] } {
  const awake: NeedRow[] = [];
  const snoozed: SnoozedRow[] = [];
  for (const row of rows) {
    const h = crewHeldOf(row, held);
    if (h !== null) { snoozed.push({ row, until: h.until === null ? null : new Date(h.until).toISOString(), wakeKey: h.wakeKey, crew: true }); continue; }
    const s = snoozeOf(row, byKey, now);
    if (s === null) awake.push(row);
    else snoozed.push({ row, until: s.until, wakeKey: s.key, crew: false });
  }
  return { awake, snoozed };
}

/** (studio#1430 F4) How the inbox snoozes a row: with crew's own key and rank when crew has an item for its run (so
 *  crew holds it back from /needs and every count too), else studio's own key for a row it may snooze; null: none. */
export function snoozeTargetOf(row: NeedRow, snapshot: SystemSnapshot | null): { key: string; rank: number; crew: boolean } | null {
  const id = needRunId(row);
  if (row.members === undefined && id !== null && snapshot !== null && snapshot.ranked === true) {
    const item = snapshot.attention.find((a) => a.runId === id && a.snooze != null);
    if (item?.snooze != null) return { key: item.snooze.key, rank: item.snooze.rank, crew: true };
  }
  return snoozable(row) ? { key: snoozeKey(row), rank: snoozeRank(row), crew: false } : null;
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
