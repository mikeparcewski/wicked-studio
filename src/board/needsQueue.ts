import { rankNeeds, type NeedGroupKey, type NeedRow } from './needsYou.js';

/**
 * The needs-you QUEUE's shape over the fold (studio wave 2b): alike SIMPLE items fold
 * into one expandable row, and the queue's keyboard walks one flat order. Pure — the
 * hook (`useNeedsQueue`) holds the expansion and the cursor; skins only render.
 *
 * Grouping rule: two or more rows carrying the same `groupKey` become ONE row whose
 * members are those rows, ranked. A lone member stays a plain row (a group of one is
 * not a group). The group ranks like any row, through the same `compareNeeds`: its
 * clock is its longest-waiting member, its stakes the members' sum.
 */

/** "2 approvals" / "3 proposals to review" — the group row's subject. */
const GROUP_WORDS: Record<NeedGroupKey, { one: string; many: string; line: string }> = {
  approval: {
    one: 'approval',
    many: 'approvals',
    line: 'Yes/no gates waiting on you — expand to open each',
  },
  proposal: {
    one: 'proposal to review',
    many: 'proposals to review',
    line: 'Policies and memories waiting on review',
  },
};

export function groupLabel(key: NeedGroupKey, n: number): string {
  const w = GROUP_WORDS[key];
  return `${n} ${n === 1 ? w.one : w.many}`;
}

/** Fold alike simple rows into group rows, then rank the result with the one ranking. */
export function groupAlike(rows: readonly NeedRow[], now: number): NeedRow[] {
  const byGroup = new Map<NeedGroupKey, NeedRow[]>();
  for (const r of rows) {
    if (r.groupKey === undefined) continue;
    byGroup.set(r.groupKey, [...(byGroup.get(r.groupKey) ?? []), r]);
  }
  const out: NeedRow[] = [];
  const folded = new Set<string>();
  for (const [key, members] of byGroup) {
    if (members.length < 2) continue;
    const ranked = rankNeeds([...members], now);
    for (const m of ranked) folded.add(m.key);
    const lead = ranked[0]!;
    const clocks = ranked.map((m) => m.at).filter((t): t is number => t !== null);
    const w = GROUP_WORDS[key];
    out.push({
      key: `group:${key}`,
      kind: lead.kind,
      severity: Math.max(...ranked.map((m) => m.severity)),
      stakes: ranked.reduce((n, m) => n + m.stakes, 0),
      groupKey: key,
      members: ranked,
      subject: groupLabel(key, ranked.length),
      text: w.line,
      tone: lead.tone,
      at: clocks.length > 0 ? Math.min(...clocks) : null,
      subjectPath: lead.subjectPath,
      action: lead.action,
    });
  }
  for (const r of rows) if (!folded.has(r.key)) out.push(r);
  return rankNeeds(out, now);
}

/** How many items a set of queue rows stands for (a group counts its members). */
export function needCount(rows: readonly NeedRow[]): number {
  return rows.reduce((n, r) => n + (r.members?.length ?? 1), 0);
}

/** One stop of the queue cursor: a top-level row, or a member of an expanded group. */
export interface QueueEntry {
  row: NeedRow;
  /** The group this entry sits inside, or null for a top-level row. */
  parentKey: string | null;
}

/** The flat order the cursor walks: each row, then — when its group is expanded — its members. */
export function queueEntries(rows: readonly NeedRow[], expanded: ReadonlySet<string>): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const row of rows) {
    out.push({ row, parentKey: null });
    if (row.members !== undefined && expanded.has(row.key)) {
      for (const m of row.members) out.push({ row: m, parentKey: row.key });
    }
  }
  return out;
}
