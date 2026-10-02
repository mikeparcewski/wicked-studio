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
export type ProposalState = 'ask' | 'confirm' | 'run' | 'done' | 'fail' | 'no';

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

/** The proposal a gate makes, or null (every other gate is the row's or its card's). */
export function proposalKindOf(runId: string, gate: OpenGate | undefined, units: readonly WorkUnit[]): ProposalKind | null {
  if (gate === undefined) return null;
  if (gate.gateKind === 'deliver' || isDeliverGate(runId, units, gate.ord)) return 'deliver';
  if (gate.gateKind === 'plan_approval' || /^\s*Approve plan rev \d+/i.test(gate.prompt)) return 'plan';
  return null;
}

/** A plan's steps in words: the proposed chain when the team plan has reached the bus, else the
 *  gate prompt's own arrow list (`… : a → b → c`), each id said as words. */
export function planSteps(chain: ChainModel, prompt: string | undefined): string[] {
  if (chain.steps.length > 0) return chain.steps.map((s) => s.label);
  const list = /\):\s*(.+)$/s.exec(prompt ?? '')?.[1];
  if (list === undefined) return [];
  return list.split('→').map((s) => s.trim()).filter((s) => s !== '').map((id) => {
    const w = id.replace(/[-_]+/g, ' ');
    return w[0]!.toUpperCase() + w.slice(1);
  });
}

/** "Here's the plan: Research → Build → Test (3 steps)." */
export function planSentence(steps: readonly string[]): string {
  if (steps.length === 0) return 'Here’s the plan.';
  return `Here’s the plan: ${steps.join(' → ')} (${steps.length} step${steps.length === 1 ? '' : 's'}).`;
}

/** The run's ONE status sentence: what is happening now, in words, with the step count. */
export function statusSentence(view: SessionView, chain: ChainModel, gate: OpenGate | undefined): string {
  const s = view.session.status;
  const count = chain.total > 0 && !chain.proposed ? ` · ${chain.done} of ${chain.total} done` : '';
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
    return `Stopped${at !== undefined ? ` at ${at.label}` : ''}${count}`;
  }
  if (s === 'cancelled') return `Cancelled${count}`;
  const running = chain.steps.find((x) => x.state === 'running');
  return `${running !== undefined ? `${running.label} is running` : 'Being worked on'}${count}`;
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
  /** The operator pressed "Not now" on this gate (ord), or Deliver and is being asked. */
  ui: { dismissedOrd: number | null; confirmingOrd: number | null };
  /** The registry name of the run's repo, when the host knows it (names whose origin). */
  repoName?: string | null;
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
    if (kind === 'deliver' && ui.confirmingOrd === gate.ord) {
      return {
        ...card, state: 'confirm',
        confirm: { q: 'This leaves studio.', w: card.why ?? '', a: 'Yes, deliver' },
      };
    }
    if (ui.dismissedOrd === gate.ord) return { ...card, state: 'no', text: 'Not now — nothing started.' };
    if (action.error !== null) return { ...card, state: 'fail', reason: action.error, canRetry: true, act: 'Try again' };
    return card;
  }

  // No proposal open. A team run's plan was proposed and answered: the card is its progress, then
  // its receipt. A run that never proposed (free text, a registered def) has no card.
  const card = base('plan');
  // Just answered here: the gate is pruned on the 200, before the accepted plan reaches the bus.
  if (action.answered === 'approved' && !TERMINAL.has(status) && chain.source === 'team') {
    return { ...card, state: 'run', runLabel: 'Going', live: 'Starting the work' };
  }
  if (chain.source !== 'team' || chain.proposed || chain.total === 0) return null;
  if (!TERMINAL.has(status)) {
    return { ...card, state: 'run', runLabel: 'Going', live: statusSentence(view, chain, gate) };
  }
  if (status === 'completed') return { ...card, state: 'done', out: outcomeLine(view) };
  return { ...card, state: 'fail', reason: statusSentence(view, chain, gate), canRetry: false };
}
