import type { DecidedGate, StandingOrder, StandingOrderRule } from '../api/gateHistory.js';

/**
 * Trust at the gate (brainstorm-actionable ideas 7 and 8). Pure: the decided-gate history
 * (`GET /gates/decided`) and the orders in force (`GET /standing-orders`) in, words and a rule out.
 *
 *  - Idea 7, the track record: the creator seat's recent record on this kind of step, shown as
 *    neutral text on the button the card leads with. It never changes which move is recommended.
 *  - Idea 8, make it a rule: after the person made the same decision (approve) on the last 3 alike
 *    gates (a phase-review gate an order could approve, same project, same plan band), offer
 *    "Always approve band <b> unit reviews on <project>?" with what the order would have done over
 *    the last 14 days. The deliver gate and every plan approval are never offered: crew's invariant
 *    (an order approves only `def` / `run_level` / `terminal` gates), mirrored here so the offer
 *    cannot even be drawn for them.
 */

/** The gate kinds a standing order may approve (crew `APPROVABLE_GATE_KINDS`). */
export const ORDER_APPROVABLE_KINDS: ReadonlySet<string> = new Set(['def', 'run_level', 'terminal']);
/** How many recent decisions a seat's record counts. */
export const RECORD_SPAN = 10;
/** How many alike approvals in a row make the offer. */
export const ALIKE_RUN = 3;
/** The preview's window. */
export const PREVIEW_DAYS = 14;
/** How far back the history is read (the record's reach). */
export const HISTORY_DAYS = 30;
const DAY = 86_400_000;

/** A seat's record on one kind of step, over its most recent person-made decisions. */
export interface SeatRecord {
  seat: string;
  phase: string | null;
  total: number;
  approved: number;
  sentBack: number;
  rejected: number;
}

/**
 * The seat's record on `phase`: the newest `RECORD_SPAN` decisions a PERSON made at gates that
 * judged this seat's work on this kind of step. An order's approval is not a judgement of the
 * work, so it is left out. `null` when the seat has no such decision yet.
 */
export function seatRecord(gates: readonly DecidedGate[], seat: string, phase: string | null): SeatRecord | null {
  const mine = gates
    .filter((g) => !g.byOrder && g.creator !== null && g.creator.seat === seat && g.creator.phase === phase)
    // The deliver gate judges the push and a plan gate the plan, not the step's work.
    .filter((g) => g.decision !== 'edit_plan' && g.gateKind !== 'deliver' && g.gateKind !== 'plan_approval')
    .sort((a, b) => b.decidedAt - a.decidedAt)
    .slice(0, RECORD_SPAN);
  if (mine.length === 0) return null;
  return {
    seat,
    phase,
    total: mine.length,
    approved: mine.filter((g) => g.decision === 'approve').length,
    sentBack: mine.filter((g) => g.decision === 'request_changes').length,
    rejected: mine.filter((g) => g.decision === 'reject').length,
  };
}

/** `claude: 8/10 approvals held · 2 sent back` (a rejection count only when there is one). */
export function recordLabel(r: SeatRecord): string {
  const parts = [`${r.seat}: ${r.approved}/${r.total} approvals held`, `${r.sentBack} sent back`];
  if (r.rejected > 0) parts.push(`${r.rejected} rejected`);
  return parts.join(' · ');
}

/** The band the run's accepted plan landed in (`session.team_plan.accepted.band`), or `null`. */
export function runBandOf(session: unknown): string | null {
  const plan = (session as { team_plan?: { accepted?: { band?: unknown } | null } | null } | null)?.team_plan;
  const band = plan?.accepted?.band;
  return typeof band === 'string' && band !== '' ? band : null;
}

/** What the card knows about the gate it holds, for the offer. */
export interface GateTrustFacts {
  projectId: string | null;
  projectName: string | null;
  band: string | null;
  /** The engine's gate kind off the live frame, when the card has it. */
  gateKind: string | null;
  /** The card's own readings: a plan gate, the deliver gate, an escalation (retry / send back). */
  isPlanGate: boolean;
  isDeliverGate: boolean;
  isEscalation: boolean;
  /** A steering-author run's approval lands doctrine: never an order's. */
  landsDoctrine: boolean;
}

/** Whether an order could approve this gate: crew's invariant, read from what the card knows. */
export function gateOrderable(f: GateTrustFacts): boolean {
  if (f.isPlanGate || f.isDeliverGate || f.isEscalation || f.landsDoctrine) return false;
  if (f.gateKind === 'deliver' || f.gateKind === 'plan_approval') return false;
  return f.gateKind === null || ORDER_APPROVABLE_KINDS.has(f.gateKind);
}

