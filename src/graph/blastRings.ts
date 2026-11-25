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

const hopsText = (k: number): string => `${k} hop${k === 1 ? '' : 's'}`;

/**
 * What the answer itself says it leaves out (estate's walk limits), for the rings and for an answer with no
 * dependents alike: an empty answer that stopped at its horizon or size limit is not "nothing depends on this".
 */
export function blastCompleteness(blast: BlastRadius): string[] {
  const notes: string[] = [];
  if (blast.depth_horizon_reached === true) {
    notes.push(isHop(blast.searched_depth)
      ? `The search stopped at ${hopsText(blast.searched_depth)}; more dependents lie beyond it.`
      : 'The search stopped at its hop limit; more dependents lie beyond it.');
  }
  if (blast.node_cap_reached === true) notes.push('The search reached its size limit, so some dependents are missing.');
  if (typeof blast.truncated_dependents === 'number' && blast.truncated_dependents > 0) {
    notes.push(`${blast.truncated_dependents} more ${blast.truncated_dependents === 1 ? 'dependent was' : 'dependents were'} left out of the answer to fit its size.`);
  }
  return notes;
}
