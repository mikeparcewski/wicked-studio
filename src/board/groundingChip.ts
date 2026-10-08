import type { DocGrounding } from '../api/interactive.js';

/**
 * studio#567: a document row's grounding chip, read from the structured record crew#512 emits
 * (`grounding {repo_refs, source, skipped[{ref, reason}], member_count}` on the docs row) — never
 * parsed out of the "Grounded on …" narration. Pure: `null` when the field is absent (an older
 * daemon, a document grounded before the sidecar existed), so the row shows exactly what it did.
 */
export interface GroundingChip {
  /** "Grounded on 2 repos" / "Grounded on 1 of 3 repos" / "Not grounded on a repo". */
  label: string;
  /** The repo refs, one per line, for the hover. Empty when none were grounded. */
  reposTitle: string;
  /** Why those repos, in words ("named on the ask", …). */
  source: string;
  /** The muted "skipped K" segment, or null when nothing was skipped. */
  skipped: { count: number; title: string } | null;
}

const SOURCE_WORD: Record<string, string> = {
  named: 'named on the ask',
  brief: 'named in the brief',
  'sole-member': "the project's only repo",
  none: 'nothing named',
};

const REASON_WORD: Record<string, string> = {
  'not-a-member': 'not a project member',
  ambiguous: 'several members share that name',
  unsnapshotable: 'its snapshot failed',
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Defensive: a field that is not the documented shape reads as absent (the row stays as it was). */
function valid(g: unknown): g is DocGrounding {
  if (g === null || typeof g !== 'object') return false;
  const o = g as Record<string, unknown>;
  return Array.isArray(o.repo_refs) && typeof o.source === 'string' && Array.isArray(o.skipped);
}

export function groundingChip(g: DocGrounding | null | undefined): GroundingChip | null {
  if (!valid(g)) return null;
  const refs = g.repo_refs.filter((r): r is string => typeof r === 'string' && r !== '');
  const skips = g.skipped.filter((k) => k !== null && typeof k === 'object' && typeof k.ref === 'string');
  const n = refs.length;
  const members = typeof g.member_count === 'number' && Number.isFinite(g.member_count) ? g.member_count : null;
  const label = n === 0
    ? 'Not grounded on a repo'
    : members !== null && members > n
      ? `Grounded on ${n} of ${plural(members, 'repo')}`
      : `Grounded on ${plural(n, 'repo')}`;
  return {
    label,
    reposTitle: refs.join('\n'),
    source: SOURCE_WORD[g.source] ?? g.source,
    skipped: skips.length === 0
      ? null
      : { count: skips.length, title: skips.map((k) => `${k.ref} — ${REASON_WORD[k.reason] ?? k.reason}`).join('\n') },
  };
}
