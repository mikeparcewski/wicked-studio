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
  | 'seat-refused'
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
    // core#1850 (core#1674): the step's OWN seat (its CLI sandbox, a read-only mount, file permissions) refused writes
    // inside the project. Keyed on the layer only: the prose is the engine's and may change.
    if (structured?.source === 'seat_refused') return 'seat-refused';
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

/**
 * studio#1384: what a seat-refused denial blocked, read off the engine's words (core `seat_refused_reason`:
 * "… refused N write(s) inside the project …: `path` (why), …, and K more. …"): "a write inside the project (a.ts)",
 * "7 writes inside the project (a.ts, b.ts, c.ts and 4 more)", or "its writes inside the project" when the words
 * name neither. At most three paths are named; the rest are counted.
 */
function blockedWrites(raw: string): string {
  const n = Number(/refused (\d+) write\(s\)/.exec(raw)?.[1] ?? NaN);
  const paths = [...raw.matchAll(/`([^`]+)` \(/g)].map((m) => m[1]!);
  const count = Number.isFinite(n) && n > 0 ? n : paths.length;
  const what = count === 0 ? 'its writes' : count === 1 ? 'a write' : `${count} writes`;
  if (paths.length === 0) return `${what} inside the project`;
  const shown = paths.slice(0, 3);
  const more = Math.max(count, paths.length) - shown.length;
  const named = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)!}`;
  return `${what} inside the project (${named})`;
}

/**
 * The session card's headline (studio#682 row 5): the step by its NAME, in plain words — never
 * "unit #N", env vars or the engine's prose (that stays in the card's Technical details).
 */
export function stepDenialHeadline(f: DenialFacts, step: string): string {
  switch (f.kind) {
    case 'sandbox-write':
      return `${step} tried to change files outside its workspace and was stopped to protect your files.`;
    case 'sandbox-read':
      return `${step} tried to read outside its workspace; the read was blocked.`;
    case 'phase-scope':
      return `${step} tried to change a kind of file this step isn't allowed to touch.`;
    case 'rule':
      return f.ruleIds.length > 0
        ? `A steering rule (${f.ruleIds.join(', ')}) stopped ${step}.`
        : `A rule stopped one of ${step}'s actions.`;
    case 'triage':
      return `${step} failed and was sent to you for review.`;
    case 'worker-failed':
      return /skills snapshot/i.test(f.raw)
        ? `${step} couldn't start: its helper's skills aren't set up on this machine.`
        : `${step} failed: its helper stopped with an error.`;
    case 'seat-refused':
      return `${step}’s own sandbox blocked ${blockedWrites(f.raw)}, so its work isn’t complete.`;
    default:
      return `${step} failed.`;
  }
}

/** The session card's advice, in plain words (studio#682 row 5). */
export function stepDenialAdvice(f: DenialFacts): string {
  switch (f.kind) {
    case 'sandbox-read':
      return 'Usually harmless: the helper adapts. If the run stopped for another reason, that is the one to chase.';
    case 'rule':
      return f.ruleIds.length > 0
        ? 'Open the rule to review it, or change what you asked for and start over.'
        : 'Look at what the step did, then change what you asked for and start over.';
    case 'worker-failed':
      return /skills snapshot/i.test(f.raw)
        ? 'Check Health, then resume. The technical details below say what was missing.'
        : 'Look at what the step did, then resume or start over.';
    case 'seat-refused':
      return 'Send the step back to try again, or reassign it to another helper.';
    default:
      return 'Look at what the step did, then resume or start over.';
  }
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
    case 'seat-refused':
      return `Unit #${ord}’s own sandbox blocked ${blockedWrites(f.raw)}, so its work isn’t complete.`;
    default:
      return `Unit #${ord} was stopped.`;
  }
}

// ── The escalation copy table (fixall L8-8E; crew #559 / F-RC1-047 = F-RC2-061) ─────────────
// `gateEscalated` carries the engine's OWN class of the failure (`condition`, wicked-core
// `actor.rs denial_class`) and the layer that denied (`denialSource`, `UnitDenial.source`). Before
// this table every escalation fell to the prose classifier above — a governance-refused `ls` read
// "tried to write outside its workspace". One table keyed by the pair, shared by the narrator feed,
// the timeline and the gate card; an unknown pair answers `known: false` and the caller keeps its
// existing wording (nothing is guessed). Every row describes a gate that IS open — each
// `gateEscalated` is followed by `awaitingHuman`.

