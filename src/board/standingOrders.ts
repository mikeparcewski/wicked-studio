import type { AuditEntry } from '../api/types.js';
import type { StandingOrder, StandingOrderRule } from '../api/standingOrders.js';

/**
 * STANDING ORDERS (Studio OS behaviour 10) — the pure half.
 *
 * Four jobs, all words:
 *  - say a parsed rule back in plain words so the person confirms what the daemon will actually do
 *    (never the seat's paraphrase of their words) — including the band / preset orders the gate
 *    card's "make it a rule" (idea 8) and the trust receipt (idea 13) create;
 *  - preview what the Away switch will do, from the orders in force, BEFORE it is flipped;
 *  - say where an order came from (a gate's "make it a rule", the trust receipt, or your words);
 *  - turn an order's audit entry into the handover's line — which always NAMES the order.
 *
 * Crew's invariant is stated, never re-decided here: an order never answers a deliver gate or a
 * high-risk plan approval, and a message an order writes is only ever queued.
 */

/** The plan-approval phase a trust receipt names (crew `PLAN_APPROVAL_PHASE`). */
const PLAN_APPROVAL = 'plan_approval';

/** What stays with the person whatever the orders say (crew's invariant, in words). */
export const ORDER_INVARIANT =
  'No order answers a deliver gate or a high-risk plan approval. A message an order writes is queued, never sent.';

/** "0-19" → "band 0-19 (LOW)"; a band topping out at 40 or above keeps its bare name. */
export function bandWords(band: string): string {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(band.trim());
  return m !== null && Number(m[2]) < 40 ? `band ${band} (LOW)` : `band ${band}`;
}

type ProjectName = (id: string) => string | undefined;

function whereWords(rule: StandingOrderRule, projectName: ProjectName): string {
  return rule.scope.kind === 'all' ? 'every project' : (projectName(rule.scope.projectId) ?? rule.scope.projectId);
}

/** The "what" of a rule: "the intake gate", "band 0-19 (LOW) unit reviews", "a HIGH finding". */
function whatWords(rule: StandingOrderRule): string {
  const t = rule.trigger;
  if (t.kind === 'finding') return t.severity === '*' ? 'any finding' : `a ${t.severity.toUpperCase()} finding`;
  const from = t.preset !== undefined ? ` from the ${t.preset} preset` : '';
  if (t.phase === PLAN_APPROVAL) {
    return `the plan of runs${from}${t.band !== undefined ? ` scoring ${bandWords(t.band)}` : ''}`;
  }
  if (t.band !== undefined) {
    const phase = t.phase === '*' ? 'unit reviews' : `${t.phase} reviews`;
    return `${bandWords(t.band)} ${phase}${from}`;
  }
  // An approve on '*' can only ever answer a unit review (crew's invariant) — say so, not "every gate".
  if (t.phase === '*') return rule.action === 'approve' ? `every unit review${from}` : `every gate${from}`;
  return `the ${t.phase} gate${from}`;
}

const VERB: Record<StandingOrderRule['action'], string> = {
  approve: 'approve',
  hold: 'hold',
  notify: 'queue a message for you on',
};

/** "While you are away: approve the intake gate on project Alpha". */
export function ruleWords(rule: StandingOrderRule, projectName: ProjectName): string {
  const when = rule.activeWhen === 'away' ? 'While you are away' : 'Always';
  const tail = rule.action === 'hold' && rule.trigger.kind === 'gate' ? ' for you' : '';
  const where = rule.scope.kind === 'all' ? 'every project' : `project ${whereWords(rule, projectName)}`;
  return `${when}: ${VERB[rule.action]} ${whatWords(rule)}${tail} on ${where}`;
}

/** The short "will …" clause the Away preview lists for one order. */
function willWords(rule: StandingOrderRule, projectName: ProjectName): string {
  const verb = rule.action === 'notify' ? 'queue a message on' : rule.action;
  return `will ${verb} ${whatWords(rule)} on ${whereWords(rule, projectName)}`;
}

/** Where an order came from: a gate's "make it a rule" (idea 8), the trust receipt (idea 13), or words. */
export type OrderOrigin = 'gate' | 'receipt' | 'words';

export function orderOrigin(o: StandingOrder): OrderOrigin {
  const t = o.rule.trigger;
  if (t.kind !== 'gate' || o.rule.action !== 'approve' || o.rule.activeWhen !== 'always') return 'words';
  if (t.phase === PLAN_APPROVAL && t.preset !== undefined && t.band !== undefined) return 'receipt';
  if (t.phase === '*' && t.band !== undefined && o.rule.scope.kind === 'project') return 'gate';
  return 'words';
}

export const ORIGIN_LABEL: Record<OrderOrigin, string> = {
  gate: 'made at a gate',
  receipt: 'trust receipt',
  words: 'in your words',
};

/**
 * What the Away switch will do, from the orders in force — shown BEFORE it is flipped:
 * "3 orders active: will approve band 0-19 (LOW) unit reviews on Northwind; will hold the deliver
 * gate on every project; deliver gates always wait". Every order is active while away (an
 * `always` order is active now too). With none, it says every gate waits.
 */
export function awayPreview(orders: readonly StandingOrder[], projectName: ProjectName): string {
  if (orders.length === 0) return 'No orders: every gate waits for you while you are away';
  const n = orders.length;
  const clauses = orders.map((o) => willWords(o.rule, projectName));
  const queued = orders.some((o) => o.rule.action === 'notify') ? '; messages are queued, never sent' : '';
  return `${n} ${n === 1 ? 'order' : 'orders'} active: ${clauses.join('; ')}${queued}; deliver gates always wait`;
}

function orderOf(e: AuditEntry): { id: string; text: string } | undefined {
  if (e.actor?.kind !== 'system' || typeof e.actor.id !== 'string' || !e.actor.id.startsWith('standing-order:')) return undefined;
  const o = (e.detail ?? {})['standingOrder'] as { id?: unknown; text?: unknown } | undefined;
  return typeof o?.text === 'string' ? { id: String(o.id ?? ''), text: o.text } : undefined;
}

/** The handover's line for an action a standing order took, or undefined for any other entry. */
export function standingOrderActionText(e: AuditEntry): string | undefined {
  const o = orderOf(e);
  if (o === undefined) return undefined;
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const named = `Standing order "${o.text}"`;
  switch (e.action) {
    case 'gate.decided':
      return d['approve'] === true ? `${named} approved a gate for you` : `${named} answered a gate for you`;
    case 'standing-order.held':
      return typeof d['phase'] === 'string' && d['phase'] !== ''
        ? `${named} held the ${d['phase']} gate for you`
        : typeof d['severity'] === 'string'
          ? `${named} held a ${d['severity'].toUpperCase()} finding for you`
          : `${named} held a gate for you`;
    case 'standing-order.notified':
      return `${named} queued a message (not sent)${typeof d['text'] === 'string' ? `: ${d['text']}` : ''}`;
    default:
      return undefined;
  }
}
