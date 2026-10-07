import type { CoreEvent, RosterSeat, WorkUnit } from '../api/types.js';
import type { OpenGate } from '../store/gates.js';
import { classifyRowGate } from './questionRow.js';
import {
  escalationSummaryFor,
  failingItems,
  findingsNote,
  recommendGateMove,
} from '../components/gateMoveModel.js';
import {
  checkOutcome,
  escalationOffers,
  failedSeatOf,
  isEscalationGate,
  isLaunchRefusal,
  isOfferable,
  isSeatFailure,
  gateVerdictFor,
  layerLine,
  reassignCandidates,
  isRestoredRetry,
  steerScopeTarget,
  type GateVerdictView,
} from '../components/gateVerdictModel.js';
import type { GateAnswer } from './gateActions.js';

/**
 * SESSION GATE ROW MODEL (S15e): pure classification and choice set for the session thread's
 * answerable gate row. Distinct from the Desk's `classifyRowGate` / `questionRow.ts`:
 *  - def / run_level gates get the four-verb layout (Approve / Approve and steer / Send back / Stop)
 *    rather than the Desk's inline Approve/Reject; the step card yields to GateRow.
 *  - ProposalCard keeps plan and deliver; GateRow takes every other gate kind.
 *  - team / choices gates map the engine's choices (first 4 inline, rest in overflow).
 *  - free-text gates get a single Send choice that opens the note field.
 *  - unknown gates get Approve / Stop.
 */

/** Why the gate row renders what it renders. */
export type SessionGateReason = 'escalation' | 'retry' | 'def' | 'team' | 'free-text' | 'choices' | 'unknown';

/** One answerable choice in the session gate row. */
export interface GateRowChoice {
  key: string;
  label: string;
  /**
   * The decision to commit. Null only for reassign choices (use reassignCli instead) and
   * for escalation steer/send-back (GateRow builds those by key). For all other note-required
   * choices the base decision is set here and sendNote merges {amend}.
   */
  decision: GateAnswer | null;
  /** The seat to hand the unit to instead of re-running the same seat. */
  reassignCli?: string;
  /** Whether clicking opens the note field before sending. */
  needsNote: boolean;
  /** Hover text explaining the consequence of this choice. */
  title: string;
  /** True when the engine value has no known wire meaning; rendered as a disabled button. */
  disabled?: boolean;
}

export interface GateRowModel {
  reason: SessionGateReason;
  question: string;
  /** First four inline choices. */
  choices: readonly GateRowChoice[];
  /** Choices beyond four — shown under ⋯ in the row. */
  overflow: readonly GateRowChoice[];
  /** Pre-filled note for send-back (the reviewer's failing items). Empty when none. */
  noteDefault: string;
  /** Index of the pre-selected choice, or null. */
  recommended: number | null;
  /** Items for the ⋯ disclosure: raw prompt, verdict layers, failing items, reviewer's note. */
  detailItems: readonly string[];
}

/**
 * Map an engine choice value to a wire decision. Returns null for unrecognized values — those
 * render disabled so the operator cannot send an unintended rejection in their place.
 */
function mapChoiceDecision(value: string): GateAnswer | null {
  switch (value) {
    case 'approve': return { approve: true };
    case 'request_changes': return { approve: false, action: 'request_changes' };
    case 'reject': return { approve: false };
    case 'edit_plan': return { approve: true, action: 'edit_plan' };
    // Escalation arms: all approve-shaped (wave6-wire.ts EscalationAction)
    case 'extend': return { approve: true, action: 'extend' };
    case 'targeted': return { approve: true, action: 'targeted' };
    case 'accept_partial': return { approve: true, action: 'accept_partial' };
    case 'accept_suggestion': return { approve: true, action: 'accept_suggestion' };
    default: return null;
  }
}

