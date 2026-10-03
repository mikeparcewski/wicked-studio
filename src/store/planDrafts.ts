import { create } from 'zustand';
import { gateDraftPlan, midRunPlan, wordOf, type GateDraft } from '../board/planDraft.js';
import { onDecisionTestReset, queueDecision, reportDecision } from '../board/undoQueue.js';
import { proposePlanEdit, usePlanEdits } from './planEdits.js';

/**
 * The composer's plan drafts (DES-STUDIO-REBUILD-001 §5.7, slice S7) — the behaviour behind `/`.
 *
 *  - Gate-amend drafts wait here, per run, until the plan gate's card approves them (the card
 *    sends {@link gateDraftPlan} through the one gate decision path) or the operator drops them.
 *    A draft belongs to the gate instance it was made on: a new gate never inherits it.
 *  - Mid-run steps go through the undo queue (verb `edit-plan`): 10 s with Undo, then exactly one
 *    `POST /runs/:id/plan` with a fresh `requestId` (`store/planEdits`). After that the step stays
 *    — a running plan only grows — and the run's line says "Added …" with no Undo.
 */

interface PlanDraftsStore {
  gate: Record<string, GateDraft>;
  /** Steps a mid-run edit added (sent and taken), per run, in order — the "Added …" line. */
  added: Record<string, string[]>;
  /** Steps queued in the undo window, per run, with the queued decision's id (the Undo handle). */
  queued: Record<string, Array<{ catalog: string; id: number }>>;
}

export const usePlanDrafts = create<PlanDraftsStore>(() => ({ gate: {}, added: {}, queued: {} }));

onDecisionTestReset(() => usePlanDrafts.setState({ gate: {}, added: {}, queued: {} }));

/** Add a step to a plan gate's draft (a fresh draft when the gate is not the one it was made on). */
export function addGateDraftStep(runId: string, gateKey: string, seed: readonly string[], catalog: string): void {
  usePlanDrafts.setState((s) => {
    const cur = s.gate[runId];
    const base = cur !== undefined && cur.gateKey === gateKey ? cur : { runId, gateKey, seed: [...seed], added: [] };
    return { gate: { ...s.gate, [runId]: { ...base, added: [...base.added, catalog] } } };
  });
}

export function dropGateDraft(runId: string): void {
  usePlanDrafts.setState((s) => {
    const gate = { ...s.gate };
    delete gate[runId];
    return { gate };
  });
}

/** The draft for this gate instance, or null (a draft made on an earlier gate is not this one's). */
export function gateDraftFor(drafts: Record<string, GateDraft>, runId: string, gateKey: string | null): GateDraft | null {
  const d = drafts[runId];
  return d !== undefined && gateKey !== null && d.gateKey === gateKey && d.added.length > 0 ? d : null;
}

export { gateDraftPlan };

function setAdded(runId: string, f: (l: string[]) => string[]): void {
  usePlanDrafts.setState((s) => ({ added: { ...s.added, [runId]: f(s.added[runId] ?? []) } }));
}

function setQueued(runId: string, f: (l: Array<{ catalog: string; id: number }>) => Array<{ catalog: string; id: number }>): void {
  usePlanDrafts.setState((s) => ({ queued: { ...s.queued, [runId]: f(s.queued[runId] ?? []) } }));
}

/**
 * Queue a mid-run step: "Adding Test to “…” in 10 s · Undo". Undo inside the window sends nothing;
 * after it, one POST with a fresh `requestId`. Returns the queued decision's id.
 */
export function queueMidRunStep(runId: string, catalog: string, title: string): number {
  const word = wordOf(catalog);
  let qid = -1;
  const removeQueued = (): void => setQueued(runId, (l) => l.filter((q) => q.id !== qid));
  qid = queueDecision({
    verb: 'edit-plan',
    runIds: [runId],
    label: `${word} to “${title}”`,
    preview: `${word} joins the run’s plan at its next step. Once added it stays: a running plan only grows.`,
    closeNote: 'Close this tab before then and nothing is sent: the plan stays as it is.',
    commit: async () => {
      removeQueued();
      await proposePlanEdit(runId, midRunPlan(catalog));
      const st = usePlanEdits.getState().byRun[runId];
      if (st?.status === 'sending') {
        // proposePlanEdit drops a second edit while one is in flight: this one was NOT sent.
        reportDecision('not-sent', `Not added: ${word} to “${title}” — another step was still being sent. Add it again.`);
      } else if (st?.status === 'done') {
        setAdded(runId, (l) => [...l, catalog]);
        reportDecision('sent', `Added ${word} to “${title}”.`);
      } else {
        reportDecision('failed', `Not added: ${word} to “${title}” — ${st?.error ?? 'the daemon did not answer'}`);
      }
    },
    onUndo: removeQueued,
  });
  setQueued(runId, (l) => [...l, { catalog, id: qid }]);
  return qid;
}
