import { create } from 'zustand';
import { api } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { isDeliveriesFrozen } from '../api/deliveryFreeze.js';
import { useDeliveryFreezeStore } from '../store/deliveryFreeze.js';
import type { GateDecision, SessionView } from '../api/types.js';
import { plainGateQuestion, plainRunTitle } from './deskWords.js';
import type { LaunchPlan } from '../api/teamPlan.js';
import { sessionPath } from './sessionModel.js';
import { choicesOf, recommendedOf, useGateStore } from '../store/gates.js';
import { readDecisionDiff, recordSeen } from '../store/gateDiffSeen.js';
import { useMembershipStore } from '../store/membership.js';
import {
  cancelDecision, describeDecision, onDecisionTestReset, queueDecision, reportDecision, restoreNote,
  type DeliverTarget,
} from './undoQueue.js';

/**
 * The gate a decision answers (`GateDecision.ord`, wicked-crew-api-types 0.44.0 / crew#681): the
 * daemon answers 409 `gate_changed` when it is no longer the open gate and 409 `gate_unknown` when
 * it cannot tell. Crew bundles this dist, so the two ship together: the key is always sent when
 * the gate is known. Local until studio pins api-types ≥ 0.44.0 — then this is plain `GateDecision`.
 */
type GateDecisionWire = GateAnswer & { ord?: number };

/**
 * A gate decision as studio composes it: the pinned `GateDecision`, plus `plan` — approve a
 * `plan_approval` gate WITH AN EDITED PLAN (api-types 0.47.0, DES-TEAMING-002 T3; D11). Local
 * until studio pins an api-types that carries `GateDecision.plan`.
 */
export type GateAnswer = GateDecision & { plan?: LaunchPlan };

/**
 * The ONE gate-decision implementation (DES-FEEDBACK-002 §2.3, slice H): the
 * GateChip's buttons, the palette's Approve/Reject verbs, and the triage keys
 * (`a`/`r`) all answer a gate through `decideGate` — same POST, same
 * double-submit guard, same §3.3 in-flight/error contract. Extracted from
 * `GateChip.tsx` so a keyboard answer and a mouse answer are literally the same
 * action, not two implementations that happen to agree today.
 *
 * State is keyed by run id and RESET whenever a new gate arrives for that run
 * (the gate-store subscription below): a LATER gate on the same run is a fresh
 * decision with fresh state — `answered` for the first gate must never block
 * the second — while the answered line survives the immediate local prune of
 * the gate it answered (`clearGate`) until the daemon's frame moves the run.
 */

/** One-shot focus intent for the thread's gate card, read by the retired gate card.
 *  (Lives here so the chip, the palette, and the triage cursor share it without
 *  a component-module cycle; `GateChip` re-exports it for its old importers.) */
export const GATE_HASH = '#gate';

export interface GateActionState {
  /** Committed but inside the undo window (wave 2a): nothing sent yet, Undo still possible. */
  queued: boolean;
  /** A POST is in flight — the §3.3 "answering…" state. */
  busy: boolean;
  /** The decision landed; the run is advancing (the chip's terminal line). */
  answered: 'approved' | 'rejected' | null;
  /** The named failure, adjacent to the still-enabled controls (§3.3). */
  error: string | null;
  /** The sent answer's receipt: kind tells RunBlock which component to keep mounted; chosenLabel
   *  and sentAt give GateRow its fold line on remount. Cleared when a new gate arrives. */
  receipt: { kind: 'plan' | 'deliver' | 'row'; chosenLabel: string; sentAt: number } | null;
}

export const IDLE_GATE_ACTION: GateActionState = { queued: false, busy: false, answered: null, error: null, receipt: null };

interface GateActionsStore {
  byGate: Record<string, GateActionState>;
}

export const useGateActionStore = create<GateActionsStore>(() => ({ byGate: {} }));

/**
 * studio#606 (3): while a gate answer is IN FLIGHT (past its undo window, the POST sent and not yet
 * answered), leaving the page asks first. The undo window itself stays unguarded on purpose (a
 * decision the operator could not see land must not land — `undoQueue.ts`), and the POST is sent
 * with `keepalive`, so this is a warning, never a flush.
 */
