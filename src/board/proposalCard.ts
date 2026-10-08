import { executingOrd } from '../api/run-state.js';
import type { SessionView, WorkUnit } from '../api/types.js';
import { deliverUnit, deliveryOf, resolveDelivery } from '../components/delivery.js';
import { deliverTargetOf, isDeliverGate } from '../components/gateMoveModel.js';
import type { OpenGate } from '../store/gates.js';
import type { GateActionState } from './gateActions.js';
import { gatePlanLabels, type ChainModel } from './chainModel.js';
import { plainDeliverSentence, repoNameOf } from './deskWords.js';
import type { AskProposal } from './askThread.js';

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
 *    with what it sends off the machine in one plain sentence (`plainDeliverSentence` over the
 *    deliver unit's own target card, `deliverTargetOf`; the card itself only under technical details).
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
  /** done: where the work went (studio#575) — the pull request when one is in hand (the same `href`
   *  the Handed-over row links), else the branch a push-only hand-over landed on; null when neither. */
  handed: { href: string | null; branch: string | null } | null;
  /** fail: why, in the daemon's words. */
  reason: string | null;
  /** fail with an open gate keeps its buttons (Try again / Not now). */
  canRetry: boolean;
  /** ASK-S2: the third answer (End) — only on the ask's Continue in Build card. */
  end?: string;
}

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/** A gate that reports a failure (an escalation, a refused or conflicted delivery): never a
 *  proposal — its card carries the failure, the evidence and the retry (Copilot). */
const FAILURE_PROMPT = /LIFT-CONFLICT|BASE MOVED|failed and triage escalated|verdict is NOT PASS|deliver: .*refused/i;

/** The proposal a gate makes, or null (every other gate is the session thread's GateRow). A plan
 *  approval is classified first; an escalation is never a hand-over. def / run_level / unit_review
 *  gates belong to GateRow (Approve / Approve and steer / Send back / Stop). */
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

/** A plan's steps in words, in the chain's own labels (studio#442: one name per step, from one
 *  source). WHICH steps: the plan gate's own plan when its prompt lists one — what Go approves,
 *  floor additions included (studio#470: the PA's proposal on the bus predates the floor fill) —
 *  else a proposal newer than the accepted plan (`chain.pending`), else the PROPOSED team chain
 *  (never the units, never an older accepted revision). Each id is named as the chain names it,
 *  the gate's trailing sentences dropped (Copilot). */
export function planSteps(chain: ChainModel, prompt: string | undefined): string[] {
  const fromGate = gatePlanLabels(prompt, chain.source === 'team' ? chain.steps : []);
  if (fromGate !== null) return fromGate.labels;
  if (chain.source === 'team' && chain.pending !== undefined && chain.pending.length > 0) return chain.pending.map((s) => s.label);
  if (chain.source === 'team' && chain.proposed && chain.steps.length > 0) return chain.steps.map((s) => s.label);
  return [];
}

/** studio#470: the steps the floor added to the plan, said under the proposal ("+3 required by the
 *  floor: Test plan, Architecture, Security check"), or null when it added none. */
export function floorLine(prompt: string | undefined, chain?: ChainModel): string | null {
  // The same known steps `planSteps` labels with, so the line names them as the sentence does.
  const floor = gatePlanLabels(prompt, chain !== undefined && chain.source === 'team' ? chain.steps : [])?.floor ?? [];
  return floor.length === 0 ? null : `${floor.length} required by the floor: ${floor.join(', ')}.`;
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
  /** ASK-S2 (DES-ASK-TEAM-CHAT-001 §4.7): the PA's pending proposal to build on an ask path — the
   *  plan gate is "Continue in Build?", with the band and the blast radius, and three answers. */
  ask?: AskProposal | null;
}

/** The ask's plan card words: the steps (floor additions marked), then the band and blast radius. */
export function askProposalWords(ask: AskProposal, pa: string | null): { text: string; why: string } {
  const steps = ask.steps.map((s) => `${s.label[0]!.toUpperCase()}${s.label.slice(1)}${s.floor ? ' (required)' : ''}`).join(' → ');
  // The touch set is declared PATHS (a directory counts as one), never a file count the card did not take.
  const files = ask.touch.length === 0 ? null : `touches ${ask.touch.length} declared path${ask.touch.length === 1 ? '' : 's'}`;
  const deps = ask.dependents === null ? null : `${ask.dependents} dependent${ask.dependents === 1 ? '' : 's'}`;
  // §8 F10: a proposal that declared no scope says so whatever band the engine gave it (X1 fail-closed).
  const band = ask.band === null ? null : `band ${ask.band.replace('-', '–')}`;
  const noScope = ask.touch.length === 0 ? 'high risk — the helper declared no scope' : null;
  const radius = [band, noScope, files, deps].filter((x): x is string => x !== null).join(' · ');
  const who = ask.by ?? pa ?? 'the helper';
  // Who does the building: the PA's seat when every build step is the PA's (the default owner); a
  // step the plan gives the team runs on a member seat — the card never claims a seat the plan did
  // not name (codex on ASK-S2 r5).
  const builds = ask.steps.filter((s) => s.label === 'build');
  const teamOwned = builds.some((s) => s.owner === 'team');
  const seat = teamOwned ? 'Continue starts the work — a helper takes the team\u2019s build step' : `Continue starts the work on ${who}'s seat`;
  return {
    text: `Continue in Build? ${who} proposes: ${steps}.`,
    why: `${radius !== '' ? `${radius} · ` : ''}${seat}; review runs on a different helper, and the reviewer carries over. Not now keeps the conversation going; End closes it.`,
  };
}

