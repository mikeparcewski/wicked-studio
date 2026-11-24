/**
 * The blast-radius wire as the ring model's rows (studio#1290). Crew passes estate's `blast-radius --json` through, and
 * estate gives every dependent row its `depth`: hops from the target along the walk that admitted it, `1` = a direct
 * dependent (wicked-estate #191). api-types' row type does not name it yet, so it is read here as optional.
 *
 * A depth past `searched_depth` (the horizon that applied) is put on the last ring searched, never beyond it; a row
 * with no usable depth (an older estate) is left unplaced, so it is counted and listed, never drawn on a ring it may
 * not be on.
 */
import type { BlastRadius } from '../api/types.js';
import type { CodeRow } from './codeRings.js';

const isHop = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;

export function blastRows(blast: BlastRadius): CodeRow[] {
  const horizon = isHop(blast.searched_depth) ? blast.searched_depth : null;
  return blast.dependents.map((d) => {
    const raw = (d as { depth?: unknown }).depth;
    const depth = isHop(raw) ? (horizon !== null ? Math.min(raw, horizon) : raw) : null;
    return { symbolId: d.id, name: d.name, file: d.file, depth };
  });
}
