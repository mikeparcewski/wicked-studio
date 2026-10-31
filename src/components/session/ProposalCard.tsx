import { SKIP_QE_ACTION, SKIP_QE_CONSEQUENCE, SKIP_QE_SEND } from '../../board/qeSkip.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TechDetails } from '../ui/TechDetails.js';
import type { SessionView } from '../../api/types.js';
import type { RunDiff } from '../../api/wave6-wire.js';
import type { ChainModel } from '../../board/chainModel.js';
import { api } from '../../api/client.js';
import { commitGateDecision, GATE_HASH, IDLE_GATE_ACTION, useGateActionStore, type GateAnswer } from '../../board/gateActions.js';
import { deliverCardOf, deliverFailureOf, deliverLine, gateInstance, proposalCard, proposalKindOf, type ProposalKind } from '../../board/proposalCard.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { repoNameOf } from '../../board/deskWords.js';
import type { AskProposal } from '../../board/askThread.js';
import { deliverAcceptance, ownEvidenceOf } from '../../board/checkState.js';
import { overriddenFloorsOf } from '../../board/failingChecks.js';
import type { RunAcceptanceSummary } from '../../api/types.js';
import { useGateStore } from '../../store/gates.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { Tech } from '../Tech.js';
import { draftLine, heldPoolsOf } from '../../board/planDraft.js';
import { planStepWords } from '../../board/planOrder.js';
import { usePlanGate } from '../../store/planGates.js';
import { dropGateDraft, gateDraftFor, gateDraftPlan, usePlanDrafts } from '../../store/planDrafts.js';
import { gateVerdictFor, checkOutcome } from '../gateVerdictModel.js';
import { diffstatOf, unitAmendmentsOf } from '../gateMoveModel.js';
import { PlanGateSummary } from '../PlanGateSummary.js';
import { useSeatTrust } from './GateDepth.js';
import { DriftLine } from './GateRow.js';
import { useDiffDrift } from '../../store/gateDiffSeen.js';
import { deliveryAssuranceOf, deliveryReceiptOf, sessionQe } from '../../board/assuranceModel.js';
import { usePostHocDeliverStore } from '../../store/postHocDeliver.js';
import { AssuranceReceipt, DeliveryAssuranceLines } from './AssuranceReceipt.js';
import { QeDeliveryFixLine, QeRefusalWarning } from '../QeRefusalWarning.js';
import { useRerunFromHere } from '../../hooks/useRerunFromHere.js';
import { retryPrefillOf } from '../../board/needsYou.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { QE_REFUSED_DELIVER } from '../../board/gateHeadline.js';
import { AskCard, type AskReason } from '../ask/AskCard.js';
import type { Ask, AskOption } from '../../api/ask.js';

