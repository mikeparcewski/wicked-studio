import { create } from 'zustand';
import { api } from '../api/client.js';
import { ApiError, apiWire } from '../api/errors.js';
import { qeRefusalOf } from './qeRefusal.js';
import { isDeliveriesFrozen } from '../api/deliveryFreeze.js';
import { useDeliveryFreezeStore } from '../store/deliveryFreeze.js';
import type { GateDecision, SessionView } from '../api/types.js';
import { jobTitle, plainGateQuestion } from './deskWords.js';
import type { LaunchPlan } from '../api/teamPlan.js';
import { sessionPath } from './sessionModel.js';
import { PLAN_UNSEEN_TEXT, seenPlanRev } from './planRevBinding.js';
import { beginGateRead, gateFromInfo, gateGen, useGateStore, type GateReadTicket } from '../store/gates.js';
import { recordShown } from '../store/gateDiffSeen.js';
import { useMembershipStore } from '../store/membership.js';
import {
  cancelDecision, describeDecision, onDecisionTestReset, queueDecision, reportDecision, restoreNote, runOfKey,
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

/** The undo-queue key for a run's gate decisions (`board/undoQueue.ts` module note). */
export const gateKeyOf = (runId: string): string => `gate:${runId}`;

export interface GateActionState {
  /** Committed but inside the undo window (wave 2a): nothing sent yet, Undo still possible. */
  queued: boolean;
  /** A POST is in flight — the §3.3 "answering…" state. */
  busy: boolean;
  /** The decision landed; the run is advancing (the chip's terminal line). */
  answered: 'approved' | 'rejected' | null;
  /** The named failure, adjacent to the still-enabled controls (§3.3). */
  error: string | null;
  /** The failure is crew's refusal BECAUSE QE acceptance is required (409 `qe_acceptance_required`):
   *  the card shows the QE warning (why, and the way to the setting) instead of the bare line. */
  qeRefusal?: true | undefined;
  /** crew's own sentence for a QE refusal (Technical details only). */
  errorDetail?: string | undefined;
  /** The sent answer's receipt: kind tells RunBlock which component to keep mounted; chosenLabel
   *  and sentAt give GateRow its fold line on remount. Cleared when a new gate arrives. */
  receipt: { kind: 'plan' | 'deliver' | 'row'; chosenLabel: string; sentAt: number } | null;
}

export const IDLE_GATE_ACTION: GateActionState = { queued: false, busy: false, answered: null, error: null, receipt: null };

/** No failure on record (a new attempt starts clean). */
const NO_ERROR = { error: null, qeRefusal: undefined, errorDetail: undefined } as const;

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
 * POSTed on the spot — its inline Undo can take it back, and closing the tab
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
    const title = jobTitle(v.session).trim();
    if (title !== '') workTitles.set(v.session.id, title);
  }
}

/**
 * The gate in words, for the undo notice and the sent / not-sent reports (studio#443): what is
 * being answered, about which piece of work — "the plan for “Fix the double charge”", "the
 * hand-over of “…”", "the review for “…”" — never the run id.
 */
/** The job a run is, in its own words ("“Fix the double charge”"), else where it is ("a run in beta", "this run"). */
export function jobLabel(runId: string): string {
  const title = workTitles.get(runId);
  if (title !== undefined) return `“${title}”`;
  const name = useMembershipStore.getState().projectNameByRun[runId];
  return name !== undefined && name !== '' ? `a run in ${name}` : 'this run';
}

