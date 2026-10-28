import type { GovernanceClaim } from '../api/types.js';
import { STEERING_TYPE_LABELS, steeringTypeOf, type SteeringRule, type SteeringType } from '../api/steering.js';

/**
 * The calm Steering page's words (the operator-approved pages mockup, 2026-10-26): a rule's
 * plain-language title, where it applies, how often it fired this week, and the page's one
 * sentence. Pure; pinned by unit test.
 */

const TITLE_MAX = 96;

/**
 * A rule's title in plain words: its statement's first clause (up to the first sentence end, a
 * semicolon, a dash aside or a lead-in colon), trimmed at a word boundary. The statement itself is
 * the rule — it is still there in full behind the row.
 */
export function ruleTitle(statement: string): string {
  const s = statement.replace(/\s+/g, ' ').trim();
  if (s === '') return 'A rule with no words';
  const cut = [/\.\s/, /;\s/, /\s[—–]\s/, /:\s/]
    .map((re) => s.search(re))
    .filter((i) => i >= 12)
    .reduce((a, b) => Math.min(a, b), s.length);
  let t = s.slice(0, cut).replace(/[.;:,\s]+$/, '');
  // An aside in brackets is detail, not the point: a long title drops it.
  if (t.length > 72) { const bare = t.replace(/\s*\([^()]*\)/g, '').replace(/\s+,/g, ',').trim(); if (bare.length >= 12) t = bare; }
  // An unclosed aside (the clause cut ran through it) goes too.
  const open = t.lastIndexOf('(');
  if (open > 12 && t.indexOf(')', open) === -1) t = t.slice(0, open).replace(/[\s,;:]+$/, '');
  if (t.length > TITLE_MAX) {
    const room = t.slice(0, TITLE_MAX);
    const space = room.lastIndexOf(' ');
    t = `${(space > 40 ? room.slice(0, space) : room).replace(/[.;:,\s]+$/, '')}…`;
  }
  return t;
}

/** Where a rule applies, in words: its project, its other string targets, else every repository. */
export function ruleReach(rule: SteeringRule, projectName: (id: string) => string | null): string {
  const project = rule.targets.project;
  if (typeof project === 'string' && project !== '') return `applies to ${projectName(project) ?? 'one project'}`;
  const others = Object.entries(rule.targets ?? {})
    .filter(([k, v]) => k !== 'project' && typeof v === 'string' && v !== '')
    .map(([, v]) => v as string);
  return others.length > 0 ? `applies to ${others.join(', ')}` : 'applies to every repository';
}

/** The steering-rule id an obligation names: crew writes `conform:<Severity>:<RULE-ID>:<statement>`. */
function obligationRuleId(obligation: string): string | null {
  const m = /^conform:[^:]+:([^:]+):/.exec(obligation);
  return m === null ? null : (m[1] ?? null);
}

export const FIRE_WINDOW_DAYS = 7;

/**
 * How often each rule FIRED in the last {@link FIRE_WINDOW_DAYS} days: the gate checks (the
 * `GET /governance/claims` record, real `evaluated_at` clocks) that cite the rule — as a deciding
 * policy (`policy_ids`) or as an obligation the gate held the work to (`conform:…:<id>:…`). One
 * claim counts once per rule.
 */
export function ruleFires(claims: readonly Pick<GovernanceClaim, 'evaluated_at' | 'policy_ids' | 'obligations'>[], now: number, days = FIRE_WINDOW_DAYS): Map<string, number> {
  const since = now - days * 24 * 3_600_000;
  const out = new Map<string, number>();
  for (const c of claims) {
    const at = c.evaluated_at * 1000;
    if (at < since || at > now) continue;
    const ids = new Set<string>(c.policy_ids ?? []);
    for (const o of c.obligations ?? []) { const id = obligationRuleId(o); if (id !== null) ids.add(id); }
    for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** The row's meta word for a rule's week. */
export function firesWord(n: number | undefined): string {
  if (n === undefined || n === 0) return 'Quiet this week';
  return `Fired ${n}× this week`;
}

/** The page's one sentence: "42 rules guide your agents. 3 proposals are waiting for you." */
export function steerSentence({ live, type, pending }: { live: number | null; type: SteeringType | null; pending: number | null | 'unsupported' }): string {
  const kind = type === null ? '' : `${STEERING_TYPE_LABELS[type].toLowerCase()} `;
  const rules = live === null ? 'Reading your rules…'
    : live === 0 ? (type === null ? 'No rules guide your agents yet.' : `No ${kind}rules guide your agents yet.`)
    : `${live} ${kind}${live === 1 ? 'rule guides' : 'rules guide'} your agents.`;
  const waiting = typeof pending !== 'number' ? ''
    : pending === 0 ? ' Nothing is waiting for you.'
    : ` ${pending} ${pending === 1 ? 'proposal is' : 'proposals are'} waiting for you.`;
  return `${rules}${waiting}`;
}

/** The rule's type word ("Development"). */
export function ruleTypeWord(rule: SteeringRule): string {
  return STEERING_TYPE_LABELS[steeringTypeOf(rule)];
}

/** What a rule does when it fires, in a word or two (a blocking rule says so on its row). */
export function effectWord(rule: Pick<SteeringRule, 'effect'>): string | null {
  switch (rule.effect) {
    case 'deny': return 'blocks';
    case 'warn': return 'warns';
    case 'allow_with_conditions': return 'adds conditions';
    case 'allow': return 'allows';
    default: return null;
  }
}