/** The facts a row may draw on — all optional; absent ⇒ the generic form of the row. */
export interface EscalationFacts {
  ord: number | null;
  /** `gateEscalated.verdictSummary` — only its first line is ever shown. */
  verdictSummary?: string | null;
  /** `gateEscalated.restored` (evaluator_mutated_worktree): `null`/absent ⇒ unknown. */
  restored?: boolean | null;
  /** `gateEscalated.discarded.length` when the frame listed the discarded paths. */
  discardedCount?: number | null;
  /** `gateEscalated.suggestionRef` — where the discarded evaluator edit was pinned. */
  suggestionRef?: string | null;
  /** The refused command, best-first: `gateEvaluated.denial.deniedTool` → the unit's
   *  `workerToolCallDenied.command` → absent ("a command"). */
  deniedCommand?: string | null;
  /** A `boundary-read-deny:` claim marks a READ outside the workspace (appended, advisory). */
  claimId?: string | null;
  /** The unusable seat (`dead_seat`). */
  cli?: string | null;
  /** `gateEscalated.defGate` — the gate was declared by the workflow, not raised by a check. */
  defGate?: boolean | null;
  /** `gateEscalated.outputCaptured` — the unit's output was captured before the gate. */
  outputCaptured?: boolean | null;
}

export interface EscalationCopy {
  /** One plain sentence naming the class, the artifact under review and what happened. */
  headline: string;
  /** Footnotes the frame justifies (`declared by the workflow`, `output captured — view transcript`). */
  notes: string[];
  /** `true` when the (condition, denialSource) pair is one the engine emits and this table knows. */
  known: boolean;
}

/** The deterministic-floor layers `floor_failed` can name, in a person's words. */
const FLOOR_SOURCE_SENTENCE: Record<string, string> = {
  repo_checks: 'repository checks failed',
  repo_checks_timeout: 'repository checks timed out',
  pinned_validator: 'the pinned validator failed',
  substance: 'no reviewable substance was produced',
  deliverables: 'declared deliverables are missing',
};

function firstLine(text: string | null | undefined): string {
  return (text ?? '').replace(/\r/g, '').split('\n')[0]?.trim() ?? '';
}

export function escalationCopy(
  condition: string | null | undefined,
  denialSource: string | null | undefined,
  facts: EscalationFacts,
): EscalationCopy {
  const unit = `Unit #${facts.ord ?? '?'}`;
  const source = denialSource ?? '';
  const summary = firstLine(facts.verdictSummary);
  const tail = summary !== '' ? ` — ${summary}` : '';
  const notes: string[] = [];
  if (facts.defGate === true) notes.push('declared by the workflow');
  if (facts.outputCaptured === true) notes.push('output captured — view transcript');
  const known = (headline: string): EscalationCopy => ({ headline, notes, known: true });

  switch (condition) {
    case 'evaluator_mutated_worktree': {
      const n = facts.discardedCount;
      const paths = typeof n === 'number' ? ` (${n} path${n === 1 ? '' : 's'} discarded)` : '';
      const state =
        facts.restored === true
          ? `the creator's tree was restored${paths}`
          : facts.restored === false
            ? 'the tree could NOT be restored; inspect the worktree'
            : 'restore state unknown';
      const pin = facts.suggestionRef ? ` · the discarded edit is pinned at ${facts.suggestionRef}` : '';
      return known(`${unit}: the reviewer changed files it was only meant to check — ${state}${pin}`);
    }
    case 'boundary_deny': {
      // `input_governance` names the layer; `""` is the hook-veto arm whose source identity the
      // engine folded away (actor.rs) — the SAME refusal, so the same sentence.
      if (source !== 'input_governance' && source !== '') break;
      const cmd = facts.deniedCommand ? `: \`${facts.deniedCommand}\`` : '';
      const read = facts.claimId?.startsWith('boundary-read-deny:') ? ' (a read outside the workspace)' : '';
      return known(`${unit}: a command was refused by governance${cmd}${read}`);
    }
    case 'dead_seat':
      if (source !== 'dead_seat' && source !== '') break;
      return known(
        `${unit}: ${facts.cli ? `seat ${facts.cli}` : 'the seat'} is unusable (signed out / not installed) — no eligible seat remains`,
      );
    case 'floor_failed': {
      const sentence = FLOOR_SOURCE_SENTENCE[source];
      if (sentence === undefined) break;
      return known(`${unit}: ${sentence}${tail}`);
    }
    case 'verdict_not_pass':
      if (source === 'agent_validator') return known(`${unit}: the review did not pass${tail}`);
      if (source === 'worker_failure') return known(`${unit}: the worker exited before finishing${tail}`);
      if (source === 'evaluator_verdict') return known(`${unit}: the evaluator's VERDICT was not PASS${tail}`);
      // core#1850: actor.rs `denial_class` books `seat_refused` under `verdict_not_pass` (its `_` arm). The summary is the
      // engine's reason, which this sentence already says.
      if (source === 'seat_refused') return known(`${unit}: its own sandbox blocked ${blockedWrites(facts.verdictSummary ?? '')}, so its work isn’t complete`);
      break;
    default:
      break;
  }
  return {
    headline: `${unit}: ${condition && condition !== '' ? condition : 'a check'} escalated to you${tail}`,
    notes,
    known: false,
  };
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
    case 'seat-refused':
      return 'Send it back to try again, or reassign it to a different CLI.';
    default:
      return 'Check the unit transcript, then retry.';
  }
}