/** What the order would have done over the preview window. */
export interface RulePreview {
  days: number;
  /** Alike gates decided in the window: every one the order would have approved. */
  wouldApprove: number;
  youApproved: number;
  youSentBack: number;
  youRejected: number;
  /** Already answered by another order. */
  byOrders: number;
  /** Decided by another person. */
  byOthers: number;
}

export interface RuleOffer {
  /** The question on the card. */
  question: string;
  /** Why it is offered. */
  because: string;
  /** The order's text (its plain words, kept with the rule). */
  text: string;
  rule: StandingOrderRule;
  preview: RulePreview;
  /** The preview in words, including that it answers this gate too. */
  previewText: string;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function alike(g: DecidedGate, projectId: string, band: string): boolean {
  return g.orderApprovable && g.projectId === projectId && g.band === band
    && g.gateKind !== 'deliver' && g.gateKind !== 'plan_approval' && g.phase !== 'deliver';
}

/** An approve order in force already covers this project and band (so nothing is offered). */
export function orderCovers(orders: readonly StandingOrder[], projectId: string, band: string): boolean {
  return orders.some((o) =>
    o.rule.action === 'approve' && o.rule.activeWhen === 'always' && o.rule.trigger.kind === 'gate'
    && o.rule.trigger.phase === '*'
    && (o.rule.trigger.band === undefined || o.rule.trigger.band === band)
    && (o.rule.scope.kind === 'all' || o.rule.scope.projectId === projectId));
}

/**
 * The "make it a rule" offer for this gate, or `null`. Offered only on a gate an order could
 * approve, of a run with a project and a scored band, when the person's last `ALIKE_RUN` decisions
 * on alike gates were all approvals and no order in force already covers them.
 */
export function ruleOffer(
  gates: readonly DecidedGate[],
  orders: readonly StandingOrder[],
  facts: GateTrustFacts,
  now: number,
  /** The actor this studio acts as: only YOUR decisions make the offer. `null` = unknown (any person). */
  me: string | null = null,
): RuleOffer | null {
  const { projectId, band } = facts;
  if (projectId === null || band === null || !gateOrderable(facts)) return null;
  if (orderCovers(orders, projectId, band)) return null;
  const mine = gates.filter((g) => alike(g, projectId, band));
  const yours = (g: DecidedGate): boolean => !g.byOrder && (me === null || g.actor === me);
  const byPerson = mine.filter(yours).sort((a, b) => b.decidedAt - a.decidedAt).slice(0, ALIKE_RUN);
  if (byPerson.length < ALIKE_RUN || byPerson.some((g) => g.decision !== 'approve')) return null;

  const since = now - PREVIEW_DAYS * DAY;
  const inWindow = mine.filter((g) => g.decidedAt >= since);
  const preview: RulePreview = {
    days: PREVIEW_DAYS,
    wouldApprove: inWindow.length,
    youApproved: inWindow.filter((g) => yours(g) && g.decision === 'approve').length,
    youSentBack: inWindow.filter((g) => yours(g) && g.decision === 'request_changes').length,
    youRejected: inWindow.filter((g) => yours(g) && g.decision === 'reject').length,
    byOrders: inWindow.filter((g) => g.byOrder).length,
    byOthers: inWindow.filter((g) => !g.byOrder && !yours(g)).length,
  };
  const project = facts.projectName ?? projectId;
  const these = `band ${band} unit reviews`;
  const decidedBy = [
    `you approved ${preview.youApproved}`,
    ...(preview.youSentBack > 0 ? [`sent ${preview.youSentBack} back`] : []),
    ...(preview.youRejected > 0 ? [`rejected ${preview.youRejected}`] : []),
    ...(preview.byOthers > 0 ? [`${preview.byOthers} decided by someone else`] : []),
    ...(preview.byOrders > 0 ? [`${preview.byOrders} already answered by an order`] : []),
  ].join(', ');
  return {
    question: `Always approve ${these} on ${project}?`,
    because: `You approved the last ${ALIKE_RUN} ${these} on ${project}.`,
    text: `Always approve ${these} on ${project}`,
    rule: {
      scope: { kind: 'project', projectId },
      trigger: { kind: 'gate', phase: '*', band },
      action: 'approve',
      activeWhen: 'always',
    },
    preview,
    previewText:
      `Last ${PREVIEW_DAYS} days: it would have approved ${plural(preview.wouldApprove, 'gate')} (${decidedBy}). `
      + 'It also approves this gate now. Deliver and plan gates still wait for you.',
  };
}
