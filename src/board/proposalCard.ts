import { executingOrd } from '../api/run-state.js';
import type { SessionView, WorkUnit } from '../api/types.js';
import { deliverUnit, deliveryOf } from '../components/delivery.js';
import { deliverTargetOf, isDeliverGate } from '../components/gateMoveModel.js';
import type { OpenGate } from '../store/gates.js';
import type { GateActionState } from './gateActions.js';
import type { ChainModel } from './chainModel.js';
import { deliverPreview } from './undoQueue.js';

/**
 * THE PROPOSAL CARD (DES-STUDIO-REBUILD-001 §3 scenes 07/08/24/42, slice S6b). Pure.
 *
 * A session proposes in one sentence and asks once: the plan ("Here's the plan: Research → Build →
 * Test → Review. Go?") and the hand-over ("Ready to deliver"). The card then becomes its own
 * progress, then its receipt — one card, never a second one for the same run.
 *
 *  - Which gates it asks: a plan approval and a deliver gate. Every other gate is answered in its
 *    Desk row (S5) or on its card; the card says nothing for them.
 *  - Go goes through `commitGateDecision` (the one decision path: 10 s undo, one decision per gate,
 *    a double click dropped). Deliver asks the one "Are you sure?" first (DESIGN-interaction §1),
 *    with what it sends off the machine (`deliverPreview` over the deliver unit's own target
 *    sentence, `deliverTargetOf`).
 *  - A refused answer (the daemon's 4xx) is said with its reason and the buttons stay.
 *  - "Not now" sends nothing: the proposal is kept in the thread, with "Bring it back".
 */

export type ProposalKind = 'plan' | 'deliver';
export type ProposalState = 'ask' | 'confirm' | 'run' | 'done' | 'cancelled' | 'fail' | 'no';

/** A step's label in words: never the engine's instruction segment (` ||| …`, `INSTRUCTION_SEP`). */
export function stepWords(label: string): string {
  const cut = label.indexOf(' ||| ');
  return (cut === -1 ? label : label.slice(0, cut)).trim();
}

export interface ProposalCardModel {
  kind: ProposalKind;
  state: ProposalState;
  /** The proposal in one sentence (ask / confirm / no). */
  text: string;
  /** What answering does, under the sentence. */
  why: string | null;
  /** The primary button. */
  act: string;
  /** The "Are you sure?" (deliver only). */
  confirm: { q: string; w: string; a: string } | null;
  /** run: the label ("Going", "Handing over") and the live status sentence. */
  runLabel: string | null;
  live: string | null;
  /** done: the one outcome line. */
  out: string | null;
  /** fail: why, in the daemon's words. */
  reason: string | null;
  /** fail with an open gate keeps its buttons (Try again / Not now). */
  canRetry: boolean;
}

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/** A gate that reports a failure (an escalation, a refused or conflicted delivery): never a
 *  proposal — its card carries the failure, the evidence and the retry (Copilot). */
const FAILURE_PROMPT = /LIFT-CONFLICT|BASE MOVED|failed and triage escalated|verdict is NOT PASS|deliver: .*refused/i;

/** The proposal a gate makes, or null (every other gate is the row's or its card's). A plan
 *  approval is classified first; an escalation is never a hand-over. */
export function proposalKindOf(runId: string, gate: OpenGate | undefined, units: readonly WorkUnit[]): ProposalKind | null {
  if (gate === undefined) return null;
  if (gate.gateKind === 'plan_approval' || /^\s*Approve plan rev \d+/i.test(gate.prompt)) return 'plan';
  if (gate.gateKind === 'escalation' || FAILURE_PROMPT.test(gate.prompt)) return null;
  if (gate.gateKind === 'deliver' || isDeliverGate(runId, units, gate.ord)) return 'deliver';
  return null;
}

/** One gate instance: a run can reopen a gate at the same ord, which asks afresh (Copilot). */
export function gateInstance(gate: OpenGate | undefined): string | null {
  return gate === undefined ? null : `${gate.ord ?? '-'}:${gate.receivedAt}`;
}