/** Human label for an engine choice value. */
function mapChoiceLabel(value: string): string {
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Hover title for an engine choice value. */
function mapChoiceTitle(value: string): string {
  switch (value) {
    case 'approve': return 'Continue the run.';
    case 'request_changes': return 'Return to the creator with the reviewer\'s findings.';
    case 'reject': return 'Cancel the run; the work stops here.';
    case 'extend': return 'Re-run floor checks with 2× time bounds.';
    case 'targeted': return 'Re-run with the targeted test set only.';
    case 'accept_partial': return 'Waive the checks that did not finish and continue.';
    case 'accept_suggestion': return 'Apply the restored edit and rewind to the creator.';
    default: return '';
  }
}

/**
 * studio#573: a DENIED-unit escalation — input governance refused one of the unit's tool calls (the
 * engine's `boundary_deny` pause: "Unit N was DENIED by input governance …"), or the fold's denial
 * names that layer. The engine offers two arms there: approve RE-RUNS the phase from the start under
 * the same policies (the captured output is not accepted), reject cancels the run. Nothing was
 * judged wrong with the work, so there is no reviewer finding for a creator to fix: "Send back"
 * (request_changes) is not one of this gate's arms.
 */
export function isDeniedUnitEscalation(prompt: string | undefined, verdict: GateVerdictView | null): boolean {
  if (prompt !== undefined && /^\s*Unit\s+\d+\s+was DENIED by input governance\b/i.test(prompt)) return true;
  return verdict?.denial?.source === 'input_governance';
}

/**
 * Whether the denied unit's OTHER layers passed — the floor (when one ran) and the judge (when one
 * ran) — so the re-run is the suggested arm (studio#573: "floor PASS, judge PASS, denial = the
 * write-root catch"). A failed floor or a judge FAIL means the re-run is not the obvious move, and
 * nothing is preselected. No verdict in the log is no evidence of a pass either: nothing is
 * preselected then (the row never suggests Approve on missing evidence — codex r1).
 */
export function deniedUnitJudgedOk(verdict: GateVerdictView | null): boolean {
  if (verdict === null) return false;
  if (verdict.hasDeterministicFloor && !verdict.deterministicPass) return false;
  const judge = (verdict.agentVerdict ?? '').trim().toLowerCase();
  if (judge !== '' && judge !== 'pass') return false;
  return verdict.evaluatorPass !== false;
}

export interface SessionGateInput {
  runId: string;
  gate: OpenGate;
  units: readonly WorkUnit[];
  events: readonly CoreEvent[];
  /** The run's seat pool (`session.clis` or units' assigned CLIs). */
  pool: readonly string[];
  /** The roster for eligibility checks; null when not yet loaded. */
  roster: readonly RosterSeat[] | null;
}

/**
 * The session gate row model for a given gate. Returns null while events are still loading
 * (`classifyRowGate` returns `{kind:'checking'}`), or for deliver gates (ProposalCard handles those).
 */
export function sessionGateChoices(input: SessionGateInput): GateRowModel | null {
  const { runId, gate, units, events, pool, roster } = input;

  const rowClass = classifyRowGate({ runId, gate, units, events });
  if (rowClass.kind === 'checking') return null;
  if (rowClass.kind === 'card' && rowClass.reason === 'deliver') return null;

  const question = gate.prompt;

  // studio#573 (codex r1): the engine says `gateKind: 'escalation'` on every denied-unit pause
  // (wicked-core#464), which is what classifies it above. A gate from a daemon that predates the
  // kind, read before its log, would fall to the four-verb def row — with Send back on a unit
  // nothing was found wrong with. The denied-unit prompt / denial source is read here as well.
  const deniedAsAnswer = rowClass.kind === 'answer'
    && isDeniedUnitEscalation(gate.prompt, gateVerdictFor(events, gate.ord, gate.prompt));

  let reason: SessionGateReason;
  if (deniedAsAnswer) {
    reason = 'escalation';
  } else if (rowClass.kind === 'card') {
    if (rowClass.reason === 'escalation') reason = 'escalation';
    else if (rowClass.reason === 'retry') reason = 'retry';
    else if (rowClass.reason === 'team') reason = 'team';
    else if (rowClass.reason === 'free-text') reason = 'free-text';
    else if (rowClass.reason === 'choices') reason = 'choices';
    else reason = 'unknown';
  } else {
    // kind === 'answer' → def / run_level / terminal in session context: full 4-verb layout
    reason = 'def';
  }

  // team / choices: map the engine's choices (first 4 inline, rest in overflow)
  if (reason === 'team' || reason === 'choices') {
    const raw = gate.choices ?? ['approve', 'reject'];
    const all: GateRowChoice[] = raw.map((v, i) => {
      const decision = mapChoiceDecision(v);
      if (decision === null) {
        return {
          key: `choice-${i}`,
          label: mapChoiceLabel(v),
          decision: null,
          needsNote: false,
          title: 'No wire for this choice yet — answer on the run page',
          disabled: true,
        };
      }
      return {
        key: `choice-${i}`,
        label: mapChoiceLabel(v),
        decision,
        needsNote: false,
        title: mapChoiceTitle(v),
      };
    });
    // When ALL engine choices are unknown, the row must still be answerable: append Stop and a note
    // escape hatch so the operator is never stranded. Item 3 (gate 11 operator ruling).
    const allUnknown = all.length > 0 && all.every((c) => c.disabled === true);
    if (allUnknown) {
      all.push({ key: 'stop', label: 'Stop', decision: { approve: false }, needsNote: false, title: 'Cancel the run; the work stops here.' });
      all.push({ key: 'send-note-instead', label: 'Send a note instead', decision: { approve: false, action: 'request_changes' }, needsNote: true, title: 'Send a note and cancel the run.' });
    }
    const recommended = typeof gate.recommended === 'number' && gate.recommended >= 0 && gate.recommended < all.length
      ? gate.recommended : null;
    return { reason, question, choices: all.slice(0, 4), overflow: all.slice(4), noteDefault: '', recommended, detailItems: [gate.prompt] };
  }

  // free-text (choices === null): one Send choice that opens the note field
  if (reason === 'free-text') {
    return {
      reason, question,
      choices: [{ key: 'free-text-send', label: 'Send', decision: { approve: true }, needsNote: true, title: 'Send your answer to the engine.' }],
      overflow: [],
      noteDefault: '',
      recommended: null,
      detailItems: [gate.prompt],
    };
  }

  // unknown gate kind: Approve / Stop
  if (reason === 'unknown') {
    return {
      reason, question,
      choices: [
        { key: 'approve', label: 'Approve', decision: { approve: true }, needsNote: false, title: 'Continue the run.' },
        { key: 'stop', label: 'Stop', decision: { approve: false }, needsNote: false, title: 'Cancel the run; the work stops here.' },
      ],
      overflow: [],
      noteDefault: '',
      recommended: null,
      detailItems: [gate.prompt],
    };
  }

  // Pre-fill send-back note from the reviewer's failing items (escalation only)
  let noteDefault = '';
  const verdict = gateVerdictFor(events, gate.ord, gate.prompt);
  const detailItems: string[] = [];

  // Floor check lines for the ⋯ disclosure — one line per check + skipped, for every gate kind
  // where the verdict carries floor evidence. Format: "name · passed · exit 0 · 16 s".
  const floorDetailLines: string[] = verdict !== null && verdict.floor !== null
    ? [
      ...verdict.floor.checks.map((c) => {
        const o = checkOutcome(c);
        return `${c.name} · ${o.ok ? 'passed' : 'failed'} · ${o.word} · ${Math.round(c.durationMs / 1000)} s`;
      }),
      ...(verdict.floor.skipped.length > 0 ? [`skipped: ${verdict.floor.skipped.join(', ')}`] : []),
    ]
    : [];

  if (reason === 'escalation') {
    const summary = escalationSummaryFor(events, gate.ord);
    const items = failingItems(verdict, summary ?? undefined);
    if (items.length > 0) noteDefault = findingsNote(items, 'reviewer');

    // ⋯ detail: raw prompt, verdict layer line, failing items, reviewer note, floor checks
    detailItems.push(gate.prompt);
    const layer = verdict !== null ? layerLine(verdict) : null;
    if (layer !== null) detailItems.push(layer);
    detailItems.push(...items);
    if (summary !== null) detailItems.push(`Reviewer note: ${summary}`);
    detailItems.push(...floorDetailLines);
  } else {
    detailItems.push(gate.prompt);
    detailItems.push(...floorDetailLines);
  }

  const choices: GateRowChoice[] = [];

  if (reason === 'def') {
    // steerScopeTarget: only include amendScope:'creator' when a later creator phase exists
    // (same rule SteeringGate.tsx:376-379 + 522-524 uses). Gate 13 Item 1.
    const scopeTarget = steerScopeTarget(units, gate.ord);
    choices.push({ key: 'approve', label: 'Approve', decision: { approve: true }, needsNote: false, title: 'Continue the run.' });
    choices.push({ key: 'steer', label: 'Approve and steer', decision: scopeTarget !== null ? { approve: true, amendScope: 'creator' } : { approve: true }, needsNote: true, title: 'Approve and add a note to steer the next phase.' });
    choices.push({ key: 'send-back', label: 'Send back', decision: { approve: false, action: 'request_changes' }, needsNote: true, title: 'Return to the creator with your note.' });
    choices.push({ key: 'stop', label: 'Stop', decision: { approve: false }, needsNote: false, title: 'Cancel the run; the work stops here.' });
    return { reason, question, choices, overflow: [], noteDefault, recommended: 0, detailItems };
  }

  if (reason === 'escalation') {
    // steerScopeTarget: only include amendScope:'creator' when a later creator phase exists.
    // For canonical escalation (cursor ON the denied evaluator, creator behind it) steerScopeTarget
    // returns null because no creator sits at or after gate.ord — matching SteeringGate.tsx:377.
    const escalationScopeTarget = steerScopeTarget(units, gate.ord);

    // studio#573: a denied unit's row carries the engine's arms as its prompt states them — Approve
    // RE-RUNS the phase (suggested when the floor and the judge passed), steer, Stop. No Send back:
    // there is no reviewer finding to return, and no reviewer note to pre-fill.
    const deniedUnit = isDeniedUnitEscalation(gate.prompt, verdict);
    if (deniedUnit) noteDefault = '';

    // Build core choices WITHOUT stop: send-back (or the denied unit's re-run), escalation arms, steer.
    // Stop is always the last inline choice, appended after the reassign slot.
    const coreWithoutStop: GateRowChoice[] = [];
    if (deniedUnit) {
      coreWithoutStop.push({ key: 'approve', label: 'Approve', decision: { approve: true }, needsNote: false, title: 'Re-run the step from the start under the same policies; the captured output is not accepted.' });
    } else {
      coreWithoutStop.push({ key: 'send-back', label: 'Send back', decision: { approve: false, action: 'request_changes' }, needsNote: true, title: 'Return to the creator with the reviewer\'s failing items.' });
    }

    // Escalation arms: timeout (extend / targeted / accept_partial) or adopted suggestion.
    // Decision wire: {approve:true, action} as EscalationDecision — cast since api-types is pinned.
    for (const offer of escalationOffers(verdict, gate.ord, units, runId)) {
      coreWithoutStop.push({
        key: `offer:${offer.action}`,
        label: offer.label,
        title: offer.consequence,
        decision: { approve: true, action: offer.action } as unknown as GateAnswer,
        needsNote: false,
      });
    }

    coreWithoutStop.push({ key: 'steer', label: 'Approve and steer', decision: escalationScopeTarget !== null ? { approve: true, amendScope: 'creator' } : { approve: true }, needsNote: true, title: 'Approve and add a note to steer the next creator phase.' });

    // Cap at 3 (stop always occupies the 4th inline slot); excess goes to overflow.
    const escInline = coreWithoutStop.slice(0, 3);
    const overflow: GateRowChoice[] = coreWithoutStop.slice(3);

    // Reassign candidates
    const failedCli = failedSeatOf(units, gate.ord);
    const reassignList: GateRowChoice[] = [];
    if (isSeatFailure(isEscalationGate(gate.prompt, verdict), failedCli)) {
      for (const c of reassignCandidates(pool, failedCli ?? null, roster)) {
        if (isOfferable(c)) {
          reassignList.push({ key: `reassign:${c.cli}`, label: `Reassign to ${c.label}`, decision: null, reassignCli: c.cli, needsNote: false, title: `Move the failed unit to ${c.label}; it retries there.` });
        }
      }
    }
    // First reassign inline when there's still room in the 3-slot cap; rest to overflow.
    if (escInline.length < 3 && reassignList.length > 0) {
      escInline.push(reassignList[0]!);
      overflow.push(...reassignList.slice(1));
    } else {
      overflow.push(...reassignList);
    }
    // Stop is always the last inline choice.
    escInline.push({ key: 'stop', label: 'Stop', decision: { approve: false }, needsNote: false, title: 'Cancel the run; the work stops here.' });

    // Use recommendGateMove for the recommended choice
    const escalationGate = isEscalationGate(gate.prompt, verdict);
    const summary = escalationSummaryFor(events, gate.ord);
    const rec = recommendGateMove({
      runId,
      ord: gate.ord,
      units: units as WorkUnit[],
      verdict,
      verdictSummary: summary ?? null,
      escalationGate,
      hasLift: false,
      restoredRetry: isRestoredRetry(verdict, gate.ord),
      isPlanGate: false,
      planView: null,
      diffstat: null,
    });
    // The denied unit's suggested arm is the re-run (index 0) when its other layers passed.
    const recommended = deniedUnit ? (deniedUnitJudgedOk(verdict) ? 0 : null) : rec?.kind === 'send-back' ? 0 : null;
    return { reason, question, choices: escInline, overflow, noteDefault, recommended, detailItems };
  }

  if (reason === 'retry') {
    choices.push({ key: 'retry', label: 'Retry', decision: { approve: true }, needsNote: false, title: 'Try the same unit again with the same seat.' });
    const failedCli = failedSeatOf(units, gate.ord);
    const retryOverflow: GateRowChoice[] = [];
    // Launch refusals (environment refused / failed before work judged) must not offer reassign:
    // another seat meets the same environment. Gate 11 Item 2 operator ruling.
    const launchRefusal = isLaunchRefusal(gate.prompt, events, gate.ord);
    if (!launchRefusal && failedCli !== null && failedCli !== undefined) {
      const candidates = reassignCandidates(pool, failedCli, roster);
      let inlineReassignDone = false;
      for (const c of candidates) {
        if (isOfferable(c)) {
          const rc: GateRowChoice = {
            key: `reassign:${c.cli}`,
            label: `Reassign to ${c.label}`,
            decision: null,
            reassignCli: c.cli,
            needsNote: false,
            title: `Move the failed unit to ${c.label}; it retries there.`,
          };
          if (!inlineReassignDone) {
            choices.push(rc);
            inlineReassignDone = true;
          } else {
            retryOverflow.push(rc);
          }
        }
      }
    }
    choices.push({ key: 'stop', label: 'Stop', decision: { approve: false }, needsNote: false, title: 'Cancel the run; the work stops here.' });
    return { reason, question, choices, overflow: retryOverflow, noteDefault, recommended: 0, detailItems };
  }

  return null;
}