export function answerInFlight(): boolean {
  return Object.values(useGateActionStore.getState().byGate).some((g) => g.busy);
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (!answerInFlight()) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

onDecisionTestReset(() => useGateActionStore.setState({ byGate: {} }));

function patch(runId: string, part: Partial<GateActionState>): void {
  useGateActionStore.setState((s) => ({
    byGate: { ...s.byGate, [runId]: { ...(s.byGate[runId] ?? IDLE_GATE_ACTION), ...part } },
  }));
}

// A gate ARRIVING for a run (first sight, a new ord, or the same ord asked again — a new gate
// INSTANCE, studio#439) is a fresh question — drop any stale decision state so the fresh gate is
// answerable. The answered state an OPEN decision leaves behind survives its own `clearGate` prune
// (removal is not arrival), which is what keeps "approved · advancing…" on the chip until the
// daemon's frame moves the run. Re-reading the SAME instance (same ord and receivedAt) is not an
// arrival.
const sameInstance = (a: { ord: number; receivedAt: number }, b: { ord: number; receivedAt: number }): boolean =>
  a.ord === b.ord && a.receivedAt === b.receivedAt;

useGateStore.subscribe((state, prev) => {
  if (state.gates === prev.gates) return;
  // Wave 2a round 3: a QUEUED decision is about one gate. If that gate leaves (answered elsewhere,
  // the run moved on) or is replaced by a new one (a new ord, or the same ord asked again), the
  // decision is dropped unsent — before the stale-state reset below re-arms the run's controls for
  // whatever is open now.
  for (const [runId, w] of watched) {
    if (w.ord === undefined) continue;
    const now = state.gates[runId];
    if (now === undefined) {
      cancelDecision(w.id, `Not sent: the gate on ${gateLabel(runId)} was answered elsewhere or the run moved on.`);
    } else if (now.ord !== w.ord) {
      cancelDecision(w.id, `Not sent: a new gate opened on ${gateLabel(runId)} — your decision was for the one before it.`);
    } else if (w.at !== undefined && now.receivedAt !== w.at) {
      cancelDecision(w.id, `Not sent: the gate on ${gateLabel(runId)} was asked again — your decision was for the one before it.`);
    }
  }
  const stale = Object.entries(state.gates)
    .filter(([runId, gate]) => {
      const before = prev.gates[runId];
      return before === undefined || !sameInstance(before, gate);
    })
    .map(([runId]) => runId)
    .filter((runId) => useGateActionStore.getState().byGate[runId] !== undefined);
  if (stale.length === 0) return;
  useGateActionStore.setState((s) => {
    const byGate = { ...s.byGate };
    for (const runId of stale) delete byGate[runId];
    return { byGate };
  });
});

/**
 * Answer a gate — `{approve:true}`, or `{approve:false, amend?}` where the
 * optional amend is the reject note the daemon's gate audit durably records
 * (§2.3 wire honesty).
 *
 * Wave 2a: the decision is QUEUED for the undo window (`undoQueue.ts`), never
 * POSTed on the spot — the Undo toast can take it back, and closing the tab
 * inside the window sends nothing. The returned promise settles when the
 * decision is sent (or undone).
 *
 * Guards double submission exactly as the chip always has: a second call while
 * the first is queued, in flight, or landed is dropped rather than sent (a
 * re-sent decision is a 409 at best and a second, unintended decision at
 * worst). On failure the error is named in the shared state and the controls
 * stay live — calling again is the retry.
 */
export function decideGate(runId: string, decision: GateDecision): Promise<void> {
  // Errors are already named in the shared state (the chip renders them).
  return commitGateDecision(runId, decision).then(() => undefined, () => undefined);
}

/** How a committed decision ended: it went out; the operator undid it; the world
 *  cancelled it (its gate left or changed while queued); or the double-submit guard
 *  dropped it (already queued, in flight, or answered). Every outcome but `sent` and
 *  `undone` also reports a visible notice (`undoQueue` results) — never silent. */
export type DecisionOutcome = 'sent' | 'undone' | 'cancelled' | 'dropped';

/** Queued decisions watching their gate: run id → the decision's queue id and the gate instance
 *  (ord, and `receivedAt` — the same ord asked again is another gate, studio#439). */
const watched = new Map<string, { id: number; ord: number | undefined; at?: number }>();

/** Each run's work, in the Desk's words (`plainRunTitle`), as the one run list last read it
 *  (`useRuns` writes it; studio#443). Module state: the notices are made outside React. */
const workTitles = new Map<string, string>();

/** Replace the run → work-title mirror from a fresh run list. */
export function rememberWorkTitles(runs: readonly SessionView[]): void {
  workTitles.clear();
  for (const v of runs) {
    const title = plainRunTitle(v.session.problem ?? '').trim();
    if (title !== '') workTitles.set(v.session.id, title);
  }
}

/**
 * The gate in words, for the undo notice and the sent / not-sent reports (studio#443): what is
 * being answered, about which piece of work — "the plan for “Fix the double charge”", "the
 * hand-over of “…”", "the review for “…”" — never the run id.
 */
export function gateLabel(runId: string): string {
  const title = workTitles.get(runId);
  const gate = useGateStore.getState().gates[runId];
  if (title !== undefined) {
    const prompt = gate?.prompt ?? '';
    if (gate?.gateKind === 'plan_approval' || /^\s*Approve plan rev \d+/i.test(prompt)) return `the plan for “${title}”`;
    if (gate?.gateKind === 'deliver' || /^\s*Approve delivery\b/i.test(prompt)) return `the hand-over of “${title}”`;
    // Any other gate: its question's noun ("Approve the review" → "the review for “…”"), when it has one.
    const noun = gate === undefined ? undefined : /^Approve the ([^:()]+?)\s*$/.exec(plainGateQuestion(gate.prompt, gate.gateKind))?.[1];
    return noun !== undefined ? `the ${noun} for “${title}”` : `“${title}”`;
  }
  // Before the run list has the run (or it has no words): the project, else "this run" — never
  // the id, which stays under technical details (studio#443, codex).
  const name = useMembershipStore.getState().projectNameByRun[runId];
  return name !== undefined && name !== '' ? `a run in ${name}` : 'this run';
}

/** True while `runId` has a decision queued, in flight, or landed — peek, triage and batch skip it. */
export function isDecisionPending(runId: string): boolean {
  const cur = useGateActionStore.getState().byGate[runId];
  return cur !== undefined && (cur.queued || cur.busy || cur.answered !== null);
}

/** Watch `runIds`' gates for a queued decision `id` (the batch's path): capture each open gate's
 *  ord now; a gate that leaves or changes before the send cancels the decision. Returns the ords. */
export function watchDecision(id: number, runIds: readonly string[]): Record<string, number | undefined> {
  const ords: Record<string, number | undefined> = {};
  for (const runId of runIds) {
    const gate = useGateStore.getState().gates[runId];
    ords[runId] = gate?.ord;
    watched.set(runId, { id, ord: gate?.ord, ...(gate !== undefined ? { at: gate.receivedAt } : {}) });
  }
  return ords;
}

/** Stop watching (the decision was sent, undone, or cancelled). */
export function unwatchDecision(runIds: readonly string[]): void {
  for (const runId of runIds) watched.delete(runId);
}

/** The notice for a decision the double-submit guard refused. */
function dropNotice(runId: string, cur: GateActionState): string {
  const state = cur.queued ? 'is waiting to send (see its Undo toast)' : cur.busy ? 'is being sent' : 'was already sent';
  return `Not sent: ${gateLabel(runId)} already has a decision that ${state}.`;
}

const PAST: Record<string, string> = { approve: 'Approved', reject: 'Rejected', 'request-changes': 'Requested changes on', 'edit-plan': 'Added', stop: 'Stopped' };

/**
 * THE decision path, for callers that own their own UI around it (the thread's
 * gate card, the dashboard, the steer composer, the reassign control, the unit
 * detail): queue behind the undo window, then send. Resolves with the outcome;
 * REJECTS with the named error when the POST fails, so a caller keeps its
 * error line. Side effects that assume the decision landed belong behind
 * `outcome === 'sent'`.
 */
export function commitGateDecision(
  runId: string, decision: GateAnswer, opts: {
    deliver?: DeliverTarget | null;
    notice?: { preview: string; sent: string };
    /** Gate kind and chosen label for the receipt stored in GateActionState (Rule 5: remount). */
    receipt?: { kind: 'plan' | 'deliver' | 'row'; chosenLabel: string };
  } = {},
): Promise<DecisionOutcome> {
  const cur = useGateActionStore.getState().byGate[runId] ?? IDLE_GATE_ACTION;
  if (cur.queued || cur.busy || cur.answered !== null) {
    reportDecision('not-sent', dropNotice(runId, cur));
    return Promise.resolve('dropped');
  }
  patch(runId, { queued: true, error: null });
  // studio#368: a deliver gate's approve pushes — the host names the branch and repo when it knows
  // them; any other caller (palette, triage keys) still gets the push line off the gate's kind.
  const deliver = opts.deliver ?? (useGateStore.getState().gates[runId]?.gateKind === 'deliver' ? { branch: null, repo: null } : null);
  // ASK-S2: a card whose answers are not the wire's verbs (Not now = approve-with-amend, End = reject)
  // names the notice in its own words.
  const described = describeDecision(decision, 1, deliver);
  const verb = described.verb;
  const preview = opts.notice?.preview ?? described.preview;
  const label = gateLabel(runId);
  const amend = decision.amend ?? null;
  // The gate this decision was made on — watched while queued, and sent so the daemon can refuse
  // a decision that outlived its gate (409 gate_changed).
  const gateNow = useGateStore.getState().gates[runId];
  const ord = gateNow?.ord;
  const at = gateNow?.receivedAt;
  return new Promise<DecisionOutcome>((resolve, reject) => {
    const id = queueDecision({
      verb,
      runIds: [runId],
      preview,
      label,
      amend,
      commit: async () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        // studio#244: what the operator decided on, kept for the run's next gate ("diff changed since
        // your review"). Read before the post; recorded only once the decision was accepted.
        const decidedAt = Date.now();
        const seenDiff = ord === undefined ? null : await readDecisionDiff(runId);
        const error = await sendGateDecision(runId, ord === undefined ? decision : { ...decision, ord });
        if (error === null) {
          if (seenDiff !== null && ord !== undefined) recordSeen(runId, { ord, at: decidedAt, files: seenDiff });
          if (opts.receipt !== undefined) {
            patch(runId, { receipt: { ...opts.receipt, sentAt: Date.now() } });
          }
          reportDecision('sent', opts.notice?.sent ?? `${PAST[verb] ?? 'Answered'} ${label}.`);
          resolve('sent');
        } else {
          reportDecision('failed', `Not sent: ${label} — ${error}`);
          reject(new Error(error));
        }
      },
      onUndo: () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        if (amend !== null) restoreNote(runId, amend);
        resolve('undone');
      },
      onCancel: () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        if (amend !== null) restoreNote(runId, amend);
        resolve('cancelled');
      },
    });
    watched.set(runId, { id, ord, ...(at !== undefined ? { at } : {}) });
  });
}

