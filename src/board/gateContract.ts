/**
 * GATES AS A CONTRACT (studio#1170; crew#1512, api-types 0.211.0 `GateInfo.actions`).
 *
 * The engine publishes every answer an open gate takes now (wicked-core `gate_actions`: each candidate answer run
 * through its decision path's own pre-checks), and crew removes what it refuses itself. When a gate read carries that
 * list, a card's answers are EXACTLY the list: one control per listed answer (a reassign: one per listed seat), none
 * other. Nothing here decides membership from the prompt, unit state, a dead seat, a QE outcome or a rule hold — that
 * inference is what kept drifting from the engine (Land hidden at a capped review, "Retry with a note" that landed the
 * step, no Reassign where the engine's own remedy was a distinct seat). Wording comes from the answer's `intent`.
 *
 * Without the list (an older daemon) the cards keep their own resolver (`gateRowModel.ts`), as before.
 */
import type { GateAnswer } from './gateActions.js';
import type { GateRowChoice } from './gateRowModel.js';
import { FLOOR_OVERRIDE_KEY, FLOOR_OVERRIDE_TITLE } from './floorOverride.js';
import { QE_REDO_KEY, QE_REDO_LABEL, QE_REDO_TITLE } from './qeEscalation.js';
import { SKIP_QE_GATE_TITLE, SKIP_QE_KEY, SKIP_QE_LABEL } from './qeSkip.js';
import { OPERATOR_JUDGMENT_LABEL, OPERATOR_JUDGMENT_TITLE, REJUDGE_LABEL } from './rejudge.js';

/** One answer the open gate takes — api-types 0.211.0 `GateAction`; local until studio pins that release. */
export interface GateAction {
  action: string;
  intent: string;
  note: 'none' | 'optional' | 'required';
  noteIntent?: string;
  seats?: string[];
  benchedSeats?: string[];
  rules?: string[];
  needsPlanRev?: true;
  humanOnly?: true;
}

/** The list off a `GET /runs/:id/gate` answer: `undefined` when the daemon sends none (fall back), else the list. */
export function gateActionsOf(info: unknown): GateAction[] | undefined {
  const raw = (info as { actions?: unknown } | null | undefined)?.actions;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((a): a is GateAction => typeof a === 'object' && a !== null
    && typeof (a as GateAction).action === 'string' && typeof (a as GateAction).intent === 'string'
    && ((a as GateAction).note === 'none' || (a as GateAction).note === 'optional' || (a as GateAction).note === 'required'));
}

/** The card and passage send the same listed answer, with words only where the wire takes them. */
export function listedGateAnswer(token: string, words: string | undefined, ord: number): GateAnswer {
  const note = words?.trim() ?? '';
  if (token === 'reject') return { approve: false, ...(note !== '' ? { amend: note } : {}) };
  if (token === 'request_changes') return { approve: false, action: 'request_changes', amend: note, ord } as GateAnswer;
  return { approve: true, action: token, ...(note !== '' ? { amend: note } : {}), ord } as GateAnswer;
}

/** An approve's words by what it does at this gate: [the plain answer, the answer with a note]. */
const APPROVE_WORDS: Readonly<Record<string, readonly [string, string, string]>> = {
  continue: ['Approve', 'Approve and steer', 'Continue the run (a note steers the next step).'],
  retry: ['Retry this step', 'Retry this step with a note', 'Run this step again; the run does not move on. To have the builder change something, Send back.'],
  land_with_carried_items: ['Land with carried items', 'Land with carried items and a note',
    'Accept the work as it stands, with the reviewer\'s open items carried (and your note on the record); the run moves on. For one more review round, Send back.'],
  operator_judgment: ['Approve as your own judgment', OPERATOR_JUDGMENT_LABEL, OPERATOR_JUDGMENT_TITLE],
  deliver: ['Deliver', 'Deliver with a note', 'Hand the work over (push the branch and open the pull request).'],
  complete: ['Approve completion', 'Approve completion with a note', 'Finish the run: the work is accepted.'],
  approve_plan: ['Approve plan', 'Approve plan with a note', 'Run the plan as it stands (a note goes to the first step that builds).'],
  // wicked-core#1512: a team dispute's approve counts the disputed work; a team transport pause's publishes the missing step.
  accept_work: ['Accept the work as it stands', 'Accept with a note', 'The disputed work counts as it stands; the run goes on.'],
  continue_team: ['Continue', 'Continue with a note', 'Publish the team\'s missing step and go on.'],
};
const FLOOR_FIX_WORDS = ['Fix with a note', 'A distinct seat makes the fix your note describes, then only the checks run again.'] as const;

