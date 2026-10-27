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
  for (const a of items) ((a.blockedRunIds?.length ?? 0) >= 2 || a.panel === 'infra' ? several : single).push(a);
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

/** An unresolved run's cost line ("$0.42 · 1.5k tokens · ran 17 h"); parts not known are left out. */
export function costWords(u: SystemUnresolved): string {
  const parts: string[] = [];
  if (u.costUsd !== null && u.costUsd > 0) parts.push(`$${u.costUsd >= 100 ? Math.round(u.costUsd) : u.costUsd.toFixed(2)}`);
  if (u.tokens !== null && u.tokens > 0) parts.push(`${u.tokens >= 1000 ? `${Math.round(u.tokens / 100) / 10}k` : u.tokens} tokens`);
  if (u.wallMs !== null) parts.push(`ran ${waitWords(0, u.wallMs)}`);
  return parts.length === 0 ? 'cost not recorded' : parts.join(' · ');
}

/** Why it is unresolved, in one word for the row's tag. */
export const WHY_WORD: Record<SystemUnresolved['why'], string> = { failed: 'Failed', superseded: 'Superseded', parked: 'Parked' };