/**
 * studio#480: "move this unit to <seat> and retry" from an escalation gate as ONE decision. crew's
 * `POST /runs/:id/reassign` on an `awaiting_human` run approves the gate and reassigns the cursor
 * unit in one call, refusing a seat outside the run's pool BEFORE it approves — so a refused move
 * leaves the gate open and the card that asked it on screen. Same undo window, same per-gate state
 * (no double submit with another approve path), and a refusal is also said as a notice.
 */
export function commitGateReassign(runId: string, cli: string, seatLabel: string): Promise<DecisionOutcome> {
  const cur = useGateActionStore.getState().byGate[runId] ?? IDLE_GATE_ACTION;
  if (cur.queued || cur.busy || cur.answered !== null) {
    reportDecision('not-sent', dropNotice(runId, cur));
    return Promise.resolve('dropped');
  }
  patch(runId, { queued: true, error: null });
  const label = gateLabel(runId);
  const gateNow = useGateStore.getState().gates[runId];
  return new Promise<DecisionOutcome>((resolve, reject) => {
    const id = queueDecision({
      verb: 'approve',
      runIds: [runId],
      preview: `the retry moves to ${seatLabel}`,
      label,
      commit: async () => {
        watched.delete(runId);
        patch(runId, { queued: false, busy: true });
        try {
          await api.reassignRun(runId, cli);
          patch(runId, { busy: false, answered: 'approved', receipt: { kind: 'row', chosenLabel: seatLabel, sentAt: Date.now() } });
          useGateStore.getState().clearGate(runId);
          reportDecision('sent', `Moved ${label} to ${seatLabel}; the retry runs there.`);
          resolve('sent');
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          patch(runId, { busy: false, error: why });
          reportDecision('failed', `Not moved: ${label} — ${why}`);
          reject(new Error(why));
        }
      },
      onUndo: () => { watched.delete(runId); patch(runId, { queued: false }); resolve('undone'); },
      onCancel: () => { watched.delete(runId); patch(runId, { queued: false }); resolve('cancelled'); },
    });
    watched.set(runId, { id, ord: gateNow?.ord, ...(gateNow?.receivedAt !== undefined ? { at: gateNow.receivedAt } : {}) });
  });
}