/** What the deliver approve sends off the machine, in one plain sentence (studio#444): the target
 *  from the deliver unit's own card, never the card's words, path or run branch. */
export function deliverLine(view: SessionView, gate: OpenGate | undefined, repoName: string | null = null): string {
  // No card (a def authored without one): the push, with the pull request as the condition it is.
  return plainDeliverSentence(deliverTargetOf(view.units, gate?.ord), repoName ?? repoNameOf(view));
}

/** The engine's own card (with its path and run branch), for the technical handle under the
 *  hand-over: shown only with "Show technical details" on. */
export function deliverCardOf(view: SessionView, gate: OpenGate | undefined): string | null {
  return deliverTargetOf(view.units, gate?.ord);
}

/** A late join's memory of a hand-over: the run's deliver unit is under way or done. */
function deliverEvidence(view: SessionView): ProposalKind | null {
  const du = deliverUnit(view);
  if (du === null) return null;
  return du.status === 'done' || executingOrd(view.session, view.units) === du.ord ? 'deliver' : null;
}

function base(kind: ProposalKind): ProposalCardModel {
  return {
    kind, state: 'ask', text: '', why: null, act: kind === 'deliver' ? 'Deliver' : 'Go', confirm: null,
    runLabel: null, live: null, out: null, reason: null, canRetry: false, handed: null,
  };
}

/** studio#575: what the finished run handed over, through the one derivation every PR claim uses
 *  (`resolveDelivery`): the PR's `href` when the wire has one, else the pushed branch, else null. */
export function handedOf(view: SessionView): { href: string | null; branch: string | null } | null {
  const d = resolveDelivery(deliveryOf(view));
  const href = d.href;
  const branch = href === null ? (d.pushed?.branch ?? null) : null;
  return href === null && branch === null ? null : { href, branch };
}

