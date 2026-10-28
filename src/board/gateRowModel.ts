import type { CoreEvent, RosterSeat, WorkUnit } from '../api/types.js';
import type { OpenGate } from '../store/gates.js';
import { classifyRowGate } from './questionRow.js';
import {
  escalationSummaryFor,
  failingItems,
  deliverRefusalOf,
  findingsNote,
  INSTRUCTION_SEP,
  isDeliverGate,
  type DeliverRefusal,
  recommendGateMove,
  type GateMove,
} from '../components/gateMoveModel.js';
import {
  checkOutcome,
  escalationOffers,
  failedSeatOf,
  isEscalationGate,
  isLaunchRefusal,
  isOfferable,
  isSeatFailure,
  gateFrameFor,
  gateSourceLine,
  gateVerdictFor,
  layerLine,
  reassignCandidates,
  reassignRefusedOf,
  isRestoredRetry,
  isFloorFixGate,
  sendBackAccepted,
  conversationStep,
  steerScopeTarget,
  type GateVerdictView,
} from '../components/gateVerdictModel.js';
import type { ReassignCandidate, RunBench } from '../components/gateVerdictModel.js';
import type { GateAnswer } from './gateActions.js';
import type { RerunOffer } from '../components/rerunModel.js';
import { qeGateOf, QE_RETRY_LABEL, QE_RETRY_NOTE_LABEL, QE_RETRY_NOTE_TITLE, QE_RETRY_TITLE, type QeGate } from './qeEscalation.js';
import { waitsForJudge } from './assuranceModel.js';
import { OPERATOR_JUDGMENT_LABEL, OPERATOR_JUDGMENT_TITLE, REJUDGE_ACTION, REJUDGE_LABEL, rejudgeTitle, type RejudgeOffer } from './rejudge.js';
import { engineNamesFloorOverride, FLOOR_OVERRIDE_ACTION, FLOOR_OVERRIDE_CONSEQUENCE, FLOOR_OVERRIDE_KEY, FLOOR_OVERRIDE_TITLE, offersDeliverFloorOverride, offersFloorOverride } from './floorOverride.js';
import { offersSkipQeHere, skipQeAtDelivery, SKIP_QE_ACTION, SKIP_QE_GATE_TITLE, SKIP_QE_KEY, SKIP_QE_LABEL } from './qeSkip.js';
import { FACE_MAX, failingOnFace, failingSplit, standingFloor, type FailingOnFace, type FailingSplit } from './failingChecks.js';
import { deliverLift } from '../components/deliverLiftModel.js';

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
export type SessionGateReason = 'escalation' | 'retry' | 'def' | 'team' | 'free-text' | 'choices' | 'consent' | 'unknown';

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
  /** core#820: the files this choice would write (a consent gate's install choices); absent elsewhere. */
  writes?: readonly ConsentWrite[];
  /** core#820: the producer's default choice — MARKED, never preselected (consent is asked every time). */
  isDefault?: boolean;
}

/** core#820: one file a consent choice would write, as the engine's dry-run plan lists it. */
export interface ConsentWrite {
  path: string;
  what: string;
  cli?: string;
  /** Outside program-owned roots: the operator's own file ("your own ~/.codex/config.toml"). */
  operatorOwned: boolean;
}

/**
 * core#820: a consent gate's install choices off its `awaitingHuman` frame — `choices`
 * (`consent:<id>` tokens and `reject`), `choiceLabels` and `writeTargets` keyed by token, and
 * `recommended` (the default's index). `null` when the frame names no `consent:` choice (an older
 * engine, or no dry-run plan ran: `writeTargetsMissing`) — the row then keeps Approve / Decline.
 */
/**
 * studio#639: a consent gate with no dry-run plan carries `writeTargetsMissing` — the engine's sentence
 * saying why it cannot list the files (no plan ran). The row shows it where the file lists would be.
 * `null` when the frame names a plan, or says nothing.
 */
export function consentMissingOf(gate: OpenGate, events: readonly CoreEvent[] | null): string | null {
  for (let i = (events ?? []).length - 1; i >= 0; i--) {
    const e = events![i] as unknown as Record<string, unknown>;
    if (e['type'] !== 'awaitingHuman' || e['ord'] !== gate.ord) continue;
    const said = e['writeTargetsMissing'];
    return typeof said === 'string' && said.trim() !== '' ? said.trim() : null;
  }
  return null;
}

