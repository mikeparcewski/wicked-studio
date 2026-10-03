import type { Consideration } from '../api/considered.js';
import type { DecisionView } from '../api/decisions.js';
import { STEERING_TYPE_LABELS, steeringTypeOf, type SteeringRule } from '../api/steering.js';
import { sessionPath } from './sessionModel.js';

/**
 * The rule page's words (DES-DECISION-CAPTURE §3 B11, slice DC-S8): scope and effect as one
 * sentence, ORIGIN, history, and "Where it was considered". Pure.
 *
 *  - ORIGIN comes ONLY from crew's ledger ({@link DecisionView}): the decision whose landed rule is
 *    this one. A rule with no decision has no ORIGIN — doc-ingested and UI-authored rules say where
 *    they came from through their provenance, and nothing here invents "your words" for them (G4).
 *  - History is the decisions' outcomes in time order: remembered (how), undone, widened, restated.
 *  - "Where it was considered" is read from the Considerations studio holds: every turn or step
 *    whose considered, cited or set-aside list names the rule. The daemon keeps no index of this
 *    (the `rule.considered` fact carries counts, never ids), so the list is what has been read.
 */

export function ruleSentence(rule: SteeringRule, projectName: string | null): string {
  const type = STEERING_TYPE_LABELS[steeringTypeOf(rule)] ?? steeringTypeOf(rule);
  const project = rule.targets.project;
  const scope = project !== undefined && project !== '' ? `for ${projectName ?? project}` : 'everywhere';
  const lead = `A ${type} rule ${scope}`;
  let effect: string;
  switch (rule.effect) {
    case 'deny': effect = 'blocks a gate when it fires'; break;
    case 'allow_with_conditions': {
      const obl = rule.obligations ?? [];
      effect = obl.length > 0 ? `holds work to it: ${obl.join(', ')}` : 'allows with obligations when it fires';
      break;
    }
    case 'allow': effect = 'allows outright when it fires'; break;
    case undefined: effect = 'helpers are told about it when it applies; it never blocks'; break;
    default: effect = `${String(rule.effect)} when it fires`; break;
  }
  const body = `${lead} — ${effect}.`;
  return rule.retired === true ? `Retired. ${body}` : body;
}

export type OriginWhere =
  | { kind: 'chat'; chatId: string; turnId: string | null; href: string }
  | { kind: 'run'; runId: string; ord: number | null; href: string }
  | { kind: 'gate'; runId: string | null; gateId: string; href: string | null }
  | { kind: 'elicitation'; runId: string | null; elicitationId: string; href: string | null };

export interface RuleOriginModel {
  decisionId: string;
  /** The verbatim words (masked where a secret was found — then `redacted`). */
  words: string;
  redacted: boolean;
  /** A bare approve/reject or a picked option, when there were no words. */
  choice: string | null;
  actor: string;
  /** Epoch ms. */
  at: number;
  where: OriginWhere | null;
  how: 'auto' | 'chip' | 'needs-you' | null;
  authMode: 'off' | 'required';
  /** The statement edited at Remember, when the operator changed it (the words above are kept). */
  edited: string | null;
  /** The words were a typed approval of a seat's proposal (B6): the rule is the proposal's text. */
  approvedProposal: boolean;
}

const RULE_STATES = new Set<DecisionView['state']>(['remembered', 'undone', 'widened', 'landing_failed']);

/** The decision that landed (or tried to land) this rule, newest first. */
export function originDecisions(rule: SteeringRule, decisions: readonly DecisionView[]): DecisionView[] {
  return decisions
    .filter((d) => d.rule_id === rule.id && RULE_STATES.has(d.state))
    .sort((a, b) => b.at - a.at);
}

function whereOf(d: DecisionView): OriginWhere | null {
  const o = d.origin;
  if (o.chat_id !== undefined) return { kind: 'chat', chatId: o.chat_id, turnId: o.turn_id ?? null, href: sessionPath(o.chat_id) };
  if (o.gate_id !== undefined) return { kind: 'gate', runId: o.run_id ?? null, gateId: o.gate_id, href: o.run_id !== undefined ? sessionPath(`run:${o.run_id}`) : null };
  if (o.elicitation_id !== undefined) return { kind: 'elicitation', runId: o.run_id ?? null, elicitationId: o.elicitation_id, href: o.run_id !== undefined ? sessionPath(`run:${o.run_id}`) : null };
  if (o.run_id !== undefined) return { kind: 'run', runId: o.run_id, ord: o.ord ?? null, href: sessionPath(`run:${o.run_id}`) };
  return null;
}

