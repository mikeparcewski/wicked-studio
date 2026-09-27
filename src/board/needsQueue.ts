import { plausibleClock } from './ageHonesty.js';
import { rankNeeds, type NeedAction, type NeedGroupKey, type NeedRow } from './needsYou.js';
import { batchOnboardConsequence, batchOnboardLabel } from './repairMoves.js';
import { acceptMemoryLabel, consequenceRank, PROPOSAL_PAGE, type ProposalConsequence } from './proposalTriage.js';

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
  reindex: {
    one: 'repo never indexed',
    many: 'repos never indexed',
    line: 'No onboarding run on record',
  },
};

/** The group row's own move and line: a `reindex` group carries the batch onboard with its
 *  consequence (idea 3); every other group opens its lead member, as before. */
function groupMove(key: NeedGroupKey, ranked: readonly NeedRow[]): { action: NeedAction; text: string } {
  const lead = ranked[0]!;
  if (key === 'reindex') {
    const repoIds = ranked.map((m) => m.batch?.repoId).filter((id): id is string => id !== undefined);
    const estimate = lead.batch?.estimate ?? { medianMs: null, samples: 0 };
    return {
      action: { kind: 'batch-onboard', repoIds, label: batchOnboardLabel(repoIds.length) },
      text: batchOnboardConsequence(repoIds.length, estimate),
    };
  }
  if (key === 'proposal') {
    // Triage by consequence (Wave B, idea 4): the line counts what an accept DOES, and the move
    // accepts exactly the memory-only members; the enforcement-changing ones stay for review.
    const of = (c: ProposalConsequence): NeedRow[] => ranked.filter((m) => m.proposal?.consequence === c);
    const harmless = of('memory');
    const enforcing = of('enforcement').length;
    const unknown = of('unknown').length;
    const parts: string[] = [];
    if (harmless.length > 0) parts.push(`${harmless.length} memory-only`);
    if (enforcing > 0) parts.push(`${enforcing} change${enforcing === 1 ? 's' : ''} enforcement`);
    if (unknown > 0) parts.push(`${unknown} of unknown kind`);
    return {
      action: harmless.length > 0
        ? { kind: 'accept-memory', ids: harmless.map((m) => m.proposal!.id), label: acceptMemoryLabel(harmless.length) }
        : lead.action,
      text: parts.length > 0 ? parts.join(' · ') : GROUP_WORDS[key].line,
    };
  }
  return { action: lead.action, text: GROUP_WORDS[key].line };
}

/** A proposal group lists what changes enforcement first (then unknown kinds, then memories);
 *  within a class, the one ranking's order holds. */
function orderMembers(key: NeedGroupKey, ranked: NeedRow[]): NeedRow[] {
  if (key !== 'proposal') return ranked;
  const rank = (r: NeedRow): number => consequenceRank(r.proposal?.consequence ?? 'unknown');
  return ranked.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

/** How many members an expanded group shows at a time: a proposal group pages by
 *  {@link PROPOSAL_PAGE} so the ones to review stay few enough to read; others show all. */
export function memberPageSize(key: NeedGroupKey | undefined): number {
  return key === 'proposal' ? PROPOSAL_PAGE : Infinity;
}

/** One page of an expanded group's members: which show, and where they sit in the whole. */
export interface MemberPage {
  items: NeedRow[];
  /** The page actually shown (the asked-for page, clamped). */
  page: number;
  pages: number;
  /** 1-based position of the first shown member, and of the last. */
  from: number;
  to: number;
  total: number;
}

/** The members an expanded group shows on `page` (clamped to the pages that exist). */
export function memberPage(row: NeedRow, page = 0): MemberPage {
  const members = row.members ?? [];
  const total = members.length;
  const size = Math.min(memberPageSize(row.groupKey), Math.max(1, total));
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  const items = members.slice(at * size, at * size + size);
  return { items, page: at, pages, from: total === 0 ? 0 : at * size + 1, to: at * size + items.length, total };
}

/** The members an expanded group shows on `page`. */
export function visibleMembers(row: NeedRow, page = 0): NeedRow[] {
  return memberPage(row, page).items;
}

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
    const ranked = orderMembers(key, rankNeeds([...members], now));
    for (const m of ranked) folded.add(m.key);
    const lead = ranked[0]!;
    // Only plausible clocks age a group: one broken member must not read as the oldest (idea 14).
    const clocks = ranked.map((m) => plausibleClock(m.at, now)).filter((t): t is number => t !== null);
    const move = groupMove(key, ranked);
    out.push({
      key: `group:${key}`,
      kind: lead.kind,
      severity: Math.max(...ranked.map((m) => m.severity)),
      stakes: ranked.reduce((n, m) => n + m.stakes, 0),
      groupKey: key,
      members: ranked,
      subject: groupLabel(key, ranked.length),
      text: move.text,
      tone: lead.tone,
      at: clocks.length > 0 ? Math.min(...clocks) : null,
      subjectPath: lead.subjectPath,
      action: move.action,
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

/** The flat order the cursor walks: each row, then — when its group is expanded — its visible members. */
export function queueEntries(
  rows: readonly NeedRow[],
  expanded: ReadonlySet<string>,
  pages: Readonly<Record<string, number>> = {},
): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const row of rows) {
    out.push({ row, parentKey: null });
    if (row.members !== undefined && expanded.has(row.key)) {
      for (const m of visibleMembers(row, pages[row.key] ?? 0)) out.push({ row: m, parentKey: row.key });
    }
  }
  return out;
}