export function gateLabel(runId: string): string {
  const title = workTitles.get(runId);
  const gate = useGateStore.getState().gates[runId];
  if (title !== undefined) {
    const prompt = gate?.prompt ?? '';
    if (gate?.gateKind === 'plan_approval' || /^\s*Approve plan rev \d+/i.test(prompt)) return `the plan for “${title}”`;
    if (gate?.gateKind === 'deliver' || /^\s*Approve delivery\b/i.test(prompt)) return `the hand-over of “${title}”`;
    // Any other gate: its question's noun ("Approve the review" → "the review for “…”"), when it has one.
    // The question's own "?" is not part of the noun ("Approve the schema change?" → "the schema change for …").
    const noun = gate === undefined ? undefined : /^Approve the ([^:()?]+?)\??\s*$/.exec(plainGateQuestion(gate.prompt, gate.gateKind))?.[1];
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
  const state = cur.queued ? 'is waiting to send (undo it where you made it)' : cur.busy ? 'is being sent' : 'was already sent';
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
    /** The gate instance the decision was made on, when the caller showed it earlier (a voice Confirm card): the
     *  decision is refused unsent ('cancelled') unless the run's gate is still that instance, and that instance's
     *  ord is the one sent (codex on #937: a stale card otherwise answered the CURRENT gate, delivery included). */
    expect?: { ord: number; receivedAt: number };
  } = {},
): Promise<DecisionOutcome> {
  const cur = useGateActionStore.getState().byGate[runId] ?? IDLE_GATE_ACTION;
  if (cur.queued || cur.busy || cur.answered !== null) {
    reportDecision('not-sent', dropNotice(runId, cur), { keys: [gateKeyOf(runId)] });
    return Promise.resolve('dropped');
  }
  if (opts.expect !== undefined) {
    const open = useGateStore.getState().gates[runId];
    if (open === undefined || !sameInstance(open, opts.expect)) {
      reportDecision('not-sent', `Not sent: the gate on ${gateLabel(runId)} has moved on since you answered it.`, { keys: [gateKeyOf(runId)] });
      return Promise.resolve('cancelled');
    }
  }
  // DES-CATALOG-002: a run launched from a chat proposal takes a plan answer only with the revision the person was
  // shown, bound here at the moment they decided (never the newest one at send time).
  const rev = seenPlanRev(runId, decision);
  if (rev === null) {
    reportDecision('not-sent', PLAN_UNSEEN_TEXT, { keys: [gateKeyOf(runId)] });
    return Promise.resolve('cancelled');
  }
  if (rev !== undefined) decision = { ...decision, planRev: rev };
  patch(runId, { queued: true, ...NO_ERROR });
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
  // Undo gives the person's words back: the note, or (DES-RULE-CHECK-001) a rule skip's reason, which rides
  // `skipRules` and never `amend`.
  const skips = (decision as { skipRules?: Array<{ reason?: unknown }> }).skipRules;
  const words = amend ?? (typeof skips?.[0]?.reason === 'string' ? skips[0].reason : null);
  // The gate this decision was made on — watched while queued, and sent so the daemon can refuse
  // a decision that outlived its gate (409 gate_changed).
  const gateNow = useGateStore.getState().gates[runId];
  const ord = opts.expect?.ord ?? gateNow?.ord;
  const at = opts.expect?.receivedAt ?? gateNow?.receivedAt;
  return new Promise<DecisionOutcome>((resolve, reject) => {
    const id = queueDecision({
      verb,
      runIds: [runId],
      keys: [gateKeyOf(runId)],
      preview,
      label,
      amend,
      commit: async () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        const decidedAt = Date.now();
        const error = await sendGateDecision(runId, ord === undefined ? decision : { ...decision, ord });
        if (error === null) {
          // studio#244: the diff this gate showed is now the operator's last review of the run.
          recordShown(runId, ord, at, decidedAt);
          if (opts.receipt !== undefined) {
            patch(runId, { receipt: { ...opts.receipt, sentAt: Date.now() } });
          }
          reportDecision('sent', opts.notice?.sent ?? `${PAST[verb] ?? 'Answered'} ${label}.`, { keys: [gateKeyOf(runId)] });
          resolve('sent');
        } else {
          reportDecision('failed', `Not sent: ${label} — ${error}`, { keys: [gateKeyOf(runId)], qe: useGateActionStore.getState().byGate[runId]?.qeRefusal === true });
          reject(new Error(error));
        }
      },
      onUndo: () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        if (words !== null) restoreNote(runId, words);
        resolve('undone');
      },
      onCancel: () => {
        watched.delete(runId);
        patch(runId, { queued: false });
        if (words !== null) restoreNote(runId, words);
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
    reportDecision('not-sent', dropNotice(runId, cur), { keys: [gateKeyOf(runId)] });
    return Promise.resolve('dropped');
  }
  patch(runId, { queued: true, ...NO_ERROR });
  const label = gateLabel(runId);
  const gateNow = useGateStore.getState().gates[runId];
  return new Promise<DecisionOutcome>((resolve, reject) => {
    const id = queueDecision({
      verb: 'approve',
      runIds: [runId],
      keys: [gateKeyOf(runId)],
      preview: `the retry moves to ${seatLabel}`,
      label,
      commit: async () => {
        watched.delete(runId);
        patch(runId, { queued: false, busy: true });
        try {
          await api.reassignRun(runId, cli);
          patch(runId, { busy: false, answered: 'approved', receipt: { kind: 'row', chosenLabel: seatLabel, sentAt: Date.now() } });
          useGateStore.getState().clearGate(runId);
          reportDecision('sent', `Moved ${label} to ${seatLabel}; the retry runs there.`, { keys: [gateKeyOf(runId)] });
          resolve('sent');
        } catch (e) {
          const failed = failureOf(e);
          const why = failed.error;
          patch(runId, { busy: false, ...failed });
          reportDecision('failed', `Not moved: ${label} — ${why}`, { keys: [gateKeyOf(runId)], qe: failed.qeRefusal === true });
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
  patch(runId, { busy: true, ...NO_ERROR });
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
    const failed = failureOf(e);
    patch(runId, failed);
    return failed.error;
  } finally {
    patch(runId, { busy: false });
  }
}

/** What a hand-over refused because QE acceptance hasn't passed says, wherever the failure is told
 *  (the card, the inline result, a batch’s failure list); the card adds the way to the setting. */
export const QE_REFUSED_TEXT = 'Not delivered: QE acceptance hasn’t passed, so nothing was pushed.';

/** A failed decision's state: crew's QE refusal in plain words (its sentence kept as the detail), else
 *  the translated refusal as it was. */
function failureOf(e: unknown): Pick<GateActionState, 'error' | 'qeRefusal' | 'errorDetail'> & { error: string } {
  if (qeRefusalOf(e) === 'delivery') return { error: QE_REFUSED_TEXT, qeRefusal: true, errorDetail: apiWire(e) ?? undefined };
  return { error: e instanceof Error ? e.message : String(e), qeRefusal: undefined, errorDetail: undefined };
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
 *
 * F31: the answer applies only if nothing wrote the run's gate while it was on its way and no read
 * begun after it has applied (`applyGateRead`): an answer sent here, a live frame or a prune is newer
 * than the read, so a read that overlapped one never brings back a gate that is gone; and of two reads
 * the later one wins, whichever lands first.
 */
export function refreshGate(runId: string): Promise<void> {
  return startGateRead(runId).promise;
}

/** F31: a gate read is abandoned after this long, so a hung request cannot hold a run's card, or one of the runs
 *  list's read slots, forever. An abandoned read applies nothing; the next pass reads again. */
export const GATE_READ_DEADLINE_MS = 10_000;

interface GateRead {
  ticket: GateReadTicket;
  promise: Promise<void>;
}
/** The newest gate read of each run while it is on its way. */
const gateReads = new Map<string, GateRead>();

function startGateRead(runId: string): GateRead {
  const ticket = beginGateRead(runId);
  const read: GateRead = { ticket, promise: Promise.resolve() };
  read.promise = (async () => {
    const store = useGateStore.getState();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), GATE_READ_DEADLINE_MS);
    try {
      store.applyGateRead(ticket, gateFromInfo(await api.getGate(runId, deadline.signal)));
    } catch (e) {
      // crew's 404: no open gate. Any other failure (network, the deadline) leaves the store as it was.
      if (e instanceof ApiError && e.status === 404) store.applyGateRead(ticket, null);
    } finally {
      clearTimeout(timer);
      if (gateReads.get(runId) === read) gateReads.delete(runId);
    }
  })();
  gateReads.set(runId, read);
  return read;
}

/**
 * F31: make sure a run that waits on a person has its open gate in the store: nothing when one is
 * cached; else join the read on its way when it was begun at this generation (a read begun before a
 * write is obsolete: it will be dropped, so it cannot stand in); else one new read.
 */
export function ensureGate(runId: string): Promise<void> {
  if (useGateStore.getState().gates[runId] !== undefined) return Promise.resolve();
  const on = gateReads.get(runId);
  if (on !== undefined && on.ticket.gen === gateGen(runId)) return on.promise;
  return startGateRead(runId).promise;
}

/** A gate's one honest affordance: the session thread at the gate anchor. */
export function gateOpenPath(_projectId: string, runId: string): string {
  return sessionPath('run:' + runId) + GATE_HASH;
}

/**
 * studio 0.16.4 (no invisible decisions): where a decision taken with no block on screen to show it goes — its
 * run's gate card for a gate answer, else the run's page (a Stop, a plan step, a power pause). Null for `batch` /
 * `memory-accept`, which are only ever taken in their own block.
 */
export function hostlessPathOf(keys: readonly string[]): string | null {
  // A batch (it carries its members' gates too) is only taken on its bar, so it has no single run page to go to.
  if (keys.includes('batch')) return null;
  const run = keys.map(runOfKey).find((r) => r !== null) ?? null;
  if (run === null) return null;
  return run.kind === 'gate' ? gateOpenPath('', run.runId) : sessionPath('run:' + run.runId);
}
