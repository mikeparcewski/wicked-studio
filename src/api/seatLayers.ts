import type { RepoEntry } from './types.js';
import { ApiError, apiStatus } from './errors.js';

/**
 * wicked-core#1043: the toolchain layers a repo's seats get, as crew serves them on `GET /repos` and in the reply of
 * `PUT /repos/:id/seat-layers` (wicked-crew api-types 0.232.0 `RepoEntry.seat_layers` / `seat_layers_off`). Studio
 * pins an older api-types, so the fields are read here from core's writer: `RepoEntry.seat_layers`
 * (core src/repo.rs:82-88, always serialized on the reads a person sees) holds the layers detected in the checkout,
 * in catalog order, each `{id, enabled, off_by}` (src/seat_layers.rs:382-408); `seat_layers_off` (src/repo.rs:89-94)
 * is the repo's own off list, sorted, absent when empty.
 */

export type SeatLayerOffBy = 'repo' | 'daemon' | 'operator_base';
export interface SeatLayerRow {
  id: string;
  enabled: boolean;
  off_by: SeatLayerOffBy | null;
}

const OFF_BY: ReadonlySet<string> = new Set<SeatLayerOffBy>(['repo', 'daemon', 'operator_base']);

/** The rows crew sent, or `null` when it sent none (a crew or engine before core#1043). A row not in core's shape is
 *  left out. */
export function seatLayersOf(repo: RepoEntry): SeatLayerRow[] | null {
  const raw = (repo as { seat_layers?: unknown }).seat_layers;
  if (!Array.isArray(raw)) return null;
  const rows: SeatLayerRow[] = [];
  for (const r of raw as unknown[]) {
    if (typeof r !== 'object' || r === null) continue;
    const { id, enabled, off_by: offBy } = r as { id?: unknown; enabled?: unknown; off_by?: unknown };
    if (typeof id !== 'string' || id === '' || typeof enabled !== 'boolean') continue;
    if (offBy !== null && !(typeof offBy === 'string' && OFF_BY.has(offBy))) continue;
    rows.push({ id, enabled, off_by: offBy as SeatLayerOffBy | null });
  }
  return rows;
}

/** The repo's own off list: crew's `seat_layers_off` (which keeps a layer the checkout no longer has), else the rows
 *  the repo's switch turned off. */
export function seatLayersOffOf(repo: RepoEntry, rows: readonly SeatLayerRow[]): string[] {
  const raw = (repo as { seat_layers_off?: unknown }).seat_layers_off;
  if (Array.isArray(raw)) return (raw as unknown[]).filter((x): x is string => typeof x === 'string' && x !== '');
  return rows.filter((r) => r.off_by === 'repo').map((r) => r.id);
}

/** The full off list after switching `id` on or off, sorted as crew stores it. */
export function nextSeatLayersOff(off: readonly string[], id: string, turnOn: boolean): string[] {
  const set = new Set(off);
  if (turnOn) set.delete(id);
  else set.add(id);
  return [...set].sort();
}

const LAYER_WORDS: Record<string, string> = { go: 'Go', java: 'Java', node: 'Node.js', python: 'Python', rust: 'Rust' };
/** A layer's name for a person; a layer a newer engine adds reads as its id. */
export function seatLayerName(id: string): string {
  return LAYER_WORDS[id] ?? id;
}

/**
 * Why a change did not land, in plain words, when crew said so: these refusals come before crew writes anything, so
 * nothing changed. `null` when the outcome is not known (no answer, or a failure crew did not name): the write may
 * have landed, so the caller reads crew again before the next change.
 */
export function seatLayersRefusal(e: unknown): string | null {
  const code = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? (e.body as { code?: unknown }).code : undefined;
  const status = apiStatus(e);
  if (code === 'human_operator_only' || status === 403) return 'Only a person can change this; an agent cannot.';
  if (code === 'repo_not_found') return 'This repository is no longer registered.';
  if (code === 'unknown_seat_layer') return 'This daemon has no such toolchain layer.';
  if (code === 'repo_seat_layers_unsupported' || status === 501) return 'This daemon can’t turn toolchain layers off yet. Upgrade wicked-crew to use this.';
  return null;
}

/** What the card says when the outcome is not known; the switches then show crew's row as read again. */
export const SEAT_LAYERS_UNSURE = 'Couldn’t confirm that change. The switches show what this daemon has now.';