export function consentChoicesOf(gate: OpenGate, events: readonly CoreEvent[] | null): GateRowChoice[] | null {
  let frame: Record<string, unknown> | null = null;
  for (let i = (events ?? []).length - 1; i >= 0; i--) {
    const e = events![i] as unknown as Record<string, unknown>;
    if (e['type'] === 'awaitingHuman' && e['ord'] === gate.ord) { frame = e; break; }
  }
  // The file lists ride the frame only: without it nothing is claimed (plain Approve takes the
  // engine's default choice).
  if (frame === null || frame['writeTargets'] === null || typeof frame['writeTargets'] !== 'object') return null;
  const tokens = Array.isArray(frame['choices']) ? (frame['choices'] as unknown[]) : (gate.choices ?? []);
  if (!tokens.some((t) => typeof t === 'string' && t.startsWith('consent:'))) return null;
  const labels = (frame['choiceLabels'] ?? {}) as Record<string, unknown>;
  const targets = frame['writeTargets'] as Record<string, unknown>;
  const rec = typeof frame['recommended'] === 'number' ? frame['recommended'] : gate.recommended;
  const out: GateRowChoice[] = [];
  tokens.forEach((t, i) => {
    if (typeof t !== 'string') return;
    if (t === 'reject') {
      out.push({ key: 'decline', label: 'Decline', decision: { approve: false }, needsNote: false, title: 'Cancel the run; nothing is installed and nothing in this phase runs.' });
      return;
    }
    if (!t.startsWith('consent:')) return;
    const rows = Array.isArray(targets[t]) ? (targets[t] as unknown[]) : [];
    const writes: ConsentWrite[] = rows.flatMap((r) => {
      const o = r as Record<string, unknown> | null;
      if (o === null || typeof o !== 'object' || typeof o['path'] !== 'string') return [];
      return [{
        path: o['path'], what: typeof o['what'] === 'string' ? o['what'] : '',
        ...(typeof o['cli'] === 'string' ? { cli: o['cli'] } : {}),
        operatorOwned: o['operatorOwned'] === true,
      }];
    });
    const label = typeof labels[t] === 'string' && labels[t] !== '' ? (labels[t] as string) : t.slice('consent:'.length);
    const own = writes.filter((w) => w.operatorOwned).length;
    out.push({
      key: t, label,
      decision: { approve: true, action: t } as unknown as GateAnswer,
      needsNote: false,
      title: `Install now: writes ${writes.length} file${writes.length === 1 ? '' : 's'}${own > 0 ? `, ${own} of them your own` : ''}.`,
      writes,
      ...(rec === i ? { isDefault: true } : {}),
    });
  });
  // Decline is always an answer, even if a producer's list left it out.
  if (!out.some((c) => c.key === 'decline')) out.push({ key: 'decline', label: 'Decline', decision: { approve: false }, needsNote: false, title: 'Cancel the run; nothing is installed and nothing in this phase runs.' });
  return out;
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
  /** S16a-1b: the recommended move's consequence ("produce reruns with 2 items; critique
   *  re-reviews"), said above the suggested choice — only when the suggested choice IS that move. */
  consequence: string | null;
  /** S16a-1b: where the gate comes from (run-level / workflow-declared / deliver / final), or null. */
  source: string | null;
  /** S16a-1b: the reviewer's failing criteria ("Why it failed", beside the creator's claims). */
  failing: readonly string[];
  /** S16a-1b: the unit the deciding verdict judged (VerdictDiff's reviewed ord), or null. */
  reviewedOrd: number | null;
  /** studio#403: a refused hand-over's reason (the row leads with it, and says what Deliver again
   *  re-pushes above the choices); absent on every other gate. */
  refusal?: DeliverRefusal;
  /** studio#761/#762: the gate opened on the run's QE review — the row leads with why (its `lead`
   *  replaces the plain question) and says what went wrong under it; absent on every other gate. */
  qe?: QeGate;
  /** studio#639: a consent gate with no install plan — the engine's sentence on why no files are listed. */
  consentMissing?: string;
  /** studio#835: the step's seat cannot work (out of quota, signed out, not installed) and the engine will not
   *  send the step to it again — the row says so first; absent on every other gate. */
  deadSeat?: DeadSeat;
  /** (PRODUCT-WORKS J4) The run's other seats a reassign does NOT offer because they cannot take work now
   *  (benched, signed out, not eligible), with the reason and, for a bench, when it lifts — shown greyed
   *  out beside the choices, never silently dropped. Absent when every other seat is offered (or none). */
  withheldSeats?: ReassignCandidate[];
  /** A gate no judge could rule on: `true` when its approve records the OPERATOR's judgment (the
   *  engine's `judge_by_operator`), `false` on a team member's step, whose approve re-runs the step;
   *  absent on every other gate. */
  operatorJudgment?: boolean;
  /** rig 0.15.8: the failing checks / tests of THIS gate's failed floor, named on the face (up to five,
   *  "+N more"); absent when the gate's own floor did not fail. */
  failingTests?: FailingOnFace;
  /** (J4 0.16.6) Why an override path is not offered at this gate ("Your own judgment isn’t offered while QE has no
   *  verdict on this tree."), one line each; absent when nothing is withheld. */
  whyNot?: string[];
}

/** studio#835: a dead-seat gate's seat, and why it cannot work, in the engine's cause token's terms. */
export interface DeadSeat {
  cli: string;
  cause: 'quota' | 'signed_out' | 'not_installed' | 'unusable';
}

/**
 * studio#835: the engine's dead-seat gate — "Unit 1 (copilot) failed on a dead seat: … Reassign the unit to a
 * different CLI (sign one in first if needed) and approve to retry, or reject to stop the run". The seat is
 * benched for the run and never sent the step again, so a plain approve (or approve with a note) only parks
 * the run here again. The cause is the run's own `seatBenched` frame for that seat, else the prompt's words.
 */
export function deadSeatOf(prompt: string, events: readonly CoreEvent[] | null): DeadSeat | null {
  const cli = /^\s*Unit\s+\d+\s+\(([^)]+)\)\s+failed on a dead seat\b/i.exec(prompt)?.[1]?.trim();
  if (cli === undefined || cli === '') return null;
  let said = prompt;
  for (let i = (events ?? []).length - 1; i >= 0; i -= 1) {
    const e = events![i] as unknown as Record<string, unknown>;
    if (e['type'] === 'seatBenched' && e['cli'] === cli && typeof e['reason'] === 'string') { said = `${e['reason']} ${prompt}`; break; }
  }
  const cause: DeadSeat['cause'] = /quota|usage_limit|rate.?limit|429/i.test(said) ? 'quota'
    : /not_logged_in|not logged in|signed out|unauthori[sz]ed|401/i.test(said) ? 'signed_out'
      : /not_installed|not installed/i.test(said) ? 'not_installed'
        : 'unusable';
  return { cli, cause };
}

/** The choice set before the depth fields (`withDepth` adds them). */
type BaseRowModel = Omit<GateRowModel, 'consequence' | 'source' | 'failing' | 'reviewedOrd'>;

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
 * studio#571 (N3): the engine's prompt as the row's Details show it — its ` ||| ` segment marker
 * (`INSTRUCTION_SEP`, "never rendered") joined on ` — `, as every other gate surface does.
 */
/** studio#813: the seats a reassign leaves out because the engine refuses them, said under Technical
 *  details — a seat never vanishes from the choices without a word. */
function refusedSeatLines(candidates: readonly ReassignCandidate[]): string[] {
  return candidates.filter((c) => c.state === 'refused').map((c) => `Not offered for reassign: ${c.label} — ${c.note}.`);
}

/** (PRODUCT-WORKS J4) The reassign candidates that cannot take work now — benched, signed out, not
 *  eligible — shown greyed out with their reason (an engine-refused seat keeps its own line above). */
function withheldOf(candidates: readonly ReassignCandidate[]): ReassignCandidate[] {
  return candidates.filter((c) => !isOfferable(c) && c.state !== 'refused');
}

/** (PRODUCT-WORKS J4) The soonest bench lift among `seats` (ISO-8601), or null when none says when. */
export function soonestBack(seats: readonly ReassignCandidate[] | undefined): ReassignCandidate | null {
  let best: ReassignCandidate | null = null;
  for (const c of seats ?? []) {
    if (c.until === undefined) continue;
    if (best === null || Date.parse(c.until) < Date.parse(best.until!)) best = c;
  }
  return best;
}

export function shownPrompt(prompt: string): string {
  return prompt.split(INSTRUCTION_SEP).join(' — ');
}

/**
 * studio#547: the unresolved HIGH findings a `team_dispute` pause is about — the `awaitingHuman`
 * frame's `findingIds` (core#759 follow-up), else the ids the engine's prompt names ("unresolved
 * HIGH finding(s) without a council YES: f-…, f-…"). Empty when neither names any.
 */