/** The card for one run, or null when the run has nothing to propose and never had. */
export function proposalCard(input: ProposalInput): ProposalCardModel | null {
  const { view, gate, chain, action, ui } = input;
  const status = view.session.status;
  const kind = proposalKindOf(view.session.id, gate, view.units);
  const instance = gateInstance(gate);

  // ASK-S2 (§4.7): the ask's proposal card reads its OUTCOME off the proposal's own rows once the plan
  // gate is answered — Not now keeps the proposal here with "Bring it back"; End is the end; Continue
  // is progress until the engine accepts the rev (the card then yields to the run's block).
  if (input.ask && !input.ask.gateOpen && input.ask.decision !== null) {
    const card = base('plan');
    const words = askProposalWords(input.ask, null);
    card.text = words.text; card.why = words.why; card.act = 'Continue in Build'; card.end = 'End';
    if (input.ask.decision === 'human_amended') return { ...card, state: 'no', text: 'Not now — the conversation goes on; the proposal stays here.' };
    if (input.ask.decision === 'reject') return { ...card, state: 'cancelled', out: 'Ended — the conversation is over.' };
    return { ...card, state: 'run', runLabel: 'Going', live: 'Starting the work' };
  }
  // The answer was sent and the local gate pruned (`sendGateDecision` clears it at once), but the
  // engine's `gate.decided` row has not landed yet: the card says what was answered from the host's
  // own state — never "Starting the work" for a Not now — until the rows take over.
  if (input.ask && gate === undefined && input.ask.gateOpen && (ui.dismissed !== null || action.answered !== null || action.busy || action.queued || action.error !== null)) {
    const card = base('plan');
    const words = askProposalWords(input.ask, null);
    card.text = words.text; card.why = words.why; card.act = 'Continue in Build'; card.end = 'End';
    if (ui.dismissed !== null) return { ...card, state: 'no', text: 'Not now — the conversation goes on; the proposal stays here.' };
    if (action.answered === 'rejected') return { ...card, state: 'cancelled', out: 'Ended — the conversation is over.' };
    // The answer was refused and the gate it was made on is gone (409 gate_changed, then no cached
    // gate): the refusal is said, with the three choices kept (r2 #9).
    if (action.error !== null && !action.busy && !action.queued && action.answered === null) {
      return { ...card, state: 'fail', reason: `${action.error} The question is being read again; the answers come back with it.`, canRetry: false };
    }
    return { ...card, state: 'run', runLabel: 'Going', live: action.queued ? 'Sending in a moment — Undo is in the notice' : 'Starting the work' };
  }

  if (kind !== null && gate !== undefined) {
    const card = base(kind);
    const ask = kind === 'plan' ? input.ask ?? null : null;
    if (ask !== null) {
      const words = askProposalWords(ask, null);
      card.text = words.text;
      card.why = words.why;
      card.act = 'Continue in Build';
      card.end = 'End';
      // Not now was SENT (the accepted rev re-approved): the card is the proposal kept, not progress.
      if (ui.dismissed === instance) return { ...card, state: 'no', text: 'Not now — the conversation goes on; the proposal stays here.' };
    } else {
      card.text = kind === 'plan' ? planSentence(planSteps(chain, gate.prompt)) : 'Ready to hand it over.';
      card.why = kind === 'plan'
        ? ['Go starts the work; nothing is built until you say so.', floorLine(gate.prompt, chain)].filter((x) => x !== null).join(' ')
        : deliverLine(view, gate, input.repoName ?? null);
    }
    if (action.queued || action.busy || action.answered !== null) {
      return {
        ...card, state: 'run', runLabel: kind === 'deliver' ? 'Handing over' : 'Going',
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
    // A refused answer on the ask's card keeps its THREE explicit choices — Try again would re-send an
    // approve for a Not now or an End (codex on ASK-S2 #3).
    if (action.error !== null) return { ...card, state: 'fail', reason: action.error, canRetry: true, ...(ask !== null ? {} : { act: 'Try again' }) };
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
  if (status === 'completed') return { ...card, state: 'done', out: outcomeLine(view), handed: handedOf(view) };
  // Cancelled is its own outcome, never a failure (board/metrics.ts).
  if (status === 'cancelled') return { ...card, state: 'cancelled', out: statusSentence(view, chain, gate) };
  return { ...card, state: 'fail', reason: statusSentence(view, chain, gate), canRetry: false };
}

/** S16a-1a (studio#583 / #587): which card a FINISHED run opened fresh shows — no gate open, no
 *  receipt in this browser — read off the daemon's delivery verdict alone. `handed` = the receipt
 *  (delivered: the pull request; pushed: the branch); `stranded` = the "Deliver — open a PR" door;
 *  null = the status sentence's outcome line only (nothing to deliver, failed, none). */
export type FinishedDeliveryArm = 'handed' | 'stranded' | null;

export function finishedDeliveryArm(view: SessionView, gate: OpenGate | undefined): FinishedDeliveryArm {
  if (gate !== undefined || view.session.status !== 'completed') return null;
  const s = deliveryOf(view).state;
  if (s === 'delivered' || s === 'pushed') return 'handed';
  if (s === 'stranded') return 'stranded';
  return null;
}

/** The post-hoc deliver's state as the stranded card reads it (`store/postHocDeliver.ts`). */
export type StrandedPress =
  | { phase: 'delivering' }
  | { phase: 'delivered'; prUrl: string }
  | { phase: 'error'; error: string }
  | undefined;

export interface StrandedCardModel {
  state: 'ask' | 'delivering' | 'delivered' | 'error';
  /** The outcome sentence (`outcomeLine`'s stranded words; "Finished · delivered" once it lands). */
  out: string;
  /** The primary button's words. */
  act: string;
  /** delivered: the pull request the POST answered. */
  prUrl: string | null;
  /** error: studio's headline, then the daemon's words verbatim. */
  error: { headline: string; detail: string } | null;
}

/** The stranded card (S16a-1a): pure over the run and the post-hoc deliver's answer. */
export function strandedCard(view: SessionView, press: StrandedPress): StrandedCardModel {
  const base: StrandedCardModel = { state: 'ask', out: outcomeLine(view), act: 'Deliver — open a PR', prUrl: null, error: null };
  if (press === undefined) return base;
  if (press.phase === 'delivering') return { ...base, state: 'delivering', act: 'Delivering…' };
  if (press.phase === 'delivered') return { ...base, state: 'delivered', out: 'Finished · delivered', prUrl: press.prUrl };
  return { ...base, state: 'error', error: { headline: 'Delivery failed — the run is still stranded.', detail: press.error } };
}
