import type { DecisionView, DecisionsMode } from '../api/decisions.js';
import { STEERING_TYPE_LABELS } from '../api/steering.js';

/**
 * The words under an operator's message once crew has read it (DES-DECISION-CAPTURE §3, slice
 * DC-S6). Pure: `decisionLine` maps one {@link DecisionView} (plus the daemon's mode and the
 * project's name) to exactly what the thread shows, or `null` for nothing at all.
 *
 *  - B1  auto-remembered: "✓ Remembered for Kestrel: 'Always check …' · Undo"
 *  - B2  a loose rule: one Remember chip — the derived rule, its type, "for Kestrel"; nothing is
 *        stored until the click. Under `auth=off` a clear rule arrives as this chip too (Q1).
 *  - B3  "never mind", a question, a one-off: NOTHING. The decision is still in the ledger.
 *  - B4  Undo: "Not remembered". The rule is retired (never deleted).
 *  - B6  an approval of a seat's proposal: the chip, with "You approved: …" quoted under it.
 *  - B7  a restatement: "Already in force · see it"; a maybe: "Same as your rule? · Same · New rule".
 *  - B8  decided in two projects: "You've decided this in 2 projects · Make it apply everywhere".
 *
 * The operator never sees a rule in the model's words (the statement is crew's deterministic
 * derivation), "your words" on text crew did not record from a human (every view here came from
 * crew's ledger, which records human actors only), or a project rule applied elsewhere.
 *
 * Under `WICKED_DECISIONS=ledger` nothing is drawn (crew records and labels; no chips, no auto).
 */

export type DecisionLineKind = 'remembered' | 'offer' | 'undone' | 'restated' | 'maybe-restated' | 'widen-offer' | 'conflict' | 'failed';

export interface DecisionLineModel {
  kind: DecisionLineKind;
  /** The one sentence (or the chip's label) in plain words. */
  text: string;
  /** The derived rule, as crew would remember it (edits applied); `null` when none was derived. */
  statement: string | null;
  /** "for Kestrel" / "everywhere". */
  scope: string;
  /** The steering type's label, for the chip. */
  type: string;
  /** B6: the approved proposal's text is the rule — the approval words are quoted under the chip. */
  approved: string | null;
  /** The in-force rule a restatement or conflict names, when crew knows it. */
  ruleId: string | null;
  /** The verbs the line offers, in order. */
  actions: DecisionAction[];
}

export type DecisionAction = 'remember' | 'undo' | 'dismiss' | 'same' | 'new-rule' | 'widen' | 'see';

export interface DecisionLineContext {
  mode: DecisionsMode | null;
  /** The project's display name for `project_id`, when known. */
  projectName: string | null;
}

/** The statement crew would (or did) remember: the operator's edit wins over the derivation. */
export function statementOf(d: DecisionView): string | null {
  const s = d.edits?.statement ?? d.derived.statement;
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t === '' ? null : t.endsWith('.') ? t : `${t}.`;
}

export function scopeWords(d: DecisionView, projectName: string | null): string {
  const scope = d.edits?.scope ?? d.derived.scope;
  if (scope === 'everywhere' || d.project_id === null) return 'everywhere';
  return `for ${projectName ?? 'this project'}`;
}

function typeLabel(d: DecisionView): string {
  const t = d.edits?.steering_type ?? d.derived.steering_type;
  return STEERING_TYPE_LABELS[t] ?? t;
}