export function disputeFindingIds(events: readonly CoreEvent[] | null, ord: number, prompt: string): string[] {
  for (let i = (events ?? []).length - 1; i >= 0; i--) {
    const e = events![i] as unknown as Record<string, unknown>;
    if (e['type'] !== 'awaitingHuman' || e['ord'] !== ord) continue;
    const ids = e['findingIds'];
    if (Array.isArray(ids)) {
      const out = ids.filter((x): x is string => typeof x === 'string' && x !== '');
      if (out.length > 0) return out;
    }
    break;
  }
  const m = /without a council YES:\s*([^.]+)/i.exec(prompt);
  return m === null ? [] : m[1]!.split(',').map((x) => x.trim()).filter((x) => x !== '');
}

/** studio#547: the note a dispute's Send back opens on — the findings the creator must address. */
export function disputeNote(ids: readonly string[]): string {
  return ids.length === 0
    ? 'Rework this step: the team recorded an unresolved HIGH finding without a council YES.'
    : `Rework this step: address the unresolved HIGH finding${ids.length === 1 ? '' : 's'} ${ids.join(', ')} (no council YES).`;
}

/**
 * studio#573: a DENIED-unit escalation — input governance refused one of the unit's tool calls (the
 * engine's `boundary_deny` pause: "Unit N was DENIED by input governance …"), or the fold's denial
 * names that layer. The engine offers two arms there: approve RE-RUNS the phase from the start under
 * the same policies (the captured output is not accepted), reject cancels the run. Nothing was
 * judged wrong with the work, so there is no reviewer finding for a creator to fix: "Send back"
 * (request_changes) is not one of this gate's arms.
 *
 * The denial-source rule reads only THIS gate's unit: `gateVerdictFor` is a last-at-or-below lookup
 * that only the triage / NOT PASS spellings bound to the unit, so a gate about unit N with no
 * evaluation of its own must not inherit unit N-1's input-governance denial (codex r2).
 */
export function isDeniedUnitEscalation(prompt: string | undefined, verdict: GateVerdictView | null, gateOrd?: number): boolean {
  if (prompt !== undefined && /^\s*Unit\s+\d+\s+was DENIED by input governance\b/i.test(prompt)) return true;
  if (verdict === null || verdict.denial?.source !== 'input_governance') return false;
  return gateOrd === undefined || verdict.ord === gateOrd;
}

/**
 * Whether the denied unit's OTHER layers passed — the floor (when one ran) and the judge SAID pass
 * — so the re-run is the suggested arm (studio#573: "floor PASS, judge PASS, denial = the write-root
 * catch"). A failed floor, a judge FAIL, or no judge verdict at all (none ran, or none recorded)
 * means the re-run is not the evidenced move, and nothing is preselected; no verdict in the log is
 * no evidence either (the row never suggests Approve on missing evidence — codex r1/r2).
 */
export function deniedUnitJudgedOk(verdict: GateVerdictView | null): boolean {
  if (verdict === null) return false;
  if (verdict.hasDeterministicFloor && !verdict.deterministicPass) return false;
  if ((verdict.agentVerdict ?? '').trim().toLowerCase() !== 'pass') return false;
  return verdict.evaluatorPass !== false;
}

/**
 * studio#606 (5): whether the gate's unit is a TOOL unit (`tool_cmd` — a bash install, the deliver
 * script): no seat runs it, so moving it to another seat changes nothing and "Reassign to <seat>"
 * is never offered on its gate.
 */
export function isToolUnitGate(units: readonly WorkUnit[], gateOrd: number): boolean {
  const cmd = units.find((u) => u.ord === gateOrd)?.tool_cmd;
  return Array.isArray(cmd) && cmd.length > 0;
}

/** studio#612: the floor fix's words — what an approve with a note does at a read-only phase's floor gate. */
export const FLOOR_FIX_LABEL = 'Fix with a note';
/**
 * studio#832: on an escalation whose engine approve RETRIES the phase ("confirm to retry the phase",
 * "Approve to retry the phase against the restored tree") an approve with a note runs the same step
 * again with the note; the run does not move on. It was labelled "Approve and steer" (and, on a
 * review gate, relabelled "Approve with a note for the next step"), and the operator who took it saw
 * the same verify run again and fail the same way.
 */
export const RETRY_NOTE_LABEL = 'Retry this step with a note';
/**
 * wicked-core#761: a capped review's gate (`review_adjudication`, "Unit N verdict is NOT PASS again — …
 * Approve = LAND WITH CARRIED ITEMS"). Its approve ACCEPTS the work with the reviewer's open items carried,
 * records the note as the landing ruling and moves on (`land_with_carried_items`); another round is Send back.
 */
export const LAND_NOTE_LABEL = 'Land with carried items and a note';
export const LAND_NOTE_TITLE = 'Accept the work as it stands, with the reviewer\'s open items carried and your note on the record; the run moves on. For one more review round, Send back.';
/** Whether the gate is a capped review's adjudication (its approve lands the work and advances). */
export function isReviewAdjudication(gate: { gateKind?: string | undefined; prompt: string }): boolean {
  return gate.gateKind === 'review_adjudication'
    || (/^\s*Unit\s+\d+\s+verdict is NOT PASS again\b/i.test(gate.prompt) && /\bApprove = LAND WITH CARRIED ITEMS\b/i.test(gate.prompt));
}
export const RETRY_NOTE_TITLE = 'Run this step again with your note; the run does not move on. To have the builder change something, Send back.';
/** Whether the engine's approve at this gate re-runs the phase (its prompt says so). */
export function approveRetriesPhase(prompt: string): boolean {
  // "approve to re-run the phase": a team member's judge-unavailable step, whose approve re-runs it.
  return /\b(?:confirm|approve) to (?:retry|re-run) the phase\b/i.test(prompt);
}

export const FLOOR_FIX_TITLE = 'A seat other than this read-only phase makes this fix in the worktree, then only the floor re-runs; the phase does not run again and its verdict stands.';

export interface SessionGateInput {
  runId: string;
  gate: OpenGate;
  units: readonly WorkUnit[];
  events: readonly CoreEvent[];
  /** The run's seat pool (`session.clis` or units' assigned CLIs). */
  pool: readonly string[];
  /** The roster for eligibility checks; null when not yet loaded. */
  roster: readonly RosterSeat[] | null;
  /** (PRODUCT-WORKS J4) The seats this run benched (`session.benched_seats`); absent = none known. */
  benched?: readonly RunBench[];
  /** The clock bench lift times are read against (tests pin it); absent = now. */
  now?: number;
  /** S16a-1b: the run's "Rerun from here" offer (`useRerunFromHere`), or null/absent. */
  rerun?: RerunOffer | null;
  /** S16a-2a (studio#430): the reviewed unit's WHOLE output when the engine kept only a head-cut
   *  4 KB tail of a failing verdict (`useFullVerdict`); null/absent = the tail stands. */
  fullVerdict?: string | null;
  /** (crew api-types 0.134.0) A judge-unavailable gate's re-judge offer off `GET /runs/:id/gate`;
   *  null/absent = none read (another gate, an older daemon, not loaded yet). */
  rejudge?: RejudgeOffer | null;
}

