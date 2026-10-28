import type { SystemAction, SystemAttention, SystemUnresolved } from '../api/system.js';
import { gateOpenPath } from './gateActions.js';
import { sessionPath } from './sessionModel.js';

/**
 * A RANKED CREW'S NEEDS-YOU LIST, IN WORDS (crew api-types 0.140.0, `capabilities.attentionRanked`).
 * Crew decides what holds work up and in which order (one root cause per item, ranked by impact);
 * studio only says it. Pure, so the words and the split are pinned by tests.
 *
 * The /needs page (approved mockup `ui-v2-needs`): the items holding several jobs (or the system
 * itself) first, then the ones waiting on one decision, then the work nobody resolved ("To resolve",
 * with what it cost), and the things worth a look folded under them.
 */

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** "Five", "12". */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** The page's one sentence: how many things hold up work, and how much the first one holds. */
export function rankedSentence(items: readonly SystemAttention[]): string {
  const n = items.length;
  if (n === 0) return 'Nothing is holding up work.';
  const head = `${countWord(n)} ${n === 1 ? 'thing is' : 'things are'} holding up work.`;
  const first = items[0]!;
  const held = first.blockedRunIds?.length ?? 0;
  if (held < 2) return head;
  return `${head} The first one is ${first.kind === 'slows' ? 'slowing' : 'blocking'} ${countWord(held).toLowerCase()} jobs.`;
}

/** The split, crew's order kept inside each: several jobs (or the system itself) first, then one decision each. */
export function rankedSections(items: readonly SystemAttention[]): { several: SystemAttention[]; single: SystemAttention[] } {
  const several: SystemAttention[] = [];
  const single: SystemAttention[] = [];
  // (brief ui-v2-needs) Several jobs held, or the system itself preventing or slowing work (an item about no one run).
  const system = (a: SystemAttention): boolean => a.panel === 'infra' || (a.runId == null && (a.kind === 'prevents' || a.kind === 'slows'));
  for (const a of items) ((a.blockedRunIds?.length ?? 0) >= 2 || system(a) ? several : single).push(a);
  return { several, single };
}

/** Where an item's action goes (a gate, a run), or null when it is not a navigation. */
export function actionPath(a: SystemAction | null): string | null {
  if (a === null) return null;
  if (a.kind === 'open-gate') return gateOpenPath('', a.target);
  if (a.kind === 'open-run') return sessionPath(`run:${a.target}`);
  return null;
}

/** A row's short verb ("Decide →", "Deliver →"): the gate's kind when it is a delivery. */
export function rowVerb(a: SystemAttention, gateKind: string | null): string {
  const k = a.action?.kind;
  if (k === 'open-gate') return gateKind === 'deliver' ? 'Deliver' : 'Decide';
  if (k === 'sign-in') return 'Sign in';
  if (k === 'recheck') return 'Re-check';
  return 'Open';
}

/** "3 h", "12 min", "4 days": how long something has waited. */
export function waitWords(since: number, now: number): string {
  const mins = Math.max(0, Math.round((now - since) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

const dollars = (usd: number): string => `$${usd >= 100 ? Math.round(usd) : usd.toFixed(2)}`;

/** An unresolved run's cost line ("$0.42 · 1.5k tokens · ran 17 h"): only what is known; `''` when nothing is. */
export function costWords(u: Pick<SystemUnresolved, 'costUsd' | 'tokens' | 'wallMs'>): string {
  const parts: string[] = [];
  if (u.costUsd !== null && u.costUsd > 0) parts.push(dollars(u.costUsd));
  if (u.tokens !== null && u.tokens > 0) parts.push(`${u.tokens >= 1000 ? `${Math.round(u.tokens / 100) / 10}k` : u.tokens} tokens`);
  if (u.wallMs !== null && u.wallMs > 0) parts.push(`ran ${waitWords(0, u.wallMs)}`);
  return parts.join(' · ');
}

/** One line of "To resolve": a single run, or look-alike runs folded into one (same repo, same
 *  workflow, same reason), so thirteen probes that failed the same way read as one thing. */
export interface ResolveGroup {
  key: string;
  why: SystemUnresolved['why'];
  items: SystemUnresolved[];
  /** The group's words ("12 jobs in tiny-math failed 9–10 days ago"); a single run's own title. */
  title: string;
  /** The muted line: a single run's reason; a group's summed cost (empty when none is known). */
  line: string;
}

/** At most this many lines show before "Show N more". */
export const RESOLVE_SHOWN = 5;

const DAY = 86_400_000;

/** "9–10 days ago", "10 days ago", "today": how long ago a group's runs stopped. */
export function agoRange(sinces: readonly (number | null)[], now: number): string {
  const days = sinces.filter((x): x is number => x !== null).map((t) => Math.max(0, Math.round((now - t) / DAY)));
  if (days.length === 0) return '';
  const lo = Math.min(...days);
  const hi = Math.max(...days);
  const word = (d: number): string => (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);
  if (lo === hi) return word(lo);
  return lo === 0 ? `in the last ${hi} days` : `${lo}–${hi} days ago`;
}

/** Fold look-alike unresolved runs, crew's order kept (a group sits where its first member was). */
export function resolveGroups(list: readonly SystemUnresolved[], now: number): ResolveGroup[] {
  const by = new Map<string, SystemUnresolved[]>();
  for (const u of list) {
    const key = `${u.why}|${u.repo ?? ''}|${u.why === 'failed' ? (u.workflow ?? '') : ''}`;
    const g = by.get(key);
    if (g === undefined) by.set(key, [u]); else g.push(u);
  }
  return [...by.entries()].map(([key, items]) => {
    const one = items[0]!;
    if (items.length === 1) return { key, why: one.why, items, title: one.title, line: [one.reason, costWords(one)].filter((x) => x !== '').join(' · ') };
    const where = one.repo !== null ? ` in ${one.repo}` : '';
    const when = agoRange(items.map((u) => u.since), now);
    const title = one.why === 'failed'
      ? `${items.length} jobs${where} failed${when !== '' ? ` ${when}` : ''}`
      : one.why === 'superseded'
        ? `${items.length} jobs${where} were replaced by later runs`
        : `${items.length} answered questions${where} parked for over a day`;
    const usd = items.reduce((s, u) => s + (u.costUsd ?? 0), 0);
    const tokens = items.reduce((s, u) => s + (u.tokens ?? 0), 0);
    const line = costWords({ costUsd: usd > 0 ? usd : null, tokens: tokens > 0 ? tokens : null, wallMs: null });
    const what = one.why === 'failed' ? 'Never retried or archived' : one.why === 'superseded' ? 'A later run did the work' : 'Answered; nothing waits on them';
    return { key, why: one.why, items, title, line: line === '' ? what : `${what} · ${line} spent` };
  });
}

/** Why it is unresolved, in one word for the row's tag. */
export const WHY_WORD: Record<SystemUnresolved['why'], string> = { failed: 'Failed', superseded: 'Superseded', parked: 'Parked' };
