import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import type { RunAcceptanceSummary } from '../../api/types.js';
import { useGateStore } from '../../store/gates.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { Tech } from '../Tech.js';
import { draftLine, heldPoolsOf } from '../../board/planDraft.js';
import { planStepWords } from '../../board/planOrder.js';
import { usePlanGate } from '../../store/planGates.js';
import { dropGateDraft, gateDraftFor, gateDraftPlan, usePlanDrafts } from '../../store/planDrafts.js';
import { gateVerdictFor, checkOutcome } from '../gateVerdictModel.js';
import { diffstatOf } from '../gateMoveModel.js';
import { PlanGateSummary } from '../PlanGateSummary.js';
import { useSeatTrust } from './GateDepth.js';

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

export function ProposalCard({ view, chain, acceptance = null, ask = null, onBringBack, handedOver = false }: {
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
  // studio#577: the acceptance line, with the run's own evidence when crew's gate has no verdict.
  const accept = deliverAcceptance(acceptance, ownEvidenceOf(eventsRaw ?? []));
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
  const seat = useSeatTrust(view, openKind === 'deliver' ? gate : undefined, { isPlanGate: openKind === 'plan', isDeliverGate: openKind === 'deliver', isEscalation: false });
  const deliverFailure = openKind === 'deliver' ? deliverFailureOf(eventsRaw ?? [], gate?.ord) : null;
  const card = proposalCard({ view, gate, chain, action, ui, lastKind: lastKinds.get(runId) ?? (handedOver ? 'deliver' : null), ask, deliverFailure: deliverFailure === null ? null : showText(deliverFailure) });
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
    else if (wasConfirm.current) (goRef.current ?? cardRef.current)?.focus();
    wasConfirm.current = confirmOpen;
  }, [confirmOpen]);
  // S15e Item 4: arriving at the session with #gate focuses the deliver card's primary button so
  // keyboard users land on the actionable control (same affordance as GateRow's rowRef.focus).
  useLayoutEffect(() => {
    if (window.location.hash === GATE_HASH) goRef.current?.focus();
  }, []); // on mount only
  // S7 (§5.7): a `/` command made while the plan question is open is a DRAFT on this card. Only
  // "Approve with these changes" sends it — as the gate's answer, through the one decision path.
  const drafts = usePlanDrafts((s) => s.gate);
  if (card === null) return null;
  const instance = gateInstance(gate);
  const draft = card.kind === 'plan' && card.state === 'ask' ? gateDraftFor(drafts, runId, instance) : null;
  // studio#574: the draft's order line names each step as the editor's rows do — from the SAME
  // plan-gate view the draft was seeded from (`planGate.view.planSteps`), never the chain's steps,
  // whose floor insertions can shift the `<catalog>#<n>` keys (codex r1) — so the card and the
  // editor list read one vocabulary.
  const planWords = draft !== null && planGate.view !== null ? planStepWords(planGate.view.planSteps) : undefined;

  const answer = (): void => {
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
  // §4.7 End = reject: the path is cancelled, the conversation is over.
  const end = (): void => {
    if (sending.current || gate === undefined) return;
    sending.current = true;
    // studio#606 (1): on a deliver card the same reject is "Stop the run" — the run is cancelled.
    const notice = card.kind === 'deliver'
      ? { preview: 'The run stops here; nothing is pushed.', sent: 'Stopped the run; nothing was pushed.' }
      : { preview: 'The conversation ends; the helpers stand down.', sent: 'Ended the conversation.' };
    commitGateDecision(runId, { approve: false }, { notice, receipt: { kind: card.kind === 'deliver' ? 'deliver' : 'plan', chosenLabel: card.end ?? 'End' } })
      .catch(() => { /* said in the shared action state */ })
      .finally(() => { sending.current = false; });
  };

  return (
    <div ref={cardRef} tabIndex={-1} data-testid="session-proposal" data-run-id={runId} data-kind={card.kind} data-state={card.state} className={`wk-prop wk-prop--${card.state}`}>
      {(card.state === 'ask' || card.state === 'confirm') && (
        <>
          <p data-testid="session-proposal-text" className="wk-prop-text">{card.text}</p>
          {card.why !== null && card.state === 'ask' && <p data-testid="session-proposal-why" className="wk-prop-why">{card.why}</p>}
          {/* S16a-1b: the plan gate's score, band, the score's reasons and the floor's additions —
              behind the why line (PlanGateSummary's own testids kept). */}
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
                <Tech data-testid="tech-proposal-deliver-card" parts={[deliverCardOf(view, gate)]} block />
              </details>
            );
          })()}
          {card.state === 'confirm' && card.confirm !== null ? (
            <div data-testid="session-proposal-confirm" role="alertdialog" aria-label={`Are you sure? ${card.confirm.q}`} className="wk-prop-confirm">
              <p className="wk-prop-why"><b>Are you sure? {card.confirm.q}</b> {card.confirm.w}</p>
              <div className="wk-prop-btns">
                <button ref={yesRef} type="button" data-testid="session-proposal-confirm-yes" onClick={answer} className="wk-prop-btn wk-prop-btn--danger">{card.confirm.a}</button>
                <button type="button" data-testid="session-proposal-confirm-cancel" onClick={() => setUi((u) => ({ ...u, confirming: null }))} className="wk-prop-btn wk-prop-btn--ghost">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {draft !== null && <p data-testid="session-proposal-draft" className="wk-prop-why"><b>{draftLine(draft, planWords)}</b> Approving sends your changes with it; nothing has been sent yet.</p>}
              <div className="wk-prop-btns">
                <button ref={goRef} type="button" data-testid="session-proposal-go" data-draft={draft !== null ? 'true' : 'false'} onClick={go} className="wk-prop-btn wk-prop-btn--primary">
                  {draft !== null ? 'Approve with these changes' : card.act}
                  {card.kind === 'deliver' && seat.record !== null && <span data-testid="session-proposal-track-record" className="wk-session-gate-record">{seat.record}</span>}
                </button>
                {draft !== null && <button type="button" data-testid="session-proposal-drop-draft" onClick={() => dropGateDraft(runId, draft.gateKey)} className="wk-prop-btn wk-prop-btn--ghost">Drop the changes</button>}
                <button type="button" data-testid="session-proposal-not-now" onClick={notNow} className="wk-prop-btn wk-prop-btn--ghost">Not now</button>
                {card.end !== undefined && <button type="button" data-testid="session-proposal-end" onClick={end} className="wk-prop-btn wk-prop-btn--ghost">{card.end}</button>}
              </div>
            </>
          )}
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
      {card.state === 'fail' && (
        <>
          <p className="wk-prop-status">
            <b className="wk-prop-bad">Didn’t work</b>
            <span data-testid="session-proposal-reason" className="wk-prop-live">{card.reason}</span>
          </p>
          {card.canRetry && (
            <>
              {draft !== null && <p data-testid="session-proposal-draft" className="wk-prop-why"><b>{draftLine(draft, planWords)}</b> Approving sends your changes with it; nothing has been sent yet.</p>}
              <div className="wk-prop-btns">
                <button ref={goRef} type="button" data-testid="session-proposal-go" data-draft={draft !== null ? 'true' : 'false'} onClick={go} className="wk-prop-btn wk-prop-btn--primary">{draft !== null ? 'Approve with these changes' : card.act}</button>
                {draft !== null && <button type="button" data-testid="session-proposal-drop-draft" onClick={() => dropGateDraft(runId, draft.gateKey)} className="wk-prop-btn wk-prop-btn--ghost">Drop the changes</button>}
                <button type="button" data-testid="session-proposal-not-now" onClick={notNow} className="wk-prop-btn wk-prop-btn--ghost">Not now</button>
                {card.end !== undefined && <button type="button" data-testid="session-proposal-end" onClick={end} className="wk-prop-btn wk-prop-btn--ghost">{card.end}</button>}
              </div>
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