/** A plan's steps in words: the PROPOSED team chain when it has reached the bus (never the units,
 *  never an older accepted revision), else the gate prompt's own arrow list (`… : a → b → c`), each
 *  id said as words, with the gate's trailing instruction sentence dropped (Copilot). */
export function planSteps(chain: ChainModel, prompt: string | undefined): string[] {
  if (chain.source === 'team' && chain.proposed && chain.steps.length > 0) return chain.steps.map((s) => s.label);
  const list = /\):\s*(.+)$/s.exec(prompt ?? '')?.[1];
  if (list === undefined) return [];
  const steps = list.split('→').map((s) => s.trim()).filter((s) => s !== '');
  if (steps.length > 0) steps[steps.length - 1] = steps[steps.length - 1]!.split(/[.;]\s/)[0]!.replace(/[.;]$/, '').trim();
  return steps.filter((s) => s !== '').map((id) => {
    const w = id.replace(/[-_]+/g, ' ');
    return w[0]!.toUpperCase() + w.slice(1);
  });
}

/** "Here's the plan: Research → Build → Test (3 steps)." */
export function planSentence(steps: readonly string[]): string {
  if (steps.length === 0) return 'Here’s the plan.';
  return `Here’s the plan: ${steps.join(' → ')} (${steps.length} step${steps.length === 1 ? '' : 's'}).`;
}

/** The run's ONE status sentence: what is happening now, in words, with the step count. While an
 *  answer is queued (the 10 s undo window) or being sent, it says so — never that work started. */
export function statusSentence(view: SessionView, chain: ChainModel, gate: OpenGate | undefined, action?: GateActionState): string {
  const s = view.session.status;
  const count = chain.total > 0 && !chain.proposed ? ` · ${chain.done} of ${chain.total} done` : '';
  if (action !== undefined && (s === 'awaiting_human' || gate !== undefined)) {
    if (action.queued) return `Your answer goes in a moment — Undo is in the notice${count}`;
    if (action.busy) return `Sending your answer${count}`;
    if (action.answered === 'approved') return `Answered — starting${count}`;
  }
  if (s === 'awaiting_human' || gate !== undefined) {
    const kind = proposalKindOf(view.session.id, gate, view.units);
    const what = kind === 'plan' ? 'Waiting on your go for the plan'
      : kind === 'deliver' ? 'Ready to deliver — waiting on you'
        : 'Waiting on you';
    return `${what}${count}`;
  }
  if (s === 'completed') return `${outcomeLine(view)}${count}`;
  if (s === 'failed') {
    const at = chain.steps.find((x) => x.state === 'failed');
    return `Stopped${at !== undefined ? ` at ${stepWords(at.label)}` : ''}${count}`;
  }
  if (s === 'cancelled') return `Cancelled${count}`;
  const running = chain.steps.find((x) => x.state === 'running');
  return `${running !== undefined ? `${stepWords(running.label)} is running` : 'Being worked on'}${count}`;
}

/** A finished run's one outcome line, from the daemon's delivery verdict — never more than it says. */
export function outcomeLine(view: SessionView): string {
  const d = deliveryOf(view);
  switch (d.state) {
    case 'delivered': return 'Finished · delivered';
    case 'pushed': return 'Finished · branch pushed';
    case 'stranded':
      return deliverUnit(view) === null
        ? 'Finished · kept on this machine, not pushed'
        : 'Finished, but the work hasn’t been pushed anywhere yet';
    case 'nothing-to-deliver': return 'Finished · nothing to deliver';
    case 'failed': return 'Finished, but delivery failed';
    default: return 'Finished';
  }
}

export interface ProposalInput {
  view: SessionView;
  gate: OpenGate | undefined;
  chain: ChainModel;
  action: GateActionState;
  /** The gate instance (`gateInstance`) the operator pressed "Not now" on, or Deliver and is being asked. */
  ui: { dismissed: string | null; confirming: string | null };
  /** The registry name of the run's repo, when the host knows it (names whose origin). */
  repoName?: string | null;
  /** The proposal this card last asked (the host remembers it): after its gate is pruned, an
   *  accepted hand-over still reads as one (codex). */
  lastKind?: ProposalKind | null;
}

