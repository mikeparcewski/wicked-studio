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
  isRestoredRetry,
  isFloorFixGate,
  sendBackAccepted,
  steerScopeTarget,
  type GateVerdictView,
} from '../components/gateVerdictModel.js';
import type { GateAnswer } from './gateActions.js';
import type { RerunOffer } from '../components/rerunModel.js';

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
  /** S16a-1b: the run's "Rerun from here" offer (`useRerunFromHere`), or null/absent. */
  rerun?: RerunOffer | null;
  /** S16a-2a (studio#430): the reviewed unit's WHOLE output when the engine kept only a head-cut
   *  4 KB tail of a failing verdict (`useFullVerdict`); null/absent = the tail stands. */
  fullVerdict?: string | null;
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
  const consequence = floorFix
    ? `A seat other than this phase makes the fix from the ${rec!.items.length > 0 ? `${rec!.items.length} failing check${rec!.items.length === 1 ? '' : 's'}` : 'note'}; only the floor re-runs`
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
    failing: rec?.items ?? [],
    reviewedOrd: verdict?.ord ?? null,
  };
}

function baseGateChoices(input: SessionGateInput): BaseRowModel | null {
  const { runId, gate, units, events, pool, roster } = input;

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
    return {
      reason: 'consent',
      question: gate.prompt,
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
    if (sendBackAccepted(units, gate.ord)) {
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

    // Build core choices WITHOUT stop: send-back (or the denied unit's re-run), escalation arms, steer.
    // Stop is always the last inline choice, appended after the reassign slot.
    const coreWithoutStop: GateRowChoice[] = [];
    if (deniedUnit) {
      coreWithoutStop.push({ key: 'approve', label: 'Approve', decision: { approve: true }, needsNote: false, title: 'Re-run the step from the start under the same policies; the captured output is not accepted.' });
    } else if (sendBackAccepted(units, gate.ord)) {
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

    // studio#612 (wicked-core#782): at a read-only phase's floor gate the same approve-with-note is a
    // FLOOR FIX — a distinct seat makes the note's fix, then only the floor re-runs. No creator phase
    // runs, so "steer the next creator phase" would be wrong there; the wire is unchanged.
    const floorFix = isFloorFixGate(gate.prompt, verdict, units, gate.ord);
    coreWithoutStop.push(floorFix
      ? { key: 'steer', label: FLOOR_FIX_LABEL, decision: { approve: true }, needsNote: true, title: FLOOR_FIX_TITLE }
      : { key: 'steer', label: 'Approve and steer', decision: escalationScopeTarget !== null ? { approve: true, amendScope: 'creator' } : { approve: true }, needsNote: true, title: 'Approve and add a note to steer the next creator phase.' });

    // Cap at 3 (stop always occupies the 4th inline slot); excess goes to overflow.
    const escInline = coreWithoutStop.slice(0, 3);
    const overflow: GateRowChoice[] = coreWithoutStop.slice(3);

    // Reassign candidates
    const failedCli = failedSeatOf(units, gate.ord);
    const reassignList: GateRowChoice[] = [];
    if (!isToolUnitGate(units, gate.ord) && isSeatFailure(isEscalationGate(gate.prompt, verdict), failedCli)) {
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
    // studio#556: otherwise the row suggests whatever recommendGateMove recommends — send back,
    // retry with findings, or approve — on the inline choice that IS that move.
    const recommended = deniedUnit ? (deniedUnitJudgedOk(verdict) ? 0 : null) : recommendedChoiceIndex(escInline, rec);
    // A retry with findings is taken with ITS note (a validator's failing checks are not "the
    // reviewer's"), so the note field opens on the move's own prefill.
    if (!deniedUnit && recommended !== null && rec?.kind === 'retry-findings' && rec.prefill !== null) {
      noteDefault = rec.prefill;
    }
    return { reason, question, choices: escInline, overflow, noteDefault, recommended, detailItems };
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
    // Launch refusals (environment refused / failed before work judged) must not offer reassign:
    // another seat meets the same environment. Gate 11 Item 2 operator ruling.
    const launchRefusal = isLaunchRefusal(gate.prompt, events, gate.ord);
    if (!launchRefusal && !isToolUnitGate(units, gate.ord) && failedCli !== null && failedCli !== undefined) {
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
