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
 * A rule crew landed from a decision — the operator's words (DC §4.2.4: `policyProposalToRule`
 * names it `proposal:<id>` and stamps provenance source_kinds `decision`; either mark is enough,
 * so an older crew that set only one still counts).
 */
export function fromYourWords(rule: SteeringRule): boolean {
  return rule.id.startsWith('proposal:') || (rule.provenance.source_kinds ?? []).includes('decision');
}

export function groupOf(rule: SteeringRule): RulesGroup {
  if (fromYourWords(rule)) return 'words';
  if (steeringTypeOf(rule) === 'testing') return 'testing';
  return 'other';
}

/**
 * DC §5.2: a policy that landed from a decision before project scoping (DC-S3) is global by
 * accident (E3). It is listed once as "landed without its project"; re-scoping it is a human click
 * on the grid. A retired one is history, not a warning.
 */
export function landedWithoutProject(rule: SteeringRule): boolean {
  const project = rule.targets.project;
  return fromYourWords(rule) && rule.rule_type === 'policy' && (project === undefined || project === '') && rule.retired !== true;
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
