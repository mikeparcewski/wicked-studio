import type { RepoEntry } from '../api/types.js';

/**
 * (crew#1984, wicked-core#2023 / core#1043) A repository's seat image settings, read from its `RepoEntry` as a bag:
 * studio pins an api-types older than `seat_base_image` and `seat_layers` (api-types 0.236.0), and an older daemon
 * omits both.
 */

/** One toolchain layer the repository's seats get, as the engine derives it (`seat_layers[]`). */
export interface SeatLayerRow {
  id: string;
  enabled: boolean;
  offBy: string | null;
}

/** The repository's own seat base image, or `null` when it has none (or the daemon predates the setting). */
export function seatBaseOf(repo: RepoEntry): string | null {
  const v = (repo as unknown as Record<string, unknown>)['seat_base_image'];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** The layer rows, skipping any malformed one; `null` when the daemon sends none (it predates them). */
export function seatLayersOf(repo: RepoEntry): SeatLayerRow[] | null {
  const v = (repo as unknown as Record<string, unknown>)['seat_layers'];
  if (!Array.isArray(v)) return null;
  const rows: SeatLayerRow[] = [];
  for (const r of v as unknown[]) {
    if (typeof r !== 'object' || r === null) continue;
    const { id, enabled, off_by: offBy } = r as Record<string, unknown>;
    if (typeof id !== 'string' || typeof enabled !== 'boolean') continue;
    rows.push({ id, enabled, offBy: typeof offBy === 'string' ? offBy : null });
  }
  return rows;
}

const LAYER_NAMES: Record<string, string> = { go: 'Go', java: 'Java', node: 'Node.js', python: 'Python', rust: 'Rust' };

/** A layer's name for a person (an id this studio does not know is shown as sent). */
export function layerName(id: string): string {
  return LAYER_NAMES[id] ?? id;
}

/** What a layer row says: on, or off and why (a reason this studio does not know is said plainly). */
export function layerWord(row: SeatLayerRow): string {
  if (row.enabled) return 'Added to its seats';
  switch (row.offBy) {
    case 'repo_base': return 'Not added: this repository’s seat base image is its toolchain';
    case 'operator_base': return 'Not added: this daemon’s seat base image is its toolchain';
    case 'daemon': return 'Not added: toolchain layers are off on this daemon';
    case 'repo': return 'Not added: turned off for this repository';
    default: return 'Not added';
  }
}
