import { create } from 'zustand';
import { addedStep, draftChanges, gateDraftPlan, midRunPlan, wordOf, type DraftStep, type GateDraft } from '../board/planDraft.js';
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

function draftOn(cur: GateDraft | undefined, runId: string, gateKey: string, seed: readonly string[]): GateDraft {
  return cur !== undefined && cur.gateKey === gateKey ? cur : { runId, gateKey, seed: [...seed], added: [], order: null };
}

/** Add a step to a plan gate's draft (a fresh draft when the gate is not the one it was made on). It
 *  joins at the end of the order the operator has (S10). */
export function addGateDraftStep(runId: string, gateKey: string, seed: readonly string[], catalog: string): void {
  usePlanDrafts.setState((s) => {
    const base = draftOn(s.gate[runId], runId, gateKey, seed);
    const order = base.order === null ? null : [...base.order, addedStep(base.added, catalog)];
    return { gate: { ...s.gate, [runId]: { ...base, added: [...base.added, catalog], order } } };
  });
}

/** Put a plan gate's authored steps in another order (S10): the draft the card approves carries it. */
export function reorderGateDraft(runId: string, gateKey: string, seed: readonly string[], order: readonly DraftStep[]): void {
  usePlanDrafts.setState((s) => {
    const base = draftOn(s.gate[runId], runId, gateKey, seed);
    // A step's pool lives in the draft's `pools` (studio#617), never on the stored order.
    return { gate: { ...s.gate, [runId]: { ...base, order: order.map((st) => ({ id: st.id, catalog: st.catalog, added: st.added })) } } };
  });
}

/**
 * Set the worker pool a plan gate's step is sent with (studio#617, wicked-core#810). The first pool
 * set seeds the draft's pools with the held plan's (`held`, by draft id), so approving sends every
 * step's pool, not only the one changed. Lower-only is the caller's rule (`planOrder.setPool`): the
 * store takes the value it is handed.
 */
export function setGateDraftPool(
  runId: string, gateKey: string, seed: readonly string[], held: Readonly<Record<string, number>>, stepId: string, pool: number, ceiling: number,
): void {
  usePlanDrafts.setState((s) => {
    const base = draftOn(s.gate[runId], runId, gateKey, seed);
    const heldPools = base.heldPools ?? { ...held };
    const pools: Record<string, number> = { ...(base.pools ?? heldPools) };
    // Back to what the step would run with anyway (the plan set none, and this is its entry's pool):
    // no override, so no change is reported and nothing extra is sent (codex r1).
    if (heldPools[stepId] === undefined && pool === ceiling) delete pools[stepId];
    else pools[stepId] = pool;
    return { gate: { ...s.gate, [runId]: { ...base, pools, heldPools } } };
  });
}

/** Drop a run's draft — only the one made on `gateKey` when given, so a successor gate's draft survives. */
export function dropGateDraft(runId: string, gateKey?: string): void {
  usePlanDrafts.setState((s) => {
    if (gateKey !== undefined && s.gate[runId]?.gateKey !== gateKey) return s;
    const gate = { ...s.gate };
    delete gate[runId];
    return { gate };
  });
}

/** The draft for this gate instance, or null (a draft made on an earlier gate is not this one's). */
export function gateDraftFor(drafts: Record<string, GateDraft>, runId: string, gateKey: string | null): GateDraft | null {
  const d = drafts[runId];
  return d !== undefined && gateKey !== null && d.gateKey === gateKey && draftChanges(d) ? d : null;
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
