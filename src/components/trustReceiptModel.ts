import type { StandingOrder, StandingOrderRule } from '../api/gateHistory.js';

/**
 * The trust receipt (brainstorm-actionable idea 13): the Insights panel's "Trust this route for
 * low-risk runs like this". Pure: the run's facts and the orders in force in, one offer (or the
 * order already in force, or nothing) out.
 *
 * The receipt is ONE standing order (wicked-crew#693, on #691's band-limited orders): approve the
 * `plan_approval` gate of runs in this project, launched from this preset, whose plan scored band
 * 0-19. Crew refuses anything wider, re-reads the open plan gate's own band and risk before it
 * answers, and never answers the deliver gate — so the offer can say exactly that and nothing more.
 */

/** The only band whose plan approval can be trusted: the lowest. */
export const TRUSTED_BAND = '0-19';
export const PLAN_APPROVAL = 'plan_approval';

export interface TrustReceiptFacts {
  projectId: string | null;
  projectName: string | null;
  /** The preset the launch named (`team_plan.preset`) — crew matches on exactly this. */
  preset: string | null;
  /** The band the run's accepted plan landed in (`team_plan.accepted.band`). */
  band: string | null;
  /** The accepted plan's high-risk flag; `null` when the run does not say. */
  highRisk: boolean | null;
  /** A steering-author run's approvals land doctrine: never an order's. */
  landsDoctrine: boolean;
  /** This run is paused at a plan gate right now (the create sweep would approve it). */
  atPlanGate: boolean;
}

export interface TrustReceiptOffer {
  kind: 'offer';
  question: string;
  /** Shown before the button: what the order does, and what it never does. */
  consequence: string;
  /** The order's own words. */
  text: string;
  rule: StandingOrderRule & { trigger: { kind: 'gate'; phase: string; band: string; preset: string } };
}

export interface TrustReceiptInForce {
  kind: 'trusted';
  order: StandingOrder;
}

/** The order in force that already trusts this route, if any. */
export function receiptInForce(
  orders: readonly StandingOrder[],
  projectId: string,
  preset: string,
): StandingOrder | null {
  return orders.find((o) => {
    const t = o.rule.trigger;
    return o.rule.action === 'approve' && o.rule.activeWhen === 'always' && t.kind === 'gate'
      && t.phase === PLAN_APPROVAL && t.band === TRUSTED_BAND && t.preset === preset
      && o.rule.scope.kind === 'project' && o.rule.scope.projectId === projectId;
  }) ?? null;
}

/**
 * The receipt for this run: `null` unless the run is a low-risk run crew could trust (a project, a
 * preset, an accepted plan at band 0-19 that is not high risk, no doctrine); the order in force
 * when one already covers it; else the offer.
 */
export function trustReceipt(
  f: TrustReceiptFacts,
  orders: readonly StandingOrder[],
): TrustReceiptOffer | TrustReceiptInForce | null {
  if (f.projectId === null || f.preset === null || f.band !== TRUSTED_BAND) return null;
  if (f.highRisk === true || f.landsDoctrine) return null;
  const held = receiptInForce(orders, f.projectId, f.preset);
  if (held !== null) return { kind: 'trusted', order: held };
  const project = f.projectName ?? f.projectId;
  const now = f.atPlanGate ? ' It also approves this run\'s open plan gate now.' : '';
  return {
    kind: 'offer',
    question: 'Trust this route for low-risk runs like this',
    consequence:
      `Runs on ${project} from the ${f.preset} preset whose plan scores band ${TRUSTED_BAND} skip plan approval. `
      + `The deliver gate stays manual, and every other gate still waits for you.${now}`,
    text: `Trust ${f.preset} runs on ${project} at band ${TRUSTED_BAND}: skip plan approval (deliver stays manual)`,
    rule: {
      scope: { kind: 'project', projectId: f.projectId },
      trigger: { kind: 'gate', phase: PLAN_APPROVAL, band: TRUSTED_BAND, preset: f.preset },
      action: 'approve',
      activeWhen: 'always',
    },
  };
}

/** The run's facts off its DTO (`team_plan` rides `GET /runs/:id` from api-types 0.46.0 on). */
export function receiptFactsOf(
  session: { project_id?: unknown; workflow_id?: unknown; team_plan?: unknown },
  projectName: string | null,
  atPlanGate: boolean,
): TrustReceiptFacts {
  const plan = session.team_plan as { preset?: unknown; accepted?: { band?: unknown; high_risk?: unknown } | null } | null | undefined;
  const pid = session.project_id;
  return {
    projectId: typeof pid === 'string' && pid !== '' && pid !== 'default' ? pid : null,
    projectName,
    preset: typeof plan?.preset === 'string' && plan.preset !== '' ? plan.preset : null,
    band: typeof plan?.accepted?.band === 'string' && plan.accepted.band !== '' ? plan.accepted.band : null,
    highRisk: typeof plan?.accepted?.high_risk === 'boolean' ? plan.accepted.high_risk : null,
    landsDoctrine: session.workflow_id === 'steering-author',
    atPlanGate,
  };
}