/**
 * The SEND half — the one `POST /runs/:id/gate` every studio gate decision goes
 * through once its undo window has closed (`decideGate` above, the batch
 * fan-out). Same double-submit guard: a call while a POST is open, or after it
 * landed, is dropped.
 */
export async function sendGateDecision(runId: string, decision: GateDecisionWire): Promise<string | null> {
  const cur = useGateActionStore.getState().byGate[runId] ?? IDLE_GATE_ACTION;
  if (cur.busy || cur.answered !== null) return 'not sent — already answered or still in flight';
  patch(runId, { busy: true, error: null });
  try {
    // The ONLY `confirmGate` call in studio (tests/gateWireSingleCaller.test.ts pins it). A refusal
    // (400, 409 gate_changed / gate_unknown) is never retried: the caller reports it as "Not sent".
    await api.confirmGate(runId, decision as GateDecision);
    patch(runId, { answered: decision.approve ? 'approved' : 'rejected' });
    // Prune the local gate immediately; the run's own status follows from the
    // daemon's frame, which is what actually moves the card (§1.4 live).
    useGateStore.getState().clearGate(runId);
    return null;
  } catch (e) {
    if (gateMovedCode(e) !== null) {
      // The gate this decision was made on is no longer the open one (answered elsewhere or
      // replaced), or the daemon cannot tell which is open. Never re-send: re-read the gate so the
      // person sees what is open now, and say why nothing was sent.
      patch(runId, { busy: false });
      await refreshGate(runId);
      patch(runId, { error: GATE_MOVED_TEXT });
      return GATE_MOVED_TEXT;
    }
    // Idea 15: a frozen deliver approve is refused and the gate stays open — re-read the switch
    // so the status bar's banner shows who froze it, even when someone else did.
    if (isDeliveriesFrozen(e)) void useDeliveryFreezeStore.getState().load();
    const error = e instanceof Error ? e.message : String(e);
    patch(runId, { error });
    return error;
  } finally {
    patch(runId, { busy: false });
  }
}