/** Every other answer's words, by its token. */
const NAMED_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  request_changes: ['Send back', 'Return to the builder with your note (the reviewer\'s failing items go with it).'],
  reject: ['Stop', 'Cancel the run; the work stops here.'],
  retry_qe: [QE_REDO_LABEL, QE_REDO_TITLE],
  rejudge: [REJUDGE_LABEL, 'Run the judge again on the same work; the step does not run again.'],
  retry_rules: ['Re-check the rules', 'Run the steering-rule check again on the same work; the step does not run again.'],
  operator_judgment: [OPERATOR_JUDGMENT_LABEL, FLOOR_OVERRIDE_TITLE],
  skip_qe: [SKIP_QE_LABEL, SKIP_QE_GATE_TITLE],
  extend: ['Re-run the checks with more time', 'Run the checks again on the tree as it stands, each with twice its time.'],
  targeted: ['Re-run with the targeted tests', 'Run the checks again with the repository\'s targeted tests in place of the full set.'],
  accept_partial: ['Accept the checks that finished', 'Waive the checks that did not finish (named on the gate) and go on.'],
  accept_suggestion: ['Take the reviewer\'s edit', 'Apply the reviewer\'s pinned edit and send it to the builder.'],
  amend_intent: ['Change what it must do…', 'Approve, and change the job\'s acceptance list for every later step (your words say what it now is).'],
  edit_plan: ['Change something', 'Edit the plan, then run it.'],
};

/** The key a row control is known by in `GateRow` (its note box, focus and receipts key off these). */
const KEYS: Readonly<Record<string, string>> = {
  request_changes: 'send-back', reject: 'stop', retry_qe: QE_REDO_KEY, rejudge: 'rejudge', retry_rules: 'retry-rules',
  skip_rules: 'skip-rules', operator_judgment: FLOOR_OVERRIDE_KEY, skip_qe: SKIP_QE_KEY,
};

/** The wire body an answer sends (crew `GateDecision`): approve / reject / request_changes, else `{approve, action}`. */
function decisionFor(a: GateAction): GateAnswer {
  if (a.action === 'approve') return { approve: true };
  if (a.action === 'reject') return { approve: false };
  if (a.action === 'request_changes') return { approve: false, action: 'request_changes' } as GateAnswer;
  return { approve: true, action: a.action } as unknown as GateAnswer;
}

/** The controls a listed answer draws — one, or for an approve that takes an optional note, two; one per seat for a reassign. */
export function choicesForAction(a: GateAction, seatLabel: (cli: string) => string): GateRowChoice[] {
  if (a.action === 'reassign') {
    const benched = new Set(a.benchedSeats ?? []);
    return (a.seats ?? []).map((cli) => ({
      key: `reassign:${cli}`, label: `Reassign to ${seatLabel(cli)}${benched.has(cli) ? ' (benched)' : ''}`, decision: null, reassignCli: cli, needsNote: false,
      title: benched.has(cli)
        ? `${seatLabel(cli)} was benched in this job; move this step to it only if it is signed in again. It runs again there.`
        : `Move this step to ${seatLabel(cli)}; it runs again there.`,
    }));
  }
  if (a.action === 'approve') {
    const [plain, noted, title] = APPROVE_WORDS[a.intent] ?? ['Approve', 'Approve with a note', 'Approve the gate.'];
    const out: GateRowChoice[] = [];
    if (a.note !== 'required') out.push({ key: 'approve', label: plain, decision: decisionFor(a), needsNote: false, title });
    if (a.note !== 'none') {
      const fix = a.noteIntent === 'floor_fix';
      // A note that sends the work back (a team dispute's noted approve) is worded as the send-back it is.
      const back = a.noteIntent === 'send_back';
      out.push({ key: 'steer', label: fix ? FLOOR_FIX_WORDS[0] : back ? 'Send back with a note' : noted, decision: decisionFor(a), needsNote: true,
        title: fix ? FLOOR_FIX_WORDS[1] : back ? 'Your note sends the work back to be done again.' : title });
    }
    return out;
  }
  if (a.action === 'skip_rules') {
    const ids = a.rules ?? [];
    return [{
      key: 'skip-rules', label: ids.length === 1 ? `Skip ${ids[0]!}` : `Skip ${ids.length} rules`, decision: decisionFor(a), needsNote: true,
      skipRuleIds: ids, title: `Skip ${ids.join(', ')}, each with your reason. Recorded as skipped by you, on the run, the gate and the delivery.`,
    }];
  }
  if (a.action.startsWith('consent:')) {
    const id = a.action.slice('consent:'.length);
    return [{ key: `choice:${a.action}`, label: id, decision: decisionFor(a), needsNote: false, title: `Answer with “${id}”.` }];
  }
  const [label, title] = NAMED_WORDS[a.action] ?? [a.action.replace(/_/g, ' '), `Answer the gate with ${a.action}.`];
  return [{ key: KEYS[a.action] ?? `offer:${a.action}`, label, decision: decisionFor(a), needsNote: a.note !== 'none', title }];
}

/** The listed answers as row controls: at most three inline before Stop (always the last inline), the rest under ⋯. */
export function contractChoices(actions: readonly GateAction[], seatLabel: (cli: string) => string): { choices: GateRowChoice[]; overflow: GateRowChoice[] } {
  const all = actions.flatMap((a) => choicesForAction(a, seatLabel));
  const stop = all.filter((c) => c.key === 'stop');
  const rest = all.filter((c) => c.key !== 'stop');
  return { choices: [...rest.slice(0, 3), ...stop], overflow: rest.slice(3) };
}

/** The wire tokens a set of row controls would send — what the contract test compares with the list. */
export function choiceTokens(choices: readonly GateRowChoice[]): string[] {
  return [...new Set(choices.map((c) => (c.reassignCli !== undefined ? 'reassign'
    : c.decision === null ? c.key
      : (c.decision as { action?: string }).action ?? (c.decision.approve ? 'approve' : 'reject'))))];
}