const HEAD_CUT = /^\s*(…|\.\.\.)/;
const uncut = (t: string | null): string | null => (t === null ? null : t.replace(/^\s*(…|\.\.\.)\s*/, ''));

/** studio#430: the verdict and summary the row works from — the whole verdict when one was read,
 *  else the kept tail without the engine's "…" (which would glue itself to the first kept finding). */
export function wholeVerdict(verdict: GateVerdictView | null, tail: string | null, full: string | null | undefined): { verdict: GateVerdictView | null; summary: string | null } {
  const whole = full ?? null;
  const summary = whole ?? uncut(tail);
  if (verdict === null || verdict.denial === null || !HEAD_CUT.test(verdict.denial.reason ?? '')) return { verdict, summary };
  return { verdict: { ...verdict, denial: { ...verdict.denial, reason: whole ?? verdict.denial.reason.replace(/^\s*(…|\.\.\.)\s*/, '') } }, summary };
}

/** Whether the engine head-cut this failing verdict (the first findings are not in what it kept). */
export function verdictHeadCut(verdict: GateVerdictView | null, tail: string | null): string | null {
  if (verdict === null || verdict.outcome !== 'fail') return null;
  return [tail, verdict.denial?.reason ?? null].find((t): t is string => t !== null && HEAD_CUT.test(t)) ?? null;
}

/**
 * studio#556: the inline choice that IS `recommendGateMove`'s move, or null when the row has no
 * such choice inline (an overflow entry is never the suggestion). Send back → `send-back`; retry
 * with findings → `retry` where the row has one, else `steer` (approve WITH the note — the same
 * `{approve:true, amend}` the gate card's retry sends); approve-plan / deliver → `approve`.
 */
export function recommendedChoiceIndex(choices: readonly GateRowChoice[], move: GateMove | null): number | null {
  if (move === null) return null;
  const keys: readonly string[] = move.kind === 'send-back'
    ? ['send-back']
    : move.kind === 'retry-findings'
      ? ['retry', 'steer']
      : ['approve'];
  for (const key of keys) {
    const i = choices.findIndex((c) => c.key === key && c.disabled !== true);
    if (i >= 0) return i;
  }
  return null;
}

/**
 * The session gate row model for a given gate. Returns null while events are still loading
 * (`classifyRowGate` returns `{kind:'checking'}`), or for deliver gates (ProposalCard handles those).
 */
export function sessionGateChoices(input: SessionGateInput): GateRowModel | null {
  const base = baseGateChoices(input);
  return base === null ? null : withDepth(base, input);
}

/**
 * S16a-1b: the gate card's depth, carried into the row model — the recommended move's consequence
 * (only above the choice that takes it), the gate's source line, the failing criteria for "Why it
 * failed", and "Rerun from <step>" as one more ⋯ choice (the rewind `useRerunFromHere` offers, sent
 * through the one decision path). The inline choice set is never changed (S15e pins).
 */
function withDepth(base: BaseRowModel, input: SessionGateInput): GateRowModel {
  const { runId, gate, units, events } = input;
  const raw = gateVerdictFor(events, gate.ord, gate.prompt);
  const escalationGate = isEscalationGate(gate.prompt, raw);
  const { verdict, summary: wholeSummary } = wholeVerdict(raw, escalationSummaryFor(events, raw?.ord ?? gate.ord) ?? null, input.fullVerdict);
  const rec = base.reason === 'def' || base.reason === 'escalation'
    ? recommendGateMove({
      runId, ord: gate.ord, units: units as WorkUnit[], verdict,
      verdictSummary: wholeSummary, escalationGate,
      hasLift: false, restoredRetry: isRestoredRetry(verdict, gate.ord), isPlanGate: false, planView: null, diffstat: null,
    })
    : null;
  // The consequence rides the suggested choice only when that choice IS the recommended move
  // (studio#556's mapping: send back, retry with findings, approve) — never above another choice.
  const suggested = rec !== null && base.recommended !== null && recommendedChoiceIndex(base.choices, rec) === base.recommended;
  // studio#612: on a read-only phase's floor gate the suggested approve-with-note is a FLOOR FIX —
  // no seat re-runs the phase with the note, so the move's "reruns with N failing checks" is not
  // what happens; the fix's own consequence is said instead.
  const floorFix = suggested && base.choices[base.recommended!]?.key === 'steer' && isFloorFixGate(gate.prompt, verdict, units, gate.ord);
  // studio#761: a QE review that recorded no verdict judged nothing — the retry's consequence is its
  // own, and there are no failing criteria to list beside the creator's claims.
  const qeNoVerdict = base.qe?.outcome === 'no-verdict';
  // rig 0.15.8: the failing tests on the face — this gate's own failed floor only (an earlier unit's
  // floor is not what this gate asks about).
  // A refused hand-over's failure is the deliver phase's own re-verify, which emits no gate verdict
  // (pr-xreview on studio#899): read it off the lift story for this gate's ord.
  // (J4 0.16.6) A no-change answer re-runs nothing: the engine keeps the unit's last floor on that tree, and the face
  // names its failures (it named none); the engine's own words split them when no record is in hand.
  const failingTests = base.refusal !== undefined
    ? failingOnFace(deliverLift(events, gate.ord)?.reverify ?? null)
    : raw !== null && repoChecksFailed(raw, gate.ord)
      ? failingOnFace(standingFloor(events, gate.ord, raw.floor), FACE_MAX, escalationSummaryFor(events, gate.ord) ?? gate.prompt)
      : raw !== null && raw.ord === gate.ord && raw.outcome === 'fail' ? failingOnFace(raw.floor) : null;
  const freshCount = failingTests?.split !== undefined ? failingTests.split.fresh.length : null;
  const overrideSuggested = base.recommended !== null && base.choices[base.recommended]?.key === FLOOR_OVERRIDE_KEY;
  const namedBack = base.recommended !== null && base.choices[base.recommended]?.label === SEND_BACK_NAMED_LABEL ? base.choices[base.recommended]! : null;
  const consequence = qeNoVerdict
    ? 'Only the QE check and its review run again; the earlier steps are kept'
    : namedBack !== null
    ? namedBack.title
    : overrideSuggested
    ? FLOOR_OVERRIDE_CONSEQUENCE
    : floorFix
    ? `A seat other than this phase makes the fix from ${freshCount !== null
      ? freshCount > 0 ? `the ${freshCount === 1 ? 'test' : `${freshCount} tests`} only this change fails` : 'your note (every failure fails on the base too)'
      : rec!.items.length > 0 ? `the ${rec!.items.length} failing check${rec!.items.length === 1 ? '' : 's'}` : 'note'}; only the floor re-runs`
    : suggested && rec!.consequence !== '' ? rec!.consequence : null;
  const source = gateSourceLine(gate.gateKind ?? gateFrameFor(events, gate.ord)?.gateKind ?? null);
  const overflow = [...base.overflow];
  const offer = input.rerun ?? null;
  // The rewind IS a request_changes: offered only where Send back is one of the gate's arms (never on
  // a denied unit's escalation, studio#573, nor a retry gate, whose engine arms are retry / stop).
  const sendsBack = [...base.choices, ...base.overflow].some((c) => c.key === 'send-back');
  if (offer !== null && sendsBack) {
    overflow.push({
      key: 'rerun', label: `Rerun from ${offer.phase}`, decision: offer.decision, needsNote: false,
      title: offer.consequence,
    });
  }
  return {
    ...base, overflow, consequence, source,
    failing: qeNoVerdict ? [] : rec?.items ?? [],
    reviewedOrd: verdict?.ord ?? null,
    ...(failingTests !== null ? { failingTests } : {}),
  };
}