/** What the person reads when their decision outlived its gate. */
export const GATE_MOVED_TEXT =
  'the gate moved before your decision was sent (it was answered or replaced), so nothing was sent. '
  + 'The open gate is shown again; decide again.';

/** crew's 409 code for a decision that named a gate which is no longer open, else `null`. */
export function gateMovedCode(e: unknown): 'gate_changed' | 'gate_unknown' | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const code = typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>)['code'] : undefined;
  return code === 'gate_changed' || code === 'gate_unknown' ? code : null;
}

/**
 * Re-read the run's open gate (`GET /runs/:id/gate`) into the gate store: the new gate replaces
 * the old one, and no cached gate drops it. A failed read leaves the store as it was.
 */
export async function refreshGate(runId: string): Promise<void> {
  const store = useGateStore.getState();
  try {
    const g = await api.getGate(runId);
    const choices = choicesOf(g as unknown as Record<string, unknown>);
    const recommended = recommendedOf(g as unknown as Record<string, unknown>);
    store.setGate({
      runId: g.runId,
      ord: g.ord,
      prompt: g.prompt,
      lifecycle: g.lifecycle,
      receivedAt: Date.parse(g.receivedAt) || Date.now(),
      ...(choices !== undefined ? { choices } : {}),
      ...(recommended !== undefined ? { recommended } : {}),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) store.clearGate(runId);
  }
}

/** A gate's one honest affordance: the session thread at the gate anchor. */
export function gateOpenPath(_projectId: string, runId: string): string {
  return sessionPath('run:' + runId) + GATE_HASH;
}
