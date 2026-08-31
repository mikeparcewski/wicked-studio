/**
 * denialCopy — turns an engine denial into words a person can act on (usability review Top-10 #1:
 * the failure banner read "input governance denied a tool-call in unit-2 (claim boundary-deny:unit-2)").
 *
 * Two inputs, best-first: the STRUCTURED denial that wicked-core-ts ≥ 0.7.6 attaches to rejected
 * units and gateEvaluated events ({source, claim_id/claimId, rule_ids/ruleIds}), and — for every
 * engine before it — the known prose spellings of `denial_reason`. The raw prose always survives
 * as the "engine detail" line; this module only decides the HEADLINE and the ADVICE.
 *
 * Claim-id vocabulary (wicked-core gate_hook.rs): `boundary-deny:` = a WRITE outside the unit's
 * sandbox (unit-fatal), `boundary-read-deny:` = a blocked read (advisory), phase-scope denies are
 * stamped by the `wicked-governance-phase-scope` evaluator and carry an `engine:` rule id.
 */

/** The structured denial as 0.7.6+ engines spell it (either casing survives the wire). */
export interface StructuredDenial {
  source?: string;
  claim_id?: string;
  claimId?: string;
  rule_ids?: string[];
  ruleIds?: string[];
}

export type DenialKind =
  | 'sandbox-write'
  | 'sandbox-read'
  | 'phase-scope'
  | 'rule'
  | 'triage'
  | 'worker-failed'
  | 'unknown';

export interface DenialFacts {
  kind: DenialKind;
  /** Steering/policy rule ids worth linking (engine-owned `engine:*` ids are named, not linked). */
  ruleIds: string[];
  claimId: string | null;
  /** The engine's own prose, verbatim — the banner's dim "engine detail" line. */
  raw: string;
}

const CLAIM_IN_PROSE = /\(claim ([^)]+)\)/;

/** Rule ids that name a real steering/policy row a drawer can open (never engine-internal ids). */
function linkable(ids: string[]): string[] {
  return ids.filter((id) => id.length > 0 && !id.startsWith('engine:'));
}

export function parseDenial(raw: string | null | undefined, structured?: StructuredDenial | null): DenialFacts {
  const text = raw ?? '';
  const claimId =
    structured?.claim_id ?? structured?.claimId ?? CLAIM_IN_PROSE.exec(text)?.[1] ?? null;
  const ruleIds = linkable(structured?.rule_ids ?? structured?.ruleIds ?? []);

  const kind: DenialKind = (() => {
    if (claimId?.startsWith('boundary-read-deny:')) return 'sandbox-read';
    if (claimId?.startsWith('boundary-deny:')) return 'sandbox-write';
    if (claimId?.startsWith('phase-scope') || text.includes('phase-scope')) return 'phase-scope';
    if (structured?.source === 'phase-scope') return 'phase-scope';
    if (ruleIds.length > 0) return 'rule';
    if (text.startsWith('triage escalation:')) return 'triage';
    if (text.startsWith('Worker FAILED')) return 'worker-failed';
    if (text.includes('denied a tool-call') || claimId !== null) return 'rule';
    return text.length > 0 ? 'unknown' : 'unknown';
  })();

  return { kind, ruleIds, claimId, raw: text };
}

/** One plain sentence saying what stopped the unit. */
export function denialHeadline(f: DenialFacts, ord: number): string {
  switch (f.kind) {
    case 'sandbox-write':
      return `Unit #${ord} tried to write outside its workspace and was stopped to protect your files.`;
    case 'sandbox-read':
      return `Unit #${ord} tried to read outside its workspace — the read was blocked.`;
    case 'phase-scope':
      return `Unit #${ord} tried to change a kind of file this phase isn't allowed to touch.`;
    case 'rule':
      return f.ruleIds.length > 0
        ? `A steering rule (${f.ruleIds.join(', ')}) stopped unit #${ord}.`
        : `Governance stopped one of unit #${ord}'s actions.`;
    case 'triage':
      return `Unit #${ord} failed and was escalated for review.`;
    case 'worker-failed':
      return `The worker failed on unit #${ord}.`;
    default:
      return `Unit #${ord} was stopped.`;
  }
}

/** One plain sentence saying what to do about it. */
export function denialAdvice(f: DenialFacts): string {
  switch (f.kind) {
    case 'sandbox-write':
    case 'phase-scope':
      return 'Check the unit transcript to see what it attempted, then retry — amend the intent if the attempt was off-course.';
    case 'sandbox-read':
      return 'Usually harmless — the worker adapts. If the run failed for another reason, that reason is the one to chase.';
    case 'rule':
      return f.ruleIds.length > 0
        ? 'Open the rule to review (or retire) it, or amend the intent and retry.'
        : 'Check the unit transcript for the denied action, then amend the intent and retry.';
    case 'triage':
      return 'Read the failure output in the transcript, then retry — or reassign the unit to a different CLI.';
    case 'worker-failed':
      return 'Read the failure output in the transcript, then retry.';
    default:
      return 'Check the unit transcript, then retry.';
  }
}