function baseGateChoices(input: SessionGateInput): BaseRowModel | null {
  const { runId, gate, units, events, pool, roster } = input;
  const benched = input.benched ?? [];
  const now = input.now ?? Date.now();

  // crew#888 / wicked-core#801: a `consent` gate pauses BEFORE a `consent_before` phase runs (the
  // mcp-server install). Nothing has run, so there is nothing to steer or send back: Approve gives
  // consent and runs the phase; Decline cancels the run without running it. Never preselected —
  // consent is the operator's decision every time.
  const kind = gate.gateKind ?? (events === null ? undefined : gateFrameFor(events, gate.ord)?.gateKind ?? undefined);
  if (kind === 'consent') {
    // core#820: the engine's install choices, each with its file list; the default is marked, and
    // nothing is preselected.
    const install = consentChoicesOf(gate, events);
    if (install !== null) {
      return { reason: 'consent', question: gate.prompt, choices: install.slice(0, 4), overflow: install.slice(4), noteDefault: '', recommended: null, detailItems: [shownPrompt(gate.prompt)] };
    }
    const missing = consentMissingOf(gate, events);
    return {
      reason: 'consent',
      question: gate.prompt,
      ...(missing !== null ? { consentMissing: missing } : {}),
      choices: [
        { key: 'approve', label: 'Approve', decision: { approve: true }, needsNote: false, title: 'Give consent: the phase runs now. Nothing in it has run yet.' },
        { key: 'decline', label: 'Decline', decision: { approve: false }, needsNote: false, title: 'Cancel the run without running this phase.' },
      ],
      overflow: [],
      noteDefault: '',
      recommended: null,
      detailItems: [shownPrompt(gate.prompt)],
    };
  }

  // studio#403: a refused hand-over (the engine's retry gate on the deliver unit). Its arms are the
  // engine's two: approve re-runs the deliver phase (it re-lifts, re-verifies and pushes again),
  // reject cancels and keeps the worktree. Nothing is preselected: a re-push leaves the machine.
  const refusal = isDeliverGate(runId, units, gate.ord) ? deliverRefusalOf(gate.prompt) : null;
  if (refusal !== null) {
    return {
      reason: 'retry',
      question: gate.prompt,
      choices: [
        { key: 'retry', label: 'Deliver again', decision: { approve: true }, needsNote: false, title: 'Re-run the deliver phase: it re-checks the work and pushes again.' },
        // wicked-core: the deliver phase's own re-verify failed (a lift moved the tree onto a red base);
        // the operator's judgment over exactly that result, then the deliver phase re-runs on it.
        ...(offersDeliverFloorOverride(gate.prompt)
          ? [{ key: FLOOR_OVERRIDE_KEY, label: OPERATOR_JUDGMENT_LABEL, decision: { approve: true, action: FLOOR_OVERRIDE_ACTION } as unknown as GateAnswer, needsNote: true, title: FLOOR_OVERRIDE_TITLE }]
          : []),
        { key: 'stop', label: 'Stop', decision: { approve: false }, needsNote: false, title: 'Cancel the run and keep the worktree; nothing is pushed.' },
      ],
      overflow: [],
      noteDefault: '',
      recommended: null,
      detailItems: [shownPrompt(gate.prompt)],
      refusal,
    };
  }

  const rowClass = classifyRowGate({ runId, gate, units, events });
  if (rowClass.kind === 'checking') return null;
  if (rowClass.kind === 'card' && rowClass.reason === 'deliver') return null;

  const question = gate.prompt;

  // studio#573 (codex r1): the engine says `gateKind: 'escalation'` on every denied-unit pause
  // (wicked-core#464), which is what classifies it above. A gate from a daemon that predates the
  // kind, read before its log, would fall to the four-verb def row — with Send back on a unit
  // nothing was found wrong with. The denied-unit prompt / denial source is read here as well.
  const deniedAsAnswer = rowClass.kind === 'answer'
    && isDeniedUnitEscalation(gate.prompt, gateVerdictFor(events, gate.ord, gate.prompt), gate.ord);

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
    const offered = gate.choices ?? ['approve', 'reject'];
    // studio#627: a Send back the engine would refuse (no creator at or before the cursor) is not
    // offered; `recommended` indexes the producer's list, so it is re-pointed past the drop.
    const keep = offered.map((v) => v !== 'request_changes' || sendBackAccepted(units, gate.ord));
    const raw = offered.filter((_, i) => keep[i]);
    const dispute = kind === 'team_dispute';
    const findingIds = dispute ? disputeFindingIds(events, gate.ord, gate.prompt) : [];
    const all: GateRowChoice[] = raw.map((v, i) => {
      const decision = mapChoiceDecision(v);
      if (decision === null) {
        return {
          key: `choice-${i}`,
          label: mapChoiceLabel(v),
          decision: null,
          needsNote: false,
          title: 'No wire for this choice yet — send a note instead',
          disabled: true,
        };
      }
      // studio#547: on a team dispute Send back reworks the unit WITH the finding — the note opens
      // pre-filled from it; Approve counts the work past the finding (the engine's own arms).
      if (dispute && v === 'request_changes') {
        return { key: `choice-${i}`, label: 'Send back', decision, needsNote: true, title: 'Rework the step: its creator runs again with your note and the finding.' };
      }
      if (dispute && v === 'approve') {
        return { key: `choice-${i}`, label: 'Approve', decision, needsNote: false, title: 'The work counts as it is; the run continues past the finding.' };
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
      // studio#627 (codex r1): the note escape hatch IS a request_changes — only where it lands.
      if (sendBackAccepted(units, gate.ord)) all.push({ key: 'send-note-instead', label: 'Send a note instead', decision: { approve: false, action: 'request_changes' }, needsNote: true, title: 'Send a note and cancel the run.' });
    }
    const r = gate.recommended;
    const recommended = typeof r === 'number' && r >= 0 && r < offered.length && keep[r] === true
      ? keep.slice(0, r).filter(Boolean).length : null;
    const detailItems = [shownPrompt(gate.prompt)];
    if (findingIds.length > 0) {
      detailItems.push(`Unresolved HIGH finding${findingIds.length === 1 ? '' : 's'} without a council YES: ${findingIds.join(', ')}`);
    }
    return {
      reason, question, choices: all.slice(0, 4), overflow: all.slice(4),
      noteDefault: dispute && raw.includes('request_changes') ? disputeNote(findingIds) : '',
      recommended: recommended !== null && recommended < all.length ? recommended : null,
      detailItems,
    };
  }

  // free-text (choices === null): one Send choice that opens the note field
  if (reason === 'free-text') {
    return {
      reason, question,
      choices: [{ key: 'free-text-send', label: 'Send', decision: { approve: true }, needsNote: true, title: 'Send your answer to the engine.' }],
      overflow: [],
      noteDefault: '',
      recommended: null,
      detailItems: [shownPrompt(gate.prompt)],
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
      detailItems: [shownPrompt(gate.prompt)],
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
  // studio#612: the gate's floor note (a waiver, or a floor fix's "the verdict was given on the
  // pre-fix tree") rides the disclosure verbatim.
  if (verdict?.floorNote != null) floorDetailLines.push(`Floor note: ${verdict.floorNote}`);

  if (reason === 'escalation') {
    const tail = escalationSummaryFor(events, gate.ord);
    // studio#430: the whole verdict when the engine head-cut it, else the kept tail without its "…".
    const { verdict: whole, summary } = wholeVerdict(verdict, tail ?? null, input.fullVerdict);
    const items = failingItems(whole, summary ?? undefined);
    if (items.length > 0) noteDefault = findingsNote(items, 'reviewer');

    // ⋯ detail: raw prompt, verdict layer line, failing items, reviewer note, floor checks
    detailItems.push(shownPrompt(gate.prompt));
    const layer = verdict !== null ? layerLine(verdict) : null;
    if (layer !== null) detailItems.push(layer);
    detailItems.push(...items);
    if (summary !== null) detailItems.push(`Reviewer note: ${summary}`);
    detailItems.push(...floorDetailLines);
  } else {
    detailItems.push(shownPrompt(gate.prompt));
    detailItems.push(...floorDetailLines);
  }

  const choices: GateRowChoice[] = [];

  if (reason === 'def') {
    // steerScopeTarget: only include amendScope:'creator' when a later creator phase exists
    // (same rule the retired gate card uses). Gate 13 Item 1.
    const scopeTarget = steerScopeTarget(units, gate.ord);
    choices.push({ key: 'approve', label: 'Approve', decision: { approve: true }, needsNote: false, title: 'Continue the run.' });
    choices.push({ key: 'steer', label: 'Approve and steer', decision: scopeTarget !== null ? { approve: true, amendScope: 'creator' } : { approve: true }, needsNote: true, title: 'Approve and add a note to steer the next phase.' });
    // studio#627: Send back only where the engine accepts it — a creator at or before this unit.
    if (conversationStep(units, gate.ord) !== null) {
      // learn's walkthrough (F-LEARN-2): the same send-back, read as a question — the step answers
      // it with the conversation so far and this gate returns; Approve ends the loop.
      choices.push({ key: 'send-back', label: 'Ask a follow-up', decision: { approve: false, action: 'request_changes' }, needsNote: true, title: 'Ask this step a question; it answers with the conversation so far and stops here again.' });
    } else if (sendBackAccepted(units, gate.ord)) {
      choices.push({ key: 'send-back', label: 'Send back', decision: { approve: false, action: 'request_changes' }, needsNote: true, title: 'Return to the creator with your note.' });
    }
    choices.push({ key: 'stop', label: 'Stop', decision: { approve: false }, needsNote: false, title: 'Cancel the run; the work stops here.' });
    return { reason, question, choices, overflow: [], noteDefault, recommended: 0, detailItems };
  }

  if (reason === 'escalation') {
    // steerScopeTarget: only include amendScope:'creator' when a later creator phase exists.
    // For canonical escalation (cursor ON the denied evaluator, creator behind it) steerScopeTarget
    // returns null because no creator sits at or after gate.ord — matching the retired gate card.
    const escalationScopeTarget = steerScopeTarget(units, gate.ord);

    // studio#573: a denied unit's row carries the engine's arms as its prompt states them — Approve
    // RE-RUNS the phase (suggested when the floor and the judge passed), steer, Stop. No Send back:
    // there is no reviewer finding to return, and no reviewer note to pre-fill.
    const deniedUnit = isDeniedUnitEscalation(gate.prompt, verdict, gate.ord);
    if (deniedUnit) noteDefault = '';
    // studio#761: the QE review's gate. The engine's Approve re-dispatches the QE unit alone, so the
    // retry is named for what it does. When the reviewer recorded NO verdict nothing was judged:
    // there is no finding for the creator, so Send back (and the rewind behind it) is not offered.
    const qe = qeGateOf(events, units, gate.ord);
    const qeNoVerdict = qe?.outcome === 'no-verdict';
    if (qeNoVerdict) noteDefault = '';
    // A gate no judge could rule on (`judge_unavailable`): its approve is the OPERATOR's judgment
    // of the work as it stands, said so on the button; the re-run of the judge is its own choice,
    // offered only when crew's gate read says a judge seat can rule now.
    const judgeWait = waitsForJudge(events, gate.ord, gate.prompt);
    // A team member's step is the exception: the engine re-runs it on approve ("approve to re-run the
    // phase"), so neither the judgment label nor the re-judge applies there.
    const operatorJudgment = judgeWait && !/\bapprove to re-run the phase\b/i.test(gate.prompt);

    // Build core choices WITHOUT stop: send-back (or the denied unit's re-run), escalation arms, steer.
    // Stop is always the last inline choice, appended after the reassign slot.
    const coreWithoutStop: GateRowChoice[] = [];
    // studio#835: a dead seat is never sent the step again — an approve (with a note or not), or a send-back to
    // the same seat, would only park the run here once more, so the row offers what can work: another helper
    // in this job (Reassign), or Stop.
    const deadSeat = deadSeatOf(gate.prompt, events);
    const rejudgeOffered = deadSeat === null && operatorJudgment && input.rejudge?.available === true;
    if (rejudgeOffered) {
      coreWithoutStop.push({ key: 'rejudge', label: REJUDGE_LABEL, decision: { approve: true, action: REJUDGE_ACTION } as unknown as GateAnswer, needsNote: false, title: rejudgeTitle(input.rejudge!, (k) => input.roster?.find((r) => r.key === k)?.display_name ?? k) });
    }
    if (deadSeat === null && deniedUnit) {
      coreWithoutStop.push({ key: 'approve', label: 'Approve', decision: { approve: true }, needsNote: false, title: 'Re-run the step from the start under the same policies; the captured output is not accepted.' });
    } else if (deadSeat === null && qeNoVerdict) {
      coreWithoutStop.push({ key: 'retry', label: QE_RETRY_LABEL, decision: { approve: true }, needsNote: false, title: QE_RETRY_TITLE });
    } else if (deadSeat === null && sendBackAccepted(units, gate.ord)) {
      coreWithoutStop.push({ key: 'send-back', label: 'Send back', decision: { approve: false, action: 'request_changes' }, needsNote: true, title: 'Return to the creator with the reviewer\'s failing items.' });
    }
    // A QE FAIL keeps Send back first (the work is what failed), and offers the review again beside it.
    if (qe?.outcome === 'fail') {
      coreWithoutStop.push({ key: 'retry', label: QE_RETRY_LABEL, decision: { approve: true }, needsNote: false, title: QE_RETRY_TITLE });
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

    // studio#612 (wicked-core#782): at a read-only phase's floor gate the same approve-with-note is a
    // FLOOR FIX — a distinct seat makes the note's fix, then only the floor re-runs. No creator phase
    // runs, so "steer the next creator phase" would be wrong there; the wire is unchanged.
    const floorFix = isFloorFixGate(gate.prompt, verdict, units, gate.ord);
    // studio#761: at a QE review's gate an approve with a note re-runs the QE unit WITH the note —
    // nothing is approved, so it is not called that. (The judge-unavailable QE gate keeps its
    // approve: there the operator's approve IS the judgment.)
    const qeRetryNote = qe !== undefined && qe !== null && qe.outcome !== 'unavailable';
    if (deadSeat === null) coreWithoutStop.push(floorFix
      ? { key: 'steer', label: FLOOR_FIX_LABEL, decision: { approve: true }, needsNote: true, title: FLOOR_FIX_TITLE }
      : qeRetryNote
        ? { key: 'steer', label: QE_RETRY_NOTE_LABEL, decision: { approve: true }, needsNote: true, title: QE_RETRY_NOTE_TITLE }
        : operatorJudgment
          ? { key: 'steer', label: OPERATOR_JUDGMENT_LABEL, decision: { approve: true }, needsNote: true, title: OPERATOR_JUDGMENT_TITLE }
          // wicked-core#761: a capped review's approve lands the work and moves on — never a retry.
          : isReviewAdjudication(gate)
          ? { key: 'steer', label: LAND_NOTE_LABEL, decision: { approve: true }, needsNote: true, title: LAND_NOTE_TITLE }
          // PRODUCT-WORKS J6: the engine's approve at an escalation amends the CURSOR unit — the
          // escalated step itself — and re-runs it (every escalation but a judge-unavailable one and a
          // capped review's adjudication, both handled above). So when no later creator takes the note, it is a retry of this step,
          // whatever the prompt's wording: run 9bd0f728's "…and approve to retry, or …" prompt
          // missed the phrase test and read "Approve with a note for the next step", and the note
          // went to the same step, which ran again.
          : approveRetriesPhase(gate.prompt) || escalationScopeTarget === null
          ? { key: 'steer', label: RETRY_NOTE_LABEL, decision: escalationScopeTarget !== null ? { approve: true, amendScope: 'creator' } : { approve: true }, needsNote: true, title: RETRY_NOTE_TITLE }
          : { key: 'steer', label: 'Approve and steer', decision: escalationScopeTarget !== null ? { approve: true, amendScope: 'creator' } : { approve: true }, needsNote: true, title: 'Approve and add a note to steer the next creator phase.' });
    // (crew api-types 0.135.0) A failed repo-checks floor: the operator's own judgment, with a
    // required rationale — offered where the engine's prompt names the arm. Inline (it is the way
    // on when retries loop on flakes); a reassign then rides the ⋯.
    if (deadSeat === null && offersFloorOverride(gate.prompt, verdict, gate.ord)) {
      coreWithoutStop.push({ key: FLOOR_OVERRIDE_KEY, label: OPERATOR_JUDGMENT_LABEL, decision: { approve: true, action: FLOOR_OVERRIDE_ACTION } as unknown as GateAnswer, needsNote: true, title: FLOOR_OVERRIDE_TITLE });
    }

    // studio#923 / J4 0.16.6: the engine takes the QE skip AT this gate (a QE-only denial, or a failed floor with QE behind
    // it): offered here with a required reason, never only by starting the job again.
    const skipHere = deadSeat === null && offersSkipQeHere(gate.prompt);
    if (skipHere) {
      coreWithoutStop.push({ key: SKIP_QE_KEY, label: SKIP_QE_LABEL, decision: { approve: true, action: SKIP_QE_ACTION } as unknown as GateAnswer, needsNote: true, title: SKIP_QE_GATE_TITLE });
    }
    // (J4 0.16.6) The override paths the engine did not offer, and why, in one line each: the operator read engine source
    // to learn why "Approve as your own judgment" was missing.
    const whyNot: string[] = [];
    const floorDenied = verdict !== null && verdict.ord === gate.ord && verdict.outcome === 'fail' && (verdict.denial?.source === 'repo_checks' || verdict.denial?.source === 'repo_checks_timeout');
    const qeBehind = /\balso: QE acceptance (?:did not pass|is inconclusive)\b/.test(gate.prompt);
    if (floorDenied && deadSeat === null && !offersFloorOverride(gate.prompt, verdict, gate.ord)) {
      whyNot.push(qeBehind
        ? `Your own judgment isn’t offered while QE has no verdict on this tree.${skipHere ? ' Skip QE with a reason first, and this question comes back with it.' : ''}`
        : 'Your own judgment isn’t offered here: the job takes it only when the failed checks are all that stop this step.');
    }
    if (skipQeAtDelivery(gate.prompt)) whyNot.push('Skipping QE is offered at the hand-over, not here.');

    // Cap at 3 (stop always occupies the 4th inline slot); excess goes to overflow.
    const escInline = coreWithoutStop.slice(0, 3);
    const overflow: GateRowChoice[] = coreWithoutStop.slice(3);

    // Reassign candidates
    const failedCli = failedSeatOf(units, gate.ord) ?? deadSeat?.cli;
    const reassignList: GateRowChoice[] = [];
    const withheld: ReassignCandidate[] = [];
    if (!isToolUnitGate(units, gate.ord) && isSeatFailure(isEscalationGate(gate.prompt, verdict) || deadSeat !== null, failedCli)) {
      const candidates = reassignCandidates(pool, failedCli ?? null, roster, reassignRefusedOf(units, gate.ord), benched, now);
      for (const c of candidates) {
        if (isOfferable(c)) {
          reassignList.push({ key: `reassign:${c.cli}`, label: `Reassign to ${c.label}`, decision: null, reassignCli: c.cli, needsNote: false, title: `Move the failed unit to ${c.label}; it retries there.` });
        }
      }
      detailItems.push(...refusedSeatLines(candidates));
      withheld.push(...withheldOf(candidates));
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
    // studio#556: otherwise the row suggests whatever recommendGateMove recommends — send back,
    // retry with findings, or approve — on the inline choice that IS that move.
    // rig 0.15.8: when the engine names the operator's override as the way through (a red base it cannot
    // separate from the change), that is the suggestion — a retry or a fix would loop on the base's failures.
    const overrideAt = escInline.findIndex((c) => c.key === FLOOR_OVERRIDE_KEY);
    // (J4 0.16.6) Failures only this change has (the engine's per-test split, its structured base comparison, or its
    // words): the work is what failed, so the face leads with sending them back, named — never the operator's own
    // judgment, which would override them too.
    const split = gateFloorSplit(events, gate, verdict);
    const changeOnly = split !== null && split.fresh.length > 0 ? split.fresh : null;
    const overridePath = overrideAt >= 0 && changeOnly === null && engineNamesFloorOverride(verdict, summary ?? null);
    const backAt = changeOnly !== null ? escInline.findIndex((c) => c.key === 'send-back' && c.decision !== null) : -1;
    if (backAt >= 0) {
      const n = changeOnly!.length;
      escInline[backAt] = { ...escInline[backAt]!, label: SEND_BACK_NAMED_LABEL,
        title: `Send ${n === 1 ? 'the test' : `the ${n} tests`} only this change fails back to the builder, named, so it fixes just ${n === 1 ? 'that' : 'those'}.` };
    }
    const recommended = deniedUnit ? (deniedUnitJudgedOk(verdict) ? 0 : null)
      : qeNoVerdict ? 0
        : rejudgeOffered ? 0
          : backAt >= 0 ? backAt
            : overridePath ? overrideAt
              : changeOnly !== null && escInline[recommendedChoiceIndex(escInline, rec) ?? -1]?.key === FLOOR_OVERRIDE_KEY ? null
                : recommendedChoiceIndex(escInline, rec);
    if (backAt >= 0) noteDefault = namedSendBackNote(changeOnly!.slice(0, FACE_MAX * 2));
    // A retry with findings is taken with ITS note (a validator's failing checks are not "the
    // reviewer's"), so the note field opens on the move's own prefill.
    if (!deniedUnit && !qeNoVerdict && !rejudgeOffered && !overridePath && backAt < 0 && recommended !== null && rec?.kind === 'retry-findings' && rec.prefill !== null) {
      noteDefault = rec.prefill;
    }
    return { reason, question, choices: escInline, overflow, noteDefault, recommended, detailItems, ...(whyNot.length > 0 ? { whyNot } : {}), ...(qe !== null ? { qe } : {}), ...(deadSeat !== null ? { deadSeat } : {}), ...(judgeWait ? { operatorJudgment } : {}), ...(withheld.length > 0 ? { withheldSeats: withheld } : {}) };
  }

  if (reason === 'retry') {
    choices.push({ key: 'retry', label: 'Retry', decision: { approve: true }, needsNote: false, title: 'Try the same unit again with the same seat.' });
    // studio#600: the restored-tree gate's other engine arm — adopt the evaluator's pinned edit —
    // when the engine pinned it (`escalationOffers` mirrors the engine's own acceptance check).
    for (const offer of escalationOffers(verdict, gate.ord, units, runId)) {
      choices.push({ key: `offer:${offer.action}`, label: offer.label, title: offer.consequence, decision: { approve: true, action: offer.action } as unknown as GateAnswer, needsNote: false });
    }
    const failedCli = failedSeatOf(units, gate.ord);
    const retryOverflow: GateRowChoice[] = [];
    const retryWithheld: ReassignCandidate[] = [];
    // Launch refusals (environment refused / failed before work judged) must not offer reassign:
    // another seat meets the same environment. Gate 11 Item 2 operator ruling.
    const launchRefusal = isLaunchRefusal(gate.prompt, events, gate.ord);
    if (!launchRefusal && !isToolUnitGate(units, gate.ord) && failedCli !== null && failedCli !== undefined) {
      const candidates = reassignCandidates(pool, failedCli, roster, reassignRefusedOf(units, gate.ord), benched, now);
      detailItems.push(...refusedSeatLines(candidates));
      retryWithheld.push(...withheldOf(candidates));
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
    return { reason, question, choices, overflow: retryOverflow, noteDefault, recommended: 0, detailItems, ...(retryWithheld.length > 0 ? { withheldSeats: retryWithheld } : {}) };
  }

  return null;
}

/** The label of the send-back the face leads with when the floor failed on tests only this change has. */
export const SEND_BACK_NAMED_LABEL = 'Send back with the failing tests named';

/** A failed repo-checks floor's verdict (the only gate the per-test split is about). */
function repoChecksFailed(verdict: { ord: number | null; outcome: string; denial: { source?: string | null } | null } | null, ord: number): boolean {
  const source = verdict?.denial?.source;
  return verdict !== null && verdict.ord === ord && verdict.outcome === 'fail' && (source === 'repo_checks' || source === 'repo_checks_timeout');
}

/**
 * (J4 0.16.6) The failed floor's failures told apart for THIS gate: its own floor record, else the one the engine kept
 * for the unchanged tree, else the engine's words. `null` on any other gate, or when nothing tells them apart.
 */
export function gateFloorSplit(events: readonly CoreEvent[], gate: Pick<OpenGate, 'ord' | 'prompt'>, verdict: Parameters<typeof repoChecksFailed>[0] & { floor: Parameters<typeof standingFloor>[2] } | null): FailingSplit | null {
  if (!repoChecksFailed(verdict, gate.ord)) return null;
  return failingSplit(standingFloor(events, gate.ord, verdict!.floor), escalationSummaryFor(events, gate.ord) ?? gate.prompt);
}

/** The note a named send-back opens with: the tests only this change has, and nothing else. */
export function namedSendBackNote(fresh: readonly string[]): string {
  return `Fix only the test${fresh.length === 1 ? '' : 's'} this change broke (the others fail on the base too): ${fresh.join(', ')}`;
}