const YES = /^(yes|yep|yeah|ok(ay)?|sure|do (it|that)|go( ahead)?|lets? do (it|that)|let's do (it|that)|agreed|approved?|fine|sounds good)[.! ]*$/i;

export function ruleOrigin(rule: SteeringRule, decisions: readonly DecisionView[]): RuleOriginModel | null {
  const d = originDecisions(rule, decisions)[0];
  if (d === undefined) return null;
  const words = d.origin.words.trim();
  return {
    decisionId: d.id,
    words,
    redacted: d.origin.redacted,
    choice: d.origin.choice ?? null,
    actor: d.origin.actor.id,
    at: d.at,
    where: whereOf(d),
    how: d.how ?? null,
    authMode: d.origin.auth_mode,
    edited: d.edits?.statement !== undefined && d.edits.statement.trim() !== '' && d.edits.statement.trim() !== (d.derived.statement ?? '').trim() ? d.edits.statement.trim() : null,
    approvedProposal: words !== '' && YES.test(words),
  };
}

export interface HistoryRow {
  at: number;
  text: string;
  /** The decision the row came from, for a link to where it happened. */
  href: string | null;
}

const HOW_WORDS: Record<NonNullable<DecisionView['how']>, string> = {
  auto: 'remembered on the spot from your words',
  chip: 'remembered when you clicked Remember',
  'needs-you': 'remembered from Needs You',
};

/** The rule's outcomes in time order, from every decision that names it. */
export function ruleHistory(rule: SteeringRule, decisions: readonly DecisionView[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const d of decisions) {
    const href = whereOf(d)?.href ?? null;
    if (d.rule_id === rule.id) {
      switch (d.state) {
        case 'remembered':
          rows.push({ at: d.at, text: `Remembered — ${d.how !== undefined ? HOW_WORDS[d.how] : 'from your words'}`, href });
          break;
        case 'undone':
          rows.push({ at: d.at, text: 'Remembered from your words, then undone — retired, never deleted', href });
          break;
        case 'widened':
          rows.push({ at: d.at, text: 'Made to apply everywhere', href });
          break;
        case 'landing_failed':
          rows.push({ at: d.at, text: `Could not be remembered${d.error !== undefined ? `: ${d.error}` : ''}`, href });
          break;
        default:
          break;
      }
      if (d.edits?.statement !== undefined && d.edits.statement.trim() !== '') {
        rows.push({ at: d.at, text: 'Edited at Remember — your original words are kept above', href });
      }
    }
    if (d.restates_rule_id === rule.id && d.state === 'restated') {
      rows.push({ at: d.at, text: 'Restated in your words — already in force, so nothing new was remembered', href });
    }
    if (d.conflicts_rule_id === rule.id) {
      rows.push({ at: d.at, text: d.state === 'remembered' ? 'A later decision contradicted it and was remembered' : 'A later decision contradicted it', href });
    }
  }
  if ((rule.supersedes?.length ?? 0) > 0) {
    rows.push({ at: 0, text: `Replaces ${(rule.supersedes ?? []).join(', ')}`, href: null });
  }
  return rows.sort((a, b) => a.at - b.at);
}

export interface WhereRow {
  key: string;
  kind: 'chat' | 'unit';
  /** "A conversation" / "<run> · step 2". */
  label: string;
  verdict: 'considered' | 'cited' | 'set-aside';
  href: string;
  /** The step, for the sheet (`step:<run>:<ord>`). */
  object: string | null;
}

export interface WhereContext {
  runTitle: (runId: string) => string | null;
  stepName: (runId: string, ord: number) => string | null;
}

/** Everything studio has read that names the rule — newest key last, so the rows read in time order. */
export function whereConsidered(ruleId: string, considerations: readonly Consideration[], ctx: WhereContext): WhereRow[] {
  const rows: WhereRow[] = [];
  for (const c of considerations) {
    const verdict: WhereRow['verdict'] = c.cited.some((x) => x.id === ruleId && x.status === 'unchecked') ? 'cited'
      : c.considered.some((r) => r.id === ruleId) ? 'considered'
        : c.set_aside.some((s) => s.id === ruleId) ? 'set-aside' : 'considered';
    if (c.subject.kind === 'chat') {
      rows.push({ key: c.key, kind: 'chat', label: 'A conversation', verdict, href: sessionPath(c.subject.chat_id), object: null });
    } else {
      const title = ctx.runTitle(c.subject.run_id);
      const step = ctx.stepName(c.subject.run_id, c.subject.ord) ?? `step ${c.subject.ord + 1}`;
      rows.push({
        key: c.key, kind: 'unit', label: `${title ?? 'A run'} · ${step}`, verdict,
        href: sessionPath(`run:${c.subject.run_id}`), object: `step:${c.subject.run_id}:${c.subject.ord}`,
      });
    }
  }
  return rows;
}

export const WHERE_VERDICT_WORDS: Record<WhereRow['verdict'], string> = {
  considered: 'considered', cited: 'cited — unchecked', 'set-aside': 'set aside',
};
