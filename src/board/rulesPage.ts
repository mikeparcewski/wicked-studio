import { steeringTypeOf, type SteeringRule } from '../api/steering.js';

/**
 * The Rules page's words (DES-STUDIO-REBUILD-001 §5.4 `/rules`, slice S12; DES-DECISION-CAPTURE §3
 * B9/B11, §5.2). Grouping and counts over the rules crew serves — nothing here derives a rule: the
 * model is crew's (`ConformanceRule` on the wire) and the sentence for one rule is DC's
 * (`ruleSentence`, board/ruleOrigin.ts). Pure, unit-tested.
 */

export type RulesGroup = 'words' | 'testing' | 'other';

export const GROUP_ORDER: readonly RulesGroup[] = ['words', 'testing', 'other'];

export const GROUP_LABELS: Record<RulesGroup, string> = {
  words: 'From your words',
  testing: 'Testing rules',
  other: 'Other rules',
};

/**
 * A rule crew landed from a decision — the operator's words. Read from the rule's PROVENANCE
 * (DC §4.2.4: a decision landing stamps source_kinds `decision`; the proposal row it rides
 * carries source `decision`), never from the `proposal:<id>` namespace: an agent-proposed policy
 * the operator approved on the queue lands under the same ids (api/proposals.ts) and is not the
 * operator's words.
 */
export function fromYourWords(rule: SteeringRule): boolean {
  const p = rule.provenance;
  return (p.source_kinds ?? []).includes('decision') || p.source === 'decision';
}

export function groupOf(rule: SteeringRule): RulesGroup {
  if (fromYourWords(rule)) return 'words';
  if (steeringTypeOf(rule) === 'testing') return 'testing';
  return 'other';
}

/** Crew stamps `created_at` (seconds) on a landed rule; a seeded rule may carry none. */
function createdAt(rule: SteeringRule): number {
  const v = (rule as { created_at?: unknown }).created_at;
  return typeof v === 'number' ? v : 0;
}

/** The page's rows: in force first — by group, newest first inside a group — retired last. */
export function orderRules(rules: readonly SteeringRule[]): SteeringRule[] {
  const rank = (r: SteeringRule): number => (r.retired === true ? GROUP_ORDER.length : GROUP_ORDER.indexOf(groupOf(r)));
  return [...rules].sort((a, b) => rank(a) - rank(b) || createdAt(b) - createdAt(a) || a.id.localeCompare(b.id));
}

/** The one sentence: "3 rules in force · 1 from your words · 1 testing rule · 2 retired". */
export function rulesSentence(rules: readonly SteeringRule[]): string {
  if (rules.length === 0) return 'No rules yet — helpers work from the defaults.';
  const live = rules.filter((r) => r.retired !== true);
  const parts = [`${live.length} ${live.length === 1 ? 'rule' : 'rules'} in force`];
  const words = live.filter(fromYourWords).length;
  if (words > 0) parts.push(`${words} from your words`);
  const testing = live.filter((r) => groupOf(r) === 'testing').length;
  if (testing > 0) parts.push(`${testing} testing ${testing === 1 ? 'rule' : 'rules'}`);
  const retired = rules.length - live.length;
  if (retired > 0) parts.push(`${retired} retired`);
  return parts.join(' · ');
}