/** What the deliver approve sends off the machine, in the gate card's own words when it has them. */
export function deliverLine(view: SessionView, gate: OpenGate | undefined, repoName: string | null = null): string {
  const branch = (view.session as unknown as { run_branch?: unknown }).run_branch;
  return deliverPreview({
    branch: typeof branch === 'string' ? branch : null,
    repo: repoName,
    card: deliverTargetOf(view.units, gate?.ord),
  });
}

/** A late join's memory of a hand-over: the run's deliver unit is under way or done. */
function deliverEvidence(view: SessionView): ProposalKind | null {
  const du = deliverUnit(view);
  if (du === null) return null;
  return du.status === 'done' || executingOrd(view.session, view.units) === du.ord ? 'deliver' : null;
}

function base(kind: ProposalKind): ProposalCardModel {
  return {
    kind, state: 'ask', text: '', why: null, act: kind === 'plan' ? 'Go' : 'Deliver', confirm: null,
    runLabel: null, live: null, out: null, reason: null, canRetry: false,
  };
}

/** The card for one run, or null when the run has nothing to propose and never had. */
export function proposalCard(input: ProposalInput): ProposalCardModel | null {
  const { view, gate, chain, action, ui } = input;
  const status = view.session.status;
  const kind = proposalKindOf(view.session.id, gate, view.units);
  const instance = gateInstance(gate);

  if (kind !== null && gate !== undefined) {
    const card = base(kind);
    card.text = kind === 'plan' ? planSentence(planSteps(chain, gate.prompt)) : 'Ready to hand it over.';
    card.why = kind === 'plan'
      ? 'Go starts the work; nothing is built until you say so.'
      : deliverLine(view, gate, input.repoName ?? null);
    if (action.queued || action.busy || action.answered !== null) {
      return {
        ...card, state: 'run', runLabel: kind === 'plan' ? 'Going' : 'Handing over',
        live: action.queued ? 'Sending in a moment — Undo is in the notice' : 'Sending your answer',
      };
    }
    if (kind === 'deliver' && ui.confirming === instance) {
      return {
        ...card, state: 'confirm',
        confirm: { q: 'This leaves studio.', w: card.why ?? '', a: 'Yes, deliver' },
      };
    }
    if (ui.dismissed === instance) return { ...card, state: 'no', text: 'Not now — nothing started.' };
    if (action.error !== null) return { ...card, state: 'fail', reason: action.error, canRetry: true, act: 'Try again' };
    return card;
  }

  // No proposal open. A proposal this card asked (remembered by the host), a hand-over the run's own
  // units show under way or done, or a team run whose plan was accepted: the card is its progress,
  // then its receipt. A run that never proposed (free text, a registered def) has no card.
  // While a gate this card does not ask is open (an escalation, a retry), nothing is inferred from the
  // units: a rejected deliver unit under an open escalation is a stopped hand-over, not one under way.
  const inferred = gate === undefined && status !== 'awaiting_human' ? deliverEvidence(view) : null;
  const remembered = input.lastKind ?? inferred ?? null;
  if (remembered === null && (chain.source !== 'team' || chain.proposed || chain.total === 0)) return null;
  const card = base(remembered ?? 'plan');
  if (!TERMINAL.has(status)) {
    // Answered here, and the daemon has not moved the run yet: say it is starting — only until then.
    const starting = action.answered === 'approved' && status === 'awaiting_human';
    const live = starting ? (card.kind === 'deliver' ? 'Pushing the work' : 'Starting the work') : statusSentence(view, chain, gate);
    return { ...card, state: 'run', runLabel: card.kind === 'deliver' ? 'Handing over' : 'Going', live };
  }
  if (status === 'completed') return { ...card, state: 'done', out: outcomeLine(view) };
  // Cancelled is its own outcome, never a failure (board/metrics.ts).
  if (status === 'cancelled') return { ...card, state: 'cancelled', out: statusSentence(view, chain, gate) };
  return { ...card, state: 'fail', reason: statusSentence(view, chain, gate), canRetry: false };
}