/** Open a studio route from a card that is handed no navigate (the router listens for popstate). */
function goTo(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * THE PROPOSAL CARD (DES-STUDIO-REBUILD-001 §3 scenes 07/08/24/42, slice S6b): a run's plan or
 * hand-over asked once, in one sentence, inside the session thread — then its progress, then its
 * receipt. Render only: the states and words are `board/proposalCard.ts`.
 *
 * Go and "Yes, deliver" go through `commitGateDecision`, the one decision path (10 s undo, one
 * decision per gate). A second click while the first is pending is ignored here as well, so the
 * gate is posted once. "Not now" sends nothing.
 */
/** The proposal each run last asked, kept outside the card so a remount (switching sessions and
 *  back) still knows an accepted hand-over was one (Copilot). A reload starts empty: the run's own
 *  deliver unit then says so (`proposalCard`'s late-join evidence). */
const lastKinds = new Map<string, ProposalKind>();

/** A plan gate's reject arm, as its card says it. */
export const PLAN_STOP = 'Don’t start';

export function ProposalCard({ view, chain, acceptance = null, ask = null, onBringBack, handedOver = false, variant = 'card', onEdit, editing = false }: {
  view: SessionView;
  chain: ChainModel;
  /** WT-U2 / WT-W3: crew's acceptance summary for the run — the deliver card's one line, verbatim. */
  acceptance?: RunAcceptanceSummary | null;
  /** ASK-S2 (§4.7): the ask path's pending proposal to build — Continue in Build / Not now / End. */
  ask?: AskProposal | null;
  /** ASK-S2: "Bring it back" prefills the composer with the operator's own words, so the PA re-proposes. */
  onBringBack?: (() => void) | undefined;
  /** S16a-1a: the run finished with a hand-over on record (delivered / pushed) and this browser holds
   *  no receipt — the card is that hand-over's receipt, read off the run's delivery verdict. */
  handedOver?: boolean;
  /** DES-CHAT-NATIVE-RUN: `chat` — the card is the body of an assistant message (no box of its own); a plan card
   *  adds "Edit" (the plan editor under the message). */
  variant?: 'card' | 'chat';
  /** chat: "Edit" opens the plan editor under the message (the plan's own artifact). */
  onEdit?: () => void;
  editing?: boolean;
}): React.ReactElement | null {
  const runId = view.session.id;
  const showText = useDisplayText();
  const gate = useGateStore((s) => s.gates[runId]);
  const action = useGateActionStore((s) => s.byGate[runId] ?? IDLE_GATE_ACTION);
  // studio#574: the plan gate's view (the editor's seed) — read only while a plan proposal is open,
  // through the same store `PlanOrderEditor` reads (one read per gate instance).
  const planGate = usePlanGate(runId, view.session.status === 'awaiting_human' && gate !== undefined && proposalKindOf(runId, gate, view.units) === 'plan');
  const [ui, setUi] = useState<{ dismissed: string | null; confirming: string | null }>({ dismissed: null, confirming: null });
  const sending = useRef(false);
  // Fetch events for deliver cards — fallback file count from repoChecksEvaluated.changed.
  // studio#558: the session page's one run-event read (shared with GateRow / OrphanedRow).
  const eventsRaw = useRunEvents(runId).events ?? undefined;
  // core#850: the delivery's assurance receipt — what the run required, what its gates ran and
  // skipped, who built and checked it, the tree delivered.
  // EX-03 / EX-04: crew's record of the hand-over (unverified post-hoc, the QE check).
  const postHocNow = usePostHocDeliverStore((s) => s.byRun[runId]);
  const recordedDelivery = deliveryAssuranceOf(view, postHocNow?.phase === 'delivered' ? { raw: postHocNow.assurance, delivered: true } : undefined);
  const unverified = recordedDelivery !== null && !recordedDelivery.verified;
  const deliveryReceipt = deliveryReceiptOf(view, eventsRaw ?? null, recordedDelivery);
  // studio#577: the acceptance line, with the run's own evidence when crew's gate has no verdict; a floor
  // the operator overrode is said as that, never as green "passed" (rig 0.15.8).
  const accept = deliverAcceptance(acceptance, ownEvidenceOf(eventsRaw ?? []), sessionQe(view, eventsRaw ?? null)?.status === 'required',
    overriddenFloorsOf(deliveryReceipt, eventsRaw ?? null, view));
  // Fetch the diff for deliver cards — primary diffstat source (GET /runs/:id/diff?base=merge-base).
  // Keyed by runId so a run change re-fetches and stale responses are discarded.
  const [runDiffState, setRunDiffState] = useState<{ runId: string; data: RunDiff } | null>(null);
  const fetchedDiffRef = useRef<string | null>(null);
  useEffect(() => {
    if (fetchedDiffRef.current === runId) return;
    fetchedDiffRef.current = runId;
    const capturedRunId = runId;
    api.getRunDiff(runId, undefined, 'merge-base')
      .then((d) => {
        setRunDiffState((prev) => fetchedDiffRef.current === capturedRunId ? { runId: capturedRunId, data: d } : prev);
      })
      .catch(() => { /* diff unavailable — the fallback event count takes over */ });
  }, [runId]);
  // Diff for the current run only; null while loading or when the fetch failed.
  const runDiff = runDiffState?.runId === runId ? runDiffState.data : null;
  // S16a-1b: the creator seat's record rides the deliver card's primary button (never an offer:
  // a deliver gate is not orderable); a plan gate reads no trust.
  const openKind = proposalKindOf(runId, gate, view.units);
  // studio#244: the hand-over says whether the diff moved since the operator's last decision.
  const drift = useDiffDrift(runId, openKind === 'deliver' ? gate : undefined);
  const seat = useSeatTrust(view, openKind === 'deliver' ? gate : undefined, { isPlanGate: openKind === 'plan', isDeliverGate: openKind === 'deliver', isEscalation: false });
  const deliverFailure = openKind === 'deliver' ? deliverFailureOf(eventsRaw ?? [], gate?.ord) : null;
  const card = proposalCard({ view, gate, chain, action, ui, lastKind: lastKinds.get(runId) ?? (handedOver ? 'deliver' : null), ask, deliverFailure: deliverFailure === null ? null : showText(deliverFailure) });
  // Crew refuses this delivery (QE acceptance required, not passed): Deliver is not offered as if it works.
  const deliverRefused = card?.kind === 'deliver' && accept?.blocksDeliver === true;
  const asked = card !== null && gate !== undefined ? card.kind : null;
  useEffect(() => { if (asked !== null) lastKinds.set(runId, asked); }, [runId, asked]);
  // The one "Are you sure?" takes focus when it opens; Cancel gives it back to Deliver (Copilot).
  const yesRef = useRef<HTMLButtonElement | null>(null);
  const goRef = useRef<HTMLButtonElement | null>(null);
  const confirmOpen = card?.state === 'confirm';
  const wasConfirm = useRef(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (confirmOpen) yesRef.current?.focus();
    // Leaving the confirm: Cancel returns to Deliver; "Yes, deliver" leaves no button, so the card
    // itself takes focus and keyboard users keep their place (Copilot).
    else if (wasConfirm.current) (cardRef.current?.querySelector<HTMLElement>('[data-testid="session-proposal-go"]') ?? cardRef.current)?.focus();
    wasConfirm.current = confirmOpen;
  }, [confirmOpen]);
  // S15e Item 4: arriving at the session with #gate focuses the deliver card's primary button so
  // keyboard users land on the actionable control (same affordance as GateRow's rowRef.focus).
  useLayoutEffect(() => {
    if (window.location.hash === GATE_HASH) (goRef.current ?? cardRef.current?.querySelector<HTMLElement>('[data-testid="session-proposal-go"]'))?.focus();
  }, []); // on mount only
  // S7 (§5.7): a `/` command made while the plan question is open is a DRAFT on this card. Only
  // "Approve with these changes" sends it — as the gate's answer, through the one decision path.
  const drafts = usePlanDrafts((s) => s.gate);
  // (guided asks, mockup learn-and-panels h) The card's ways on are option cards; the one you are on names the primary.
  // A refused hand-over's "Run QE again" is the run's own rewind (the engine re-runs from its last creator step, so QE
  // checks the new result), through the gate's undo window.
  const [picked, setPicked] = useState<string | null>(null);
  const rerun = useRerunFromHere(view);
  if (card === null) return null;
  const chat = variant === 'chat';
  const instance = gateInstance(gate);
  // A refused approval that can be tried again keeps the plan's draft too (codex r2 #2: an Edit made after the
  // refusal must ride the retry).
  const draft = card.kind === 'plan' && (card.state === 'ask' || (card.state === 'fail' && card.canRetry)) ? gateDraftFor(drafts, runId, instance) : null;
  // studio#574: the draft's order line names each step as the editor's rows do — from the SAME
  // plan-gate view the draft was seeded from (`planGate.view.planSteps`), never the chain's steps,
  // whose floor insertions can shift the `<catalog>#<n>` keys (codex r1) — so the card and the
  // editor list read one vocabulary.
  const planWords = draft !== null && planGate.view !== null ? planStepWords(planGate.view.planSteps) : undefined;

  const answer = (): void => {
    if (deliverRefused) return; // crew refuses it: never send a delivery that cannot land
    if (sending.current || gate === undefined) return; // double clicks are ignored
    sending.current = true;
    setUi((u) => ({ ...u, confirming: null }));
    // studio#444: the undo notice repeats the card's plain sentence, never the engine's card.
    const deliver = card.kind === 'deliver'
      ? { deliver: { branch: (view.session as unknown as { run_branch?: string }).run_branch ?? null, repo: null, card: deliverLine(view, gate) } }
      : {};
    // The pressed button goes away as the card becomes progress: the card keeps keyboard focus.
    requestAnimationFrame(() => cardRef.current?.focus());
    // A draft answers only the gate it was made on: if the gate moved under it, nothing is sent
    // and the card re-renders for the new gate (codex on S7).
    if (draft !== null && gateInstance(useGateStore.getState().gates[runId]) !== draft.gateKey) { sending.current = false; return; }
    // studio#617: the held plan's pools ride the amended plan (a draft that only adds or moves a step
    // must not reset a pool the plan lowered).
    const held = planGate.view !== null ? heldPoolsOf(planGate.view.editSeed, planGate.view.editPools) : undefined;
    const answer: GateAnswer = draft !== null ? { approve: true, plan: gateDraftPlan(draft, held) } : { approve: true };
    commitGateDecision(runId, answer, { ...deliver, receipt: { kind: card.kind === 'deliver' ? 'deliver' : 'plan', chosenLabel: card.act ?? 'Approve' } })
      .then((outcome) => { if (outcome === 'sent' && draft !== null) dropGateDraft(runId, draft.gateKey); })
      .catch(() => { /* the refusal is in the shared action state, which the card renders */ })
      .finally(() => { sending.current = false; });
  };
  const go = (): void => {
    if (deliverRefused) return;
    if (card.kind === 'deliver' && card.state !== 'confirm') { setUi((u) => ({ ...u, confirming: instance })); return; }
    answer();
  };
  const notNow = (): void => {
    if (ask === null) { setUi({ dismissed: instance, confirming: null }); return; }
    // §4.7 Not now = approve-with-amend whose steps are the ACCEPTED rev's: the proposal was never
    // accepted, so nothing accepted is removed; the floor stays the accepted rev's (empty). Posted
    // through the one decision path; the card then keeps the proposal with "Bring it back".
    if (sending.current || gate === undefined) return;
    sending.current = true;
    commitGateDecision(runId, { approve: true, plan: { steps: ask.acceptedSteps.map((s) => ({ catalog: s.catalog, id: s.id })) } },
      { notice: { preview: 'The conversation goes on; nothing is built. The proposal stays in the thread.', sent: 'Not now — the conversation goes on; nothing was built.' }, receipt: { kind: 'plan', chosenLabel: 'Not now' } })
      .then((outcome) => { if (outcome === 'sent') setUi({ dismissed: instance, confirming: null }); })
      .catch(() => { /* the refusal is in the shared action state, which the card renders */ })
      .finally(() => { sending.current = false; });
  };
  // studio#923: a hand-over QE refused takes the skip IN PLACE (crew's gate action `skip_qe`, a required reason, the
  // gate's undo window), never only by starting the job again.
  const skipQe = (why: string): void => {
    const reason = why.trim();
    if (reason === '' || sending.current || gate === undefined) return;
    sending.current = true;
    const deliver = { deliver: { branch: (view.session as unknown as { run_branch?: string }).run_branch ?? null, repo: null, card: deliverLine(view, gate) } };
    // crew#1181's offer (`GET /runs/:id/gate .skipQe`, action `skip_qe`, a reason required); the gate's `ord` pins the
    // answer to this hand-over (a moved gate is a 409, never a skip somewhere else).
    commitGateDecision(runId, { approve: true, action: SKIP_QE_ACTION, amend: reason, ord: gate.ord } as unknown as GateAnswer,
      { ...deliver, receipt: { kind: 'deliver', chosenLabel: SKIP_QE_SEND } })
      .catch(() => { /* the refusal is in the shared action state, which the card renders */ })
      .finally(() => { sending.current = false; });
  };
  // §4.7 End = reject: the path is cancelled, the conversation is over.
  const end = (why?: string): void => {
    if (sending.current || gate === undefined) return;
    sending.current = true;
    // studio#606 (1): on a deliver card the same reject is "Stop the run" — the run is cancelled.
    const notice = card.kind === 'deliver'
      ? { preview: 'The run stops here; nothing is pushed.', sent: 'Stopped the run; nothing was pushed.' }
      : ask === null
        ? { preview: 'The job stops before anything is built.', sent: 'Stopped the job; nothing was built.' }
        : { preview: 'The conversation ends; the helpers stand down.', sent: 'Ended the conversation.' };
    // Stop asks why (DES-GUIDED-CHAT §4): the words ride the reject into the Decisions ledger.
    const reason = why?.trim() ?? '';
    commitGateDecision(runId, reason !== '' ? { approve: false, amend: reason } : { approve: false }, { notice, receipt: { kind: card.kind === 'deliver' ? 'deliver' : 'plan', chosenLabel: card.end ?? PLAN_STOP } })
      .catch(() => { /* said in the shared action state */ })
      .finally(() => { sending.current = false; });
  };

  // (mockup learn-and-panels h) The plan or the hand-over as a guided ask: every way on is a card, the move recommended
  // and preselected, the one you are on says what happens, and one primary takes it — through the same handlers (and
  // the same 10 s undo) the buttons had. A hand-over crew refuses keeps Deliver as a card, disabled, with why.
  type Way = AskOption & { testid: string; run: (reason?: string) => void };
  const ways: Way[] = [];
  if (deliverRefused && rerun.offer !== null) {
    ways.push({ id: 'qe-again', token: 'qe-again', label: 'Run QE again', consequence: rerun.offer.consequence, recommended: true, testid: 'session-proposal-qe-again',
      ...(rerun.state.kind === 'sending' ? { disabled: 'Starting it again…' } : {}), run: () => { void rerun.rerun(); } });
  }
  if (deliverRefused) {
    ways.push({ id: 'skip-qe', token: SKIP_QE_ACTION, label: 'Skip QE with a reason…', consequence: SKIP_QE_CONSEQUENCE, needsReason: true, testid: 'session-proposal-skip-qe',
      ...(rerun.offer === null ? { recommended: true } : {}), run: (r) => skipQe(r ?? '') });
  }
  ways.push({
    id: 'go', token: 'approve', label: draft !== null ? 'Approve with these changes' : card.act, testid: deliverRefused ? 'session-proposal-go' : 'session-proposal-option',
    consequence: card.kind === 'deliver'
      ? `${card.why ?? 'Hands the work over.'} You confirm once more before it leaves studio.`
      : draft !== null ? 'Your changes go with the approval; the helpers build the plan as you edited it. You can undo for 10 s.'
        : ask !== null ? 'The conversation becomes a build with these steps; review runs on a different helper.'
          : 'The helpers start on this plan; nothing is delivered until you say so.',
    ...(deliverRefused ? { disabled: 'Refused until QE acceptance passes' } : { recommended: true }),
    run: () => go(),
  });
  if (draft !== null) {
    ways.push({ id: 'drop', token: 'drop', label: 'Drop the changes', consequence: 'Your edits are dropped and the plan stays as proposed. Nothing is sent.', testid: 'session-proposal-drop-draft',
      run: () => dropGateDraft(runId, draft.gateKey) });
  }
  if (chat && card.kind === 'plan' && onEdit !== undefined) {
    ways.push({ id: 'edit', token: 'edit', label: editing ? 'Done editing' : 'Change something', testid: 'session-proposal-edit',
      consequence: editing ? 'Closes the plan editor; your changes stay on this card until you approve or drop them.'
        : 'Opens the plan editor under this message: change, add or reorder steps. Nothing is sent until you approve.',
      run: () => onEdit() });
  }
  if (deliverRefused) {
    ways.push({ id: 'relaunch', token: 'relaunch', label: 'Start again with QE skipped…', testid: 'session-proposal-relaunch-skip-qe',
      consequence: 'Opens the launch form with this job’s brief and Skip QE acceptance ticked; this job stays here.',
      run: () => { setRetryPrefill({ ...retryPrefillOf(view), skipQe: true }); goTo('/runs/new'); } });
  }
  ways.push({ id: 'not-now', token: 'not-now', label: 'Not now', testid: 'session-proposal-not-now',
    consequence: ask === null ? 'Hides this here. Nothing is sent: the question stays open and the run waits for you.' : 'The conversation goes on; nothing is built. The proposal stays here.',
    run: () => notNow() });
  // (mockup learn-and-panels h: "Don't start") A plan gate's own reject arm is a card too: the job stops before anything
  // is built. The ask path's End and the hand-over's Stop the run are the card's own words.
  const endLabel = card.end ?? (card.kind === 'plan' && ask === null && gate !== undefined ? PLAN_STOP : undefined);
  if (endLabel !== undefined) {
    ways.push({ id: 'end', token: 'reject', label: endLabel, tone: 'danger', needsReason: true, testid: 'session-proposal-end',
      consequence: card.kind === 'deliver' ? 'The job stops here; nothing is pushed.'
        : ask === null ? 'The job stops before anything is built; nothing changes in the repository.' : 'The conversation ends; the helpers stand down.',
      run: (r) => end(r) });
  }
  const proposalAsk: Ask = {
    id: `${runId}:${instance}`, host: 'gate', from: { kind: 'engine', id: 'engine', label: card.kind === 'deliver' ? 'Hand-over' : 'Plan approval' },
    prompt: card.text, kind: 'choose', answeredBy: 'person', undoMs: 10_000, record: 'You chose: {label}',
    // The ask carries the options only; each way's test id and handler stay with `ways`.
    options: ways.map((w): AskOption => {
      const o: Partial<Way> = { ...w };
      delete o.testid;
      delete o.run;
      return o as AskOption;
    }),
  };
  const primaryId = deliverRefused ? 'session-proposal-primary' : 'session-proposal-go';
  const reasonOf = (o: AskOption): AskReason => o.id === 'skip-qe'
    ? { label: 'Why QE acceptance is skipped', placeholder: 'Why QE acceptance is skipped (the seats couldn’t run the tests, you checked it yourself)…', send: SKIP_QE_SEND,
      note: <p data-testid="session-proposal-skip-qe-consequence" className="wk-gate-consequence">{SKIP_QE_CONSEQUENCE}</p> }
    : { label: card.kind === 'deliver' || ask === null ? 'Why stop? (kept with the record)' : 'Why end it? (kept with the record)', placeholder: 'One line is enough',
      send: card.kind === 'deliver' || ask === null ? 'Stop with this reason' : 'End with this reason' };
  const waysCard = (
    <AskCard
      // Opening or closing the editor puts the selection back on the move (its words may have changed with a draft).
      key={`${instance}:${editing ? 'e' : ''}:${draft !== null ? 'd' : ''}`}
      ask={proposalAsk}
      header={false}
      busy={action.busy}
      onSelect={setPicked}
      testIds={{ root: /* testid */ 'session-proposal-ask', group: /* testid */ 'session-proposal-choices', option: /* testid */ 'session-proposal-option',
        consequence: /* testid */ 'session-proposal-consequence', confirm: primaryId,
        send: picked === 'skip-qe' ? /* testid */ 'session-proposal-skip-qe-send' : primaryId,
        reason: picked === 'skip-qe' ? /* testid */ 'session-proposal-skip-qe-reason' : /* testid */ 'session-proposal-reason-text' }}
      optionProps={(o) => {
        const w = ways.find((x) => x.id === o.id);
        return { 'data-testid': w?.testid, 'data-option': o.id, ...(o.id === 'edit' ? { 'aria-expanded': String(editing) } : {}),
          ...(o.id === 'go' && deliverRefused ? { 'aria-describedby': `${runId}-go-why` } : {}) };
      }}
      confirmProps={(o) => (o?.id === 'go' ? { 'data-draft': draft !== null ? 'true' : 'false' } : {})}
      confirmExtra={(o) => (o?.id === 'go' && card.kind === 'deliver' && seat.record !== null
        ? <span data-testid="session-proposal-track-record" className="wk-session-gate-record">{seat.record}</span> : null)}
      reasonFor={reasonOf}
      // The undo window is said only for a way on that answers the gate (Change something, Drop the changes and a
      // relaunch send nothing).
      footnote={picked === 'go' && card.kind === 'deliver' ? 'Deliver asks once more before anything leaves studio.'
        : picked === 'go' || picked === 'end' || picked === 'skip-qe' || (picked === 'not-now' && ask !== null) ? 'You can undo for 10 s after you continue.' : null}
      onAnswer={(a) => ways.find((w) => w.id === a.option)?.run(a.reason)}
    />
  );

  return (
    <div ref={cardRef} tabIndex={-1} data-testid="session-proposal" data-run-id={runId} data-kind={card.kind} data-state={card.state} data-variant={variant} className={`wk-prop wk-prop--${card.state}${chat ? ' wk-prop--chat' : ''}`}>
      {(card.state === 'ask' || card.state === 'confirm') && (
        <>
          {/* (mockup ui-v2-gate) The cause as the headline: a hand-over QE refused says that, first. */}
          <h2 data-testid="session-proposal-text" className="wk-prop-text wk-gate2-q">{deliverRefused && card.state === 'ask' ? QE_REFUSED_DELIVER : card.text}</h2>
          {deliverRefused && card.state === 'ask'
            ? <p data-testid="session-proposal-why" className="wk-prop-why wk-gate2-p">Delivery is refused until QE acceptance passes. {rerun.offer !== null ? 'Run it again so QE checks it, or skip QE here with a reason.' : 'Skip QE here with a reason, or stop it.'}</p>
            : card.why !== null && card.state === 'ask' && <p data-testid="session-proposal-why" className="wk-prop-why wk-gate2-p">{card.why}</p>}
          {card.state === 'confirm' && card.confirm !== null ? (
            <div data-testid="session-proposal-confirm" role="alertdialog" aria-label={`Are you sure? ${card.confirm.q}`} className="wk-prop-confirm">
              <p className="wk-prop-why"><b>Are you sure? {card.confirm.q}</b> {card.confirm.w}</p>
              <div className="wk-prop-btns">
                <button ref={yesRef} type="button" data-testid="session-proposal-confirm-yes" onClick={answer} disabled={deliverRefused} className="wk-prop-btn wk-prop-btn--danger">{card.confirm.a}</button>
                <button type="button" data-testid="session-proposal-confirm-cancel" onClick={() => setUi((u) => ({ ...u, confirming: null }))} className="wk-prop-btn wk-prop-btn--ghost">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {draft !== null && <p data-testid="session-proposal-draft" className="wk-prop-why"><b>{draftLine(draft, planWords)}</b> Approving sends your changes with it; nothing has been sent yet.</p>}
              <div className="wk-gate2-decide">{waysCard}</div>
              {/* The disabled Deliver's reason (read by assistive tech; the headline and sentence already say it). */}
              {deliverRefused && <p id={`${runId}-go-why`} data-testid="session-proposal-go-why" className="wk-visually-hidden">Delivery is refused until QE acceptance passes.</p>}
            </>
          )}
          {/* (review of the dock) Compact by default: the why of the plan, what QE recorded, the receipt and the
              delivery's own details are behind one "More about this". */}
          <details data-testid="session-proposal-more-about" className="wk-gate2-about">
            <summary className="wk-gate2-link wk-gate2-about-sum">More about this</summary>
            <div className="wk-gate2-about-body">
              {card.kind === 'deliver' && drift !== null && <DriftLine drift={drift} />}
              {/* S16a-1b: the plan gate's score, band, the score's reasons and the floor's additions (PlanGateSummary's own testids kept). */}
              {card.kind === 'plan' && card.state === 'ask' && ask === null && gate !== undefined && (
                <details data-testid="session-proposal-plan-why" className="wk-prop-deliver-detail">
                  <summary className="wk-prop-deliver-summary">Why this plan</summary>
                  <PlanGateSummary view={planGate.view} />
                </details>
              )}
              {/* WT-U2: what the acceptance gate says before the hand-over — crew's line, studio's tone. */}
              {card.kind === 'deliver' && accept !== null && (
                <p data-testid="session-proposal-acceptance" data-tone={accept.tone} className={`wk-prop-why wk-prop-accept wk-prop-accept--${accept.tone}`}>{accept.text}</p>
              )}
              {card.kind === 'deliver' && accept !== null && accept.detail !== undefined && (
                <TechDetails data-testid="session-proposal-acceptance-detail" summary="What QE acceptance recorded" text={accept.detail} />
              )}
              {/* A re-opened deliver gate after a failed hand-over: what checked the work, never "accepted". */}
              {card.kind === 'deliver' && deliveryReceipt !== null && <AssuranceReceipt receipt={deliveryReceipt} passed={deliverFailure === null ? true : null} testId="session-proposal-assurance" />}
              {/* The way on: turn QE acceptance off for later jobs (the link lands on the switch), or what else. */}
              {deliverRefused && card.state === 'ask' && <QeDeliveryFixLine refusalKey={`${runId}:parked`} testId="session-proposal-qe-fix" />}
          {/* The engine's own card (the origin's path, the run branch): underneath only (studio#444). */}
              {card.kind === 'deliver' && (() => {
                // Branch: prefer session.run_branch; fall back to the diff's branch field (source:'branch').
                const branch = (view.session as unknown as { run_branch?: string }).run_branch ?? runDiff?.branch;
                const repoName = repoNameOf(view);
                // Primary diffstat: parse GET /runs/:id/diff?base=merge-base (files changed / +lines / −lines).
                // Fallback: changed-file count from repoChecksEvaluated event when diff is unavailable.
                let diffstatText: string | null = runDiff !== null && typeof runDiff.diff === 'string' ? diffstatOf(runDiff.diff) : null;
                if (diffstatText === null) {
                  // Fallback: event-based changed-file count when diff is unavailable, empty, or parsed to 0.
                  const events = eventsRaw ?? [];
                  const deliverOrd = gate?.ord;
                  const repoChecksEv = deliverOrd !== undefined
                    ? [...events].reverse().find(
                        (e) => (e as unknown as { type?: string; ord?: number }).type === 'repoChecksEvaluated'
                          && (e as unknown as { ord?: number }).ord === deliverOrd,
                      )
                    : undefined;
                  const changedFiles = repoChecksEv !== undefined
                    ? ((repoChecksEv as unknown as { changed?: unknown }).changed)
                    : undefined;
                  const changedCount = Array.isArray(changedFiles) ? changedFiles.length : null;
                  if (changedCount !== null && changedCount > 0) {
                    diffstatText = `${changedCount} file${changedCount === 1 ? '' : 's'} changed`;
                  }
                }
                const floorView = gate !== undefined
                  ? (gateVerdictFor(eventsRaw ?? [], gate.ord, gate.prompt)?.floor ?? null)
                  : null;
                return (
                  <details data-testid="session-proposal-deliver-detail" className="wk-prop-deliver-detail">
                    <summary className="wk-prop-deliver-summary">Delivery details</summary>
                    {diffstatText !== null && (
                      <p data-testid="session-proposal-deliver-diffstat">
                        {diffstatText}
                      </p>
                    )}
                    {branch !== undefined && (
                      <p data-testid="session-proposal-deliver-branch">Branch: <code>{branch}</code></p>
                    )}
                    {repoName !== null && (
                      <p data-testid="session-proposal-deliver-repo">Repository: <code>{repoName}</code></p>
                    )}
                    {floorView !== null && (floorView.checks.length > 0 || floorView.skipped.length > 0) && (
                      <div data-testid="session-proposal-deliver-checks">
                        {floorView.checks.map((c, i) => {
                          const o = checkOutcome(c);
                          return <p key={i} data-testid="session-proposal-deliver-check">{c.name} · {o.ok ? 'passed' : 'failed'} · {o.word} · {Math.round(c.durationMs / 1000)} s</p>;
                        })}
                        {floorView.skipped.map((name, i) => (
                          <p key={`skip-${i}`} data-testid="session-proposal-deliver-check">{name} · skipped</p>
                        ))}
                      </div>
                    )}
                    {/* core#686: the approved intent amendments the hand-over carries, off the unit's own field. */}
                    {unitAmendmentsOf(view.units, gate?.ord).map((a, i) => (
                      <p key={`amend-${i}`} data-testid="session-proposal-deliver-amendment">Approved amendment: {showText(a)}</p>
                    ))}
                    <Tech data-testid="tech-proposal-deliver-card" parts={[deliverCardOf(view, gate)]} block />
                  </details>
                );
              })()}
            </div>
          </details>
        </>
      )}
      {card.state === 'run' && (
        <p className="wk-prop-status">
          <span aria-hidden className="wk-desk-dot wk-desk-dot--working" />
          <b>{card.runLabel}</b>
          <span data-testid="session-proposal-live" className="wk-prop-live">{card.live}</span>
        </p>
      )}
      {card.state === 'cancelled' && (
        <p className="wk-prop-status">
          <b>Cancelled</b>
          <span data-testid="session-proposal-outcome" className="wk-prop-live">{card.out}</span>
        </p>
      )}
      {card.state === 'done' && (
        <p className="wk-prop-status">
          <span aria-hidden className="wk-prop-tick">✓</span>
          <b>Done</b>
          <span data-testid="session-proposal-outcome" className="wk-prop-live">{card.out}</span>
          {/* studio#575: where the work went, on the card the operator approved it from — the same
              `Pull request ↗` the Handed-over row carries; the branch when no PR was opened. */}
          {card.handed !== null && card.handed.href !== null && (
            <span className="wk-prop-live"> · <a href={card.handed.href} target="_blank" rel="noreferrer" data-testid="session-proposal-pr">Pull request ↗</a></span>
          )}
          {card.handed !== null && card.handed.href === null && card.handed.branch !== null && (
            <span data-testid="session-proposal-branch" className="wk-prop-live"> · branch <code>{card.handed.branch}</code></span>
          )}
        </p>
      )}
      {card.state === 'done' && card.kind === 'deliver' && deliveryReceipt !== null && <AssuranceReceipt receipt={deliveryReceipt} passed={unverified ? null : true} testId="session-proposal-assurance" />}
      {card.state === 'done' && card.kind === 'deliver' && <DeliveryAssuranceLines recorded={recordedDelivery} testIdPrefix="session-proposal" />}
      {card.state === 'fail' && (
        <>
          {/* crew refused the hand-over because QE acceptance hasn't passed: why, and the way to the setting. */}
          {action.qeRefusal === true
            ? <QeRefusalWarning kind="delivery" refusalKey={runId} detail={action.errorDetail ?? null} testId="session-proposal-qe-refused" />
            : (
              <p className="wk-prop-status">
                <b className="wk-prop-bad">Didn’t work</b>
                <span data-testid="session-proposal-reason" className="wk-prop-live">{card.reason}</span>
              </p>
            )}
          {card.canRetry && (
            <>
              {draft !== null && <p data-testid="session-proposal-draft" className="wk-prop-why"><b>{draftLine(draft, planWords)}</b> Approving sends your changes with it; nothing has been sent yet.</p>}
              <div className="wk-gate2-decide">{waysCard}</div>
            </>
          )}
        </>
      )}
      {card.state === 'no' && (
        <p className="wk-prop-status">
          <span data-testid="session-proposal-no" className="wk-prop-live">{card.text}</span>
          <button type="button" data-testid="session-proposal-bring-back" onClick={() => { if (ask !== null) onBringBack?.(); else setUi({ dismissed: null, confirming: null }); }} className="wk-since-toggle">Bring it back</button>
        </p>
      )}
    </div>
  );
}