/** B6: a bare approval of a seat's proposal — the words were a yes, the statement is the proposal's. */
function approvalOf(d: DecisionView): string | null {
  const words = d.origin.words.trim();
  const statement = statementOf(d);
  if (statement === null || words === '') return null;
  const yes = /^(yes|yep|yeah|ok(ay)?|sure|do (it|that)|go( ahead)?|lets? do (it|that)|let's do (it|that)|agreed|approved?|fine|sounds good)[.! ]*$/i;
  return yes.test(words) || d.origin.choice !== undefined ? words : null;
}

export function decisionLine(d: DecisionView, ctx: DecisionLineContext): DecisionLineModel | null {
  if (ctx.mode !== 'on') return null;
  const statement = statementOf(d);
  const scope = scopeWords(d, ctx.projectName);
  const base = { statement, scope, type: typeLabel(d), approved: approvalOf(d), ruleId: d.rule_id ?? d.restates_rule_id ?? d.conflicts_rule_id ?? null };

  // B3: a question, a one-off, "never mind": the ledger keeps it; the thread says nothing.
  if (d.route === 'ledger' || statement === null) return null;

  switch (d.state) {
    case 'remembered':
      return { kind: 'remembered', text: `Remembered ${scope}: ‘${statement}’`, ...base, actions: ['undo', ...(base.ruleId !== null ? ['see' as const] : [])] };
    case 'undone':
      return { kind: 'undone', text: 'Not remembered', ...base, actions: [] };
    case 'dismissed':
      return null;
    case 'widened':
      return { kind: 'remembered', text: `Remembered everywhere: ‘${statement}’`, ...base, scope: 'everywhere', actions: base.ruleId !== null ? ['see'] : [] };
    case 'landing_failed':
      return { kind: 'failed', text: `Could not remember it${d.error !== undefined ? `: ${d.error}` : ''}`, ...base, actions: ['remember'] };
    case 'restated':
      return { kind: 'restated', text: 'Already in force', ...base, actions: base.ruleId !== null ? ['see'] : [] };
    default:
      break;
  }

  // Not yet answered (`recorded` under `on`, or `offered` with its proposal filed).
  if (d.route === 'conflict') {
    return { kind: 'conflict', text: 'This contradicts a rule in force', ...base, actions: [...(base.ruleId !== null ? ['see' as const] : []), 'remember', 'dismiss'] };
  }
  if (d.route === 'maybe-restated') {
    return { kind: 'maybe-restated', text: 'Same as your rule?', ...base, actions: ['same', 'new-rule', ...(base.ruleId !== null ? ['see' as const] : [])] };
  }
  if (d.route === 'restated') {
    return { kind: 'restated', text: 'Already in force', ...base, actions: base.ruleId !== null ? ['see'] : [] };
  }
  if (d.widen !== undefined && d.widen.projects.length >= 2) {
    return { kind: 'widen-offer', text: `You’ve decided this in ${d.widen.projects.length} projects`, ...base, actions: ['widen', 'remember', 'dismiss'] };
  }
  // B2 / B6 (and an `auto` route that crew could not auto-land, e.g. auth=off): one Remember chip.
  return { kind: 'offer', text: 'Remember', ...base, actions: ['remember', 'dismiss'] };
}

/** B9: the Desk's one sentence about rules remembered since the operator last looked. */
export function deskRuleSentence(
  remembered: readonly DecisionView[],
  sinceMs: number | null,
  projectName: (id: string | null) => string | null,
): { text: string; ruleId: string | null } | null {
  const fresh = remembered.filter((d) => d.state === 'remembered' && (sinceMs === null || d.at >= sinceMs));
  if (fresh.length === 0) return null;
  const newest = fresh.reduce((a, b) => (b.at > a.at ? b : a));
  const projects = new Set(fresh.map((d) => d.project_id));
  if (fresh.length === 1) {
    const scope = scopeWords(newest, projectName(newest.project_id));
    return { text: `One new rule ${scope}, from your words`, ruleId: newest.rule_id ?? null };
  }
  const where = projects.size === 1 ? ` ${scopeWords(newest, projectName(newest.project_id))}` : ` across ${projects.size} projects`;
  return { text: `${fresh.length} new rules${where}, from your words`, ruleId: newest.rule_id ?? null };
}

/** B12: the Needs You row of a decision's review proposal — the rule in the operator's words. */
export function decisionRowText(statement: string | null, type: string | null): string {
  const what = type !== null ? `a ${type} rule` : 'a rule';
  return statement !== null && statement !== ''
    ? `From your words — Remember lands ${what}: ‘${statement}’`
    : `From your words — Remember lands ${what}`;
}
