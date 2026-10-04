import type { Consideration, SetAsideReason } from '../api/considered.js';

/**
 * The considered line (DES-DECISION-CAPTURE §3 B10, slice DC-S8): one quiet line under a seat's
 * reply or a run's step, from crew's {@link Consideration} of that turn or unit. Pure: the component
 * renders what this returns, or nothing for `null`.
 *
 *   "2 of your rules considered · 1 set aside · cited 1 (unchecked)"
 *
 * It expands to one row per rule:
 *   - Considered — the rule was in force here and the seats were given it;
 *   - Cited by the step — unchecked — the reply or step wrote `[rule:<id>]` and the id is in force.
 *     Whether it kept to the rule is not checked by anything, so that verdict is never claimed
 *     (B4: a compliance verdict waits for DES-rule-check, and its word is never shown);
 *   - Set aside — other project / replaced / retired / not confirmed yet;
 *   - an invented or out-of-scope `[rule:<id>]` is an unverified citation, shown by its id.
 *
 * Nothing is drawn when no rule touched the turn or step (nothing considered, set aside or cited),
 * or when the engine could not be read at all (`source: 'unavailable'`) and nothing was cited.
 */

export type ConsideredVerdict = 'considered' | 'cited' | 'set-aside' | 'unverified';

export interface ConsideredRow {
  /** The rule id (or the cited token's id for an unverified citation). */
  id: string;
  /** The rule's statement; the id itself for an unverified citation. */
  statement: string;
  verdict: ConsideredVerdict;
  /** The verdict in words: "Considered", "Cited by codex — unchecked", "Set aside — other project". */
  detail: string;
  /** Whether the row can open the rule on the Rules page (unverified citations cannot). */
  opens: boolean;
}

export interface ConsideredLineModel {
  /** The one sentence. */
  text: string;
  rows: ConsideredRow[];
  /** A footnote when the engine read was not the project-aware one. */
  note: string | null;
  counts: { considered: number; setAside: number; cited: number; unverified: number };
}

const SET_ASIDE_WORDS: Record<SetAsideReason, string> = {
  out_of_scope: 'Set aside — other project',
  replaced: 'Set aside — replaced',
  retired: 'Set aside — retired',
  not_confirmed: 'Set aside — not confirmed yet',
};

/** `codex` → "codex"; a unit id (`r-pay-2:u1`) → "the step". */
function whoWords(by: string): string {
  return /^[a-z0-9_-]+$/i.test(by) ? by : 'the step';
}

export function consideredLine(c: Consideration): ConsideredLineModel | null {
  const unchecked = c.cited.filter((x) => x.status === 'unchecked');
  const unverified = c.cited.filter((x) => x.status === 'unverified');
  // The sentence counts RULES: two seats citing one rule is one cited rule; one invented id written
  // twice is one unverified citation — the same things the rows below list once each.
  const distinct = (xs: readonly { id: string }[]): number => new Set(xs.map((x) => x.id)).size;
  const counts = { considered: c.considered.length, setAside: c.set_aside.length, cited: distinct(unchecked), unverified: distinct(unverified) };
  if (counts.considered + counts.setAside + counts.cited + counts.unverified === 0) return null;
  if (c.source === 'unavailable' && counts.cited + counts.unverified === 0) return null;

  const citedBy = new Map<string, string[]>();
  for (const x of unchecked) citedBy.set(x.id, [...(citedBy.get(x.id) ?? []), x.by]);

  const rows: ConsideredRow[] = [];
  for (const r of c.considered) {
    const by = citedBy.get(r.id);
    rows.push(by === undefined
      ? { id: r.id, statement: r.statement, verdict: 'considered', detail: 'Considered', opens: true }
      : { id: r.id, statement: r.statement, verdict: 'cited', detail: `Cited by ${[...new Set(by.map(whoWords))].join(' and ')} — unchecked`, opens: true });
  }
  // A cited id in force but not in the considered list (crew's read says in force; the list is the
  // same set, so this is defensive): still a cited row, by its id.
  for (const x of unchecked) {
    if (!c.considered.some((r) => r.id === x.id) && !rows.some((row) => row.id === x.id)) {
      rows.push({ id: x.id, statement: x.id, verdict: 'cited', detail: `Cited by ${whoWords(x.by)} — unchecked`, opens: true });
    }
  }
  for (const s of c.set_aside) {
    rows.push({ id: s.id, statement: s.statement, verdict: 'set-aside', detail: SET_ASIDE_WORDS[s.reason] ?? 'Set aside', opens: s.reason !== 'not_confirmed' });
  }
  const seenUnverified = new Set<string>();
  for (const x of unverified) {
    if (seenUnverified.has(x.id)) continue;
    seenUnverified.add(x.id);
    rows.push({ id: x.id, statement: `[rule:${x.id}]`, verdict: 'unverified', detail: `Unverified citation by ${whoWords(x.by)} — not a rule in force here`, opens: false });
  }

  const parts: string[] = [];
  parts.push(counts.considered === 0 ? 'None of your rules considered' : `${counts.considered} of your rules considered`);
  if (counts.setAside > 0) parts.push(`${counts.setAside} set aside`);
  if (counts.cited > 0) parts.push(`cited ${counts.cited} (unchecked)`);
  if (counts.unverified > 0) parts.push(`${counts.unverified} unverified ${counts.unverified === 1 ? 'citation' : 'citations'}`);

  const note = c.source === 'global-only'
    ? 'This daemon reads only the rules that apply everywhere; project rules were not considered.'
    : c.source === 'unavailable' ? 'The rules in force could not be read, so nothing here was considered.' : null;

  return { text: parts.join(' · '), rows, note, counts };
}
