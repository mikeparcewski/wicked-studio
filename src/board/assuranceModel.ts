import type { CoreEvent, SessionView, WorkUnit } from '../api/types.js';

/**
 * The assurance receipt (wicked-core#850 / #852, core-ts 0.7.46): what a run REQUIRES, and for each
 * gate and the delivery what RAN, who made and judged the work, what was SKIPPED and why, on which
 * tree and attempt. Pure — the gate row, the deliver card, the delivery panel and the session header
 * all read these, so none of them can disagree.
 *
 * The wire (camelCase, `null` = the engine's `None`):
 *  - `sessionStarted.assurance` / the session's `assurance` = `{mode, required}`;
 *  - `gateEvaluated.assurance` (also persisted on `WorkUnit.assurance`) and
 *    `deliverLiftEvaluated.assurance` = `{mode, required, ran, skipped[{instrument, reason, detail}],
 *    creator, evaluator, judge, tree, attempt}`.
 * Absent on an older engine: every reader then returns `null` and nothing is drawn.
 */

export type AssuranceMode = 'full' | 'reduced' | (string & {});

export interface RunAssurance {
  mode: AssuranceMode;
  /** `distinct_evaluator` | `judge` | `qe_acceptance` (the contract, before any waiver). */
  required: string[];
  /** (QE-IN-APP-WORKFLOWS, core-ts 0.7.48) The run's QE acceptance decision, when the contract
   *  requires `qe_acceptance`; absent on an older engine. */
  qe?: QeDecision;
}

/**
 * A run's QE acceptance decision (`assurance.qe`, every receipt's `qe`, `qeAcceptanceDecided.qe`):
 * `required` (provisional at launch — `basis: 'plan'` — or from the run's diff), `waived` (the
 * diff scored in the lowest band on every dimension) or `skipped` (the operator, with a reason).
 */
export interface QeDecision {
  status: 'required' | 'waived' | 'skipped' | (string & {});
  basis: 'plan' | 'operator' | 'diff' | (string & {});
  score: number | null;
  threshold: number | null;
  reason: string;
  reasons: string[];
}

/** The decision off the wire, null-safe. */
export function qeDecisionOf(raw: unknown): QeDecision | null {
  if (!isRecord(raw) || typeof raw['status'] !== 'string' || raw['status'] === '') return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    status: raw['status'],
    basis: typeof raw['basis'] === 'string' ? raw['basis'] : '',
    score: num(raw['score']),
    threshold: num(raw['threshold']),
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : '',
    reasons: strings(raw['reasons']),
  };
}

/**
 * The ONE spelling of the decision — the plan, the gate and the delivery all show it:
 * "QE acceptance: required" (", provisional" until the run's QE step scores the diff; ", forced by
 * operator" when forced), "QE acceptance: waived (score N)", "QE acceptance: skipped by operator
 * (<reason>)". `detail` is the engine's full words (the hover).
 */
export function qeWords(qe: QeDecision): { status: string; text: string; detail: string } {
  if (qe.status === 'waived') {
    return { status: 'waived', text: `QE acceptance: waived (score ${qe.score ?? '?'})`, detail: qe.reason };
  }
  if (qe.status === 'skipped') {
    const why = qe.reason.replace(/^QE acceptance skipped by operator:\s*/, '');
    return { status: 'skipped', text: `QE acceptance: skipped by operator (${why})`, detail: qe.reason };
  }
  const how = qe.basis === 'operator'
    ? ', forced by operator'
    : qe.basis === 'plan'
      ? ', provisional'
      : qe.score !== null ? ` (score ${qe.score})` : '';
  return { status: 'required', text: `QE acceptance: required${how}`, detail: qe.reason };
}

/** The run's CURRENT decision: the newest `qeAcceptanceDecided` in the log, else the contract's. */
export function sessionQe(view: SessionView | null | undefined, events: readonly CoreEvent[] | null): QeDecision | null {
  const log = events ?? [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]! as Record<string, unknown>;
    if (e['type'] !== 'qeAcceptanceDecided') continue;
    const q = qeDecisionOf(e['qe']);
    if (q !== null) return q;
  }
  return sessionAssurance(view, events)?.qe ?? null;
}

/** Whether a workflow def requires QE acceptance (`required_instruments` holds `qe_acceptance`). */
export function workflowRequiresQe(def: { required_instruments?: string[] | null } | null | undefined): boolean {
  return (def?.required_instruments ?? []).includes('qe_acceptance');
}

export const QE_SKIP_LABEL = 'Skip QE acceptance';
export const QE_SKIP_DISCLOSURE =
  'This workflow changes the application, so delivery waits for a QE acceptance PASS. Skipping needs '
  + 'a reason, and the run, every gate and the delivery say "QE acceptance: skipped by operator".';
export const QE_FORCE_LABEL = 'Force QE acceptance';
export const QE_FORCE_DISCLOSURE =
  'Require QE acceptance even if the run\'s change scores low enough to waive it.';

export interface SkippedInstrument {
  instrument: string;
  /** `reduced_assurance` | `no_distinct_seat` | `no_boundary` | `error` | `not_applicable`. */
  reason: string;
  detail: string | null;
}

export interface AssuranceReceipt extends RunAssurance {
  /** `pinned_validator` | `repo_checks` | `judge` | `evaluator_pass` | `distinct_evaluator`. */
  ran: string[];
  skipped: SkippedInstrument[];
  creator: string | null;
  evaluator: string | null;
  judge: string | null;
  tree: string | null;
  attempt: number;
  /** Studio's mark on a DELIVERY receipt (every gate's instruments, unioned): its kind, decided per
   *  gate before the union. Its seat names are the gates' names joined for display only. */
  aggregateKind?: AssuranceKind;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

/** The run's contract off any record carrying `{mode, required}`; `null` when it carries none. */
export function runAssuranceOf(raw: unknown): RunAssurance | null {
  if (!isRecord(raw) || typeof raw['mode'] !== 'string' || raw['mode'] === '') return null;
  const qe = qeDecisionOf(raw['qe']);
  return { mode: raw['mode'], required: strings(raw['required']), ...(qe !== null ? { qe } : {}) };
}

/** A receipt off the wire, null-safe; `null` when the value is not one. */
export function receiptOf(raw: unknown): AssuranceReceipt | null {
  const run = runAssuranceOf(raw);
  if (run === null || !isRecord(raw)) return null;
  const skipped: SkippedInstrument[] = Array.isArray(raw['skipped'])
    ? raw['skipped'].flatMap((s) => {
      if (!isRecord(s) || typeof s['instrument'] !== 'string') return [];
      return [{ instrument: s['instrument'], reason: typeof s['reason'] === 'string' ? s['reason'] : '', detail: str(s['detail']) }];
    })
    : [];
  return {
    ...run,
    ran: strings(raw['ran']),
    skipped,
    creator: str(raw['creator']),
    evaluator: str(raw['evaluator']),
    judge: str(raw['judge']),
    tree: str(raw['tree']),
    attempt: typeof raw['attempt'] === 'number' && Number.isFinite(raw['attempt']) ? raw['attempt'] : 0,
  };
}

/** The run's contract: the session record's own (`session.assurance`), else the launch's
 *  `sessionStarted.assurance`; `null` on an engine before the contract. */
export function sessionAssurance(view: SessionView | null | undefined, events: readonly CoreEvent[] | null): RunAssurance | null {
  const own = runAssuranceOf((view?.session as unknown as { assurance?: unknown } | undefined)?.assurance);
  if (own !== null) return own;
  for (const e of events ?? []) {
    if (e.type !== 'sessionStarted') continue;
    const r = runAssuranceOf((e as Record<string, unknown>)['assurance']);
    if (r !== null) return r;
  }
  return null;
}

export function isReduced(a: RunAssurance | null): boolean {
  return a !== null && a.mode === 'reduced';
}

/**
 * The receipt of the evaluation a gate is about: the newest `gateEvaluated` for `ord` that carries
 * one, else that unit's persisted `WorkUnit.assurance` (a session read before its log is in hand).
 * `null` when neither carries a receipt (an older engine, or a unit that was never evaluated).
 */
/** Whether the newest evaluation of `ord` passed (`combined` and no denial); `null` when the log has none. */
export function gatePassedFor(events: readonly CoreEvent[] | null, ord: number | null | undefined): boolean | null {
  if (typeof ord !== 'number') return null;
  const log = events ?? [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]! as Record<string, unknown>;
    if (e['type'] !== 'gateEvaluated' || e['ord'] !== ord) continue;
    return e['combined'] === true && (e['denial'] === null || e['denial'] === undefined);
  }
  return null;
}

export function gateReceiptFor(events: readonly CoreEvent[] | null, units: readonly WorkUnit[] | undefined, ord: number | null | undefined): AssuranceReceipt | null {
  if (typeof ord !== 'number') return null;
  const log = events ?? [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    // A re-dispatch after the newest evaluation: that receipt is the previous attempt's, not this one's.
    if (e.type === 'unitDispatched' && e.ord === ord) return null;
    if (e.type !== 'gateEvaluated' || e.ord !== ord) continue;
    return receiptOf((e as Record<string, unknown>)['assurance']);
  }
  // No log in hand (a session read before its events): the unit record's persisted receipt.
  if (log.length > 0) return null;
  const unit = (units ?? []).find((u) => u.ord === ord);
  return receiptOf((unit as unknown as { assurance?: unknown } | undefined)?.assurance);
}

/**
 * The DELIVERY's receipt: the newest `deliverLiftEvaluated.assurance` (the engine's own aggregate,
 * stamped with the tree delivered), else — before the deliver phase has lifted, as at the deliver
 * gate — the same aggregate the engine builds (`deliver_lift.rs` `delivery_receipt`): the run's
 * contract, every instrument any gate ran, every one any gate skipped (first reason per
 * instrument). `who` lists the seats the gates name, so the card says who built and who checked.
 */
export function deliveryReceiptOf(
  view: SessionView | null | undefined,
  events: readonly CoreEvent[] | null,
  recordedDelivery: DeliveryAssuranceView | null = deliveryAssuranceOf(view),
): AssuranceReceipt | null {
  const log = events ?? [];
  // The CURRENT deliver attempt's lift: a re-dispatch of the deliver unit after it voids it (the
  // retry has not lifted yet), and the receipt falls back to the gates' aggregate.
  let lifted: { ord: unknown; r: AssuranceReceipt } | null = null;
  for (const e of log) {
    if (e.type === 'deliverLiftEvaluated') {
      const r = receiptOf((e as Record<string, unknown>)['assurance']);
      lifted = r === null ? null : { ord: e.ord, r };
    } else if (e.type === 'unitDispatched' && lifted !== null && e.ord === lifted.ord) {
      lifted = null;
    }
  }
  const gates = gateReceipts(view, log);
  const who = whoOf(gates);
  // EX-04: a post-hoc hand-over is the delivery that happened — an earlier attempt's engine lift
  // is not its receipt. Its recorded receipt, else the gates' aggregate below.
  if (recordedDelivery?.via === 'post_hoc') lifted = null;
  const recorded = lifted === null ? recordedDelivery?.receipt ?? null : null;
  if (lifted !== null || recorded !== null) {
    const r = lifted !== null ? lifted.r : recorded!;
    return { ...r, creator: r.creator ?? who.creator, evaluator: r.evaluator ?? who.evaluator, judge: r.judge ?? who.judge, aggregateKind: deliveryKind(r, gates) };
  }
  if (gates.length === 0) return null;
  const run = sessionAssurance(view, log) ?? { mode: gates[0]!.mode, required: gates[0]!.required };
  const out: AssuranceReceipt = { ...run, ran: [], skipped: [], ...who, tree: str((view?.session as unknown as { verified_tree?: unknown } | undefined)?.verified_tree), attempt: 0 };
  for (const g of gates) {
    for (const r of g.ran) if (!out.ran.includes(r)) out.ran.push(r);
    for (const s of g.skipped) if (!out.skipped.some((k) => k.instrument === s.instrument)) out.skipped.push(s);
  }
  return { ...out, aggregateKind: deliveryKind(out, gates) };
}

/**
 * A delivery's kind, from each gate's own kind (a joined seat list proves nothing): `independent`
 * only when some gate accepted on another seat and no gate ran on the creator's seat or skipped a
 * seat-bound instrument; `same-seat` when any gate did run on the creator's seat; `partial` when
 * some gate was independent but another skipped its judge or distinct evaluator.
 */
function deliveryKind(r: AssuranceReceipt, gates: readonly AssuranceReceipt[]): AssuranceKind {
  // No gate history in hand (a partial log): the lift's own receipt, read as one decision.
  if (gates.length === 0) {
    const own: AssuranceReceipt = { ...r };
    delete own.aggregateKind;
    return assuranceKind(own);
  }
  const kinds = gates.map(assuranceKind);
  if (kinds.includes('same-seat') || r.skipped.some((s) => s.instrument === 'distinct_evaluator')) return 'same-seat';
  const seatSkip = r.skipped.some((s) => s.instrument === 'judge');
  if (kinds.includes('independent')) return seatSkip ? 'partial' : 'independent';
  return r.ran.length > 0 ? 'floor-only' : 'unchecked';
}

/** Every unit's CURRENT gate receipt, in ord order, by {@link gateReceiptFor}'s rule: the newest
 *  evaluation of the unit's newest attempt (a re-dispatch voids the one before it, and an evaluation
 *  without a receipt carries none); the unit record only when no log is in hand. */
function gateReceipts(view: SessionView | null | undefined, log: readonly CoreEvent[]): AssuranceReceipt[] {
  const byOrd = new Map<number, AssuranceReceipt>();
  if (log.length > 0) {
    for (const e of log) {
      if (typeof e.ord !== 'number') continue;
      if (e.type === 'unitDispatched') byOrd.delete(e.ord);
      if (e.type !== 'gateEvaluated') continue;
      const r = receiptOf((e as Record<string, unknown>)['assurance']);
      if (r !== null) byOrd.set(e.ord, r); else byOrd.delete(e.ord);
    }
  } else {
    for (const u of view?.units ?? []) {
      const r = receiptOf((u as unknown as { assurance?: unknown }).assurance);
      if (r !== null) byOrd.set(u.ord, r);
    }
  }
  return [...byOrd.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

/** The seats the gates name, comma-joined in first-seen order; `null` when none names one. */
function whoOf(gates: readonly AssuranceReceipt[]): { creator: string | null; evaluator: string | null; judge: string | null } {
  const join = (pick: (g: AssuranceReceipt) => string | null): string | null => {
    const seen: string[] = [];
    for (const g of gates) {
      const s = pick(g);
      if (s !== null && !seen.includes(s)) seen.push(s);
    }
    return seen.length === 0 ? null : seen.join(', ');
  };
  return { creator: join((g) => g.creator), evaluator: join((g) => g.evaluator), judge: join((g) => g.judge) };
}

/**
 * crew's record of what assured a DELIVERY (`AgentSession.delivery_assurance`, crew ≥ 0.9.0):
 * `verified: false` (EX-04) is a post-hoc / recovery delivery — nothing re-verified the tree it
 * pushed; `treeBefore` / `treeAfter` say whether the lift moved it. `qeAcceptance` is the QE check
 * (EX-03) when the contract requires it. `null` on an older daemon or an undelivered run.
 */
export interface DeliveryAssuranceView {
  verified: boolean;
  via: string;
  receipt: AssuranceReceipt | null;
  treeBefore: string | null;
  treeAfter: string | null;
  qeAcceptance: { status?: string; satisfied: boolean; reason: string; verdictId: string | null; reviewer: string | null } | null;
}

/**
 * `postHoc`: this browser's post-hoc hand-over answer (`DeliverRunResult.assurance`), read when the
 * session record does not carry one yet; `postHocDelivered` says such a hand-over landed here, so
 * even an answer without the field (an older daemon) is labelled unverified — nothing re-verified it.
 */
export function deliveryAssuranceOf(view: SessionView | null | undefined, postHoc?: { raw?: unknown; delivered: boolean }): DeliveryAssuranceView | null {
  const own = parseDeliveryAssurance((view?.session as unknown as { delivery_assurance?: unknown } | undefined)?.delivery_assurance);
  if (own !== null) return own;
  const answered = parseDeliveryAssurance(postHoc?.raw);
  if (answered !== null) return answered;
  return postHoc?.delivered === true
    ? { verified: false, via: 'post_hoc', receipt: null, treeBefore: null, treeAfter: null, qeAcceptance: null }
    : null;
}

function parseDeliveryAssurance(raw: unknown): DeliveryAssuranceView | null {
  if (!isRecord(raw) || typeof raw['verified'] !== 'boolean') return null;
  const qe = raw['qeAcceptance'];
  return {
    verified: raw['verified'],
    via: typeof raw['via'] === 'string' ? raw['via'] : '',
    receipt: receiptOf(raw['receipt']),
    treeBefore: str(raw['treeBefore']),
    treeAfter: str(raw['treeAfter']),
    qeAcceptance: isRecord(qe) && typeof qe['satisfied'] === 'boolean'
      ? { ...(typeof qe['status'] === 'string' ? { status: qe['status'] } : {}), satisfied: qe['satisfied'], reason: typeof qe['reason'] === 'string' ? qe['reason'] : '', verdictId: str(qe['verdictId']), reviewer: str(qe['reviewer']) }
      : null,
  };
}

/** The unverified delivery's line (EX-04): what was not re-verified and whether the tree moved. */
export function unverifiedDeliveryLine(d: DeliveryAssuranceView): string | null {
  if (d.verified) return null;
  const short = (t: string): string => t.slice(0, 7);
  const moved = d.treeBefore !== null && d.treeAfter !== null
    ? (d.treeBefore === d.treeAfter ? ` The tree did not move (${short(d.treeAfter)}).` : ` The tree moved from ${short(d.treeBefore)} to ${short(d.treeAfter)} in the hand-over.`)
    : '';
  return `Unverified delivery: nothing re-verified the tree this hand-over pushed.${moved}`;
}

// ── The words ─────────────────────────────────────────────────────────────────────────────────

const INSTRUMENT_WORD: Record<string, string> = {
  distinct_evaluator: 'distinct evaluator',
  judge: 'judge',
  qe_acceptance: 'QE acceptance',
  pinned_validator: 'pinned validator',
  repo_checks: 'repo checks',
  evaluator_pass: 'evaluator pass',
};

const REASON_WORD: Record<string, string> = {
  reduced_assurance: 'reduced assurance',
  no_distinct_seat: 'no distinct seat',
  no_boundary: 'no boundary',
  error: 'error',
  not_applicable: 'not applicable',
};

/** An instrument token in words; a newer engine's token passes through with `_` spaced. */
export function instrumentWord(t: string): string {
  return INSTRUMENT_WORD[t] ?? t.replace(/_/g, ' ');
}

export function skipReasonWord(t: string): string {
  return REASON_WORD[t] ?? (t === '' ? 'no reason given' : t.replace(/_/g, ' '));
}

/**
 * How the decision was assured, in one word the row leads with:
 *  - `independent` — the evaluator ran on a seat distinct from the creator's, or a judge answered
 *    on a seat that is not the creator's;
 *  - `partial` — a delivery some of whose gates were independent and some skipped a judge or a
 *    distinct evaluator;
 *  - `same-seat` — the work was evaluated or judged on the seat that built it (a reduced run, or a
 *    roster with one seat);
 *  - `floor-only` — only deterministic floors (pinned validator, repo checks) or the policy pass ran;
 *  - `unchecked` — nothing ran.
 */
export type AssuranceKind = 'independent' | 'partial' | 'same-seat' | 'floor-only' | 'unchecked';

export function assuranceKind(r: AssuranceReceipt): AssuranceKind {
  if (r.aggregateKind !== undefined) return r.aggregateKind;
  const skippedSame = r.skipped.some((s) => s.instrument === 'distinct_evaluator');
  if (r.ran.includes('distinct_evaluator')) return 'independent';
  // A judge accepts independently only on a KNOWN seat that is not the creator's.
  const judged = r.ran.includes('judge');
  if (judged && r.judge !== null && r.creator !== null && r.judge !== r.creator) return 'independent';
  if ((judged && r.judge !== null && r.judge === r.creator) || skippedSame) return 'same-seat';
  if (r.ran.length > 0) return 'floor-only';
  return 'unchecked';
}

/** The lead word when the decision PASSED (an approval, a delivery) … */
const ACCEPTED_LABEL: Record<AssuranceKind, string> = {
  independent: 'Independently accepted',
  partial: 'Accepted, partly independently',
  'same-seat': 'Accepted on the creator\'s own seat',
  'floor-only': 'Floor-only approval',
  unchecked: 'Approved with nothing checked',
};
/** … and when it did not, or the outcome is not known: what checked it, never "accepted". */
const CHECKED_LABEL: Record<AssuranceKind, string> = {
  independent: 'Checked independently',
  partial: 'Checked partly independently',
  'same-seat': 'Checked on the creator\'s own seat',
  'floor-only': 'Floor checks only',
  unchecked: 'Nothing checked this',
};

/** How the evaluator stood to the creator: separate seats, the same seat (and why), or no
 *  evaluator on this gate. */
export function separationWords(r: AssuranceReceipt): string | null {
  if (r.aggregateKind !== undefined) {
    const k = r.aggregateKind;
    return k === 'independent' ? 'separate seats' : k === 'same-seat' ? (r.mode === 'reduced' ? 'same seat, reduced assurance' : 'same seat') : null;
  }
  if (r.ran.includes('distinct_evaluator')) return 'separate seats';
  const same = r.skipped.find((s) => s.instrument === 'distinct_evaluator');
  if (same !== undefined) return same.reason === 'reduced_assurance' ? 'same seat, reduced assurance' : 'same seat';
  if (r.judge !== null && r.creator !== null) return r.judge === r.creator ? 'judged on the creator\'s seat' : 'judged on a separate seat';
  return null;
}

export interface ReceiptWords {
  kind: AssuranceKind;
  /** Passed: "Independently accepted" / "Floor-only approval" / …; else "Checked independently" / "Floor checks only" / …. */
  label: string;
  reduced: boolean;
  /** "required: distinct evaluator, judge" — or "required: nothing" for an empty contract. */
  required: string;
  /** "ran: repo checks, judge" — or "ran: nothing". */
  ran: string;
  /** "built by claude · evaluated by codex · judged by pi (separate seats)"; null when no seat is named. */
  who: string | null;
  /** "skipped: judge (no distinct seat)"; null when nothing was skipped. */
  skipped: string | null;
  /** Each skip's engine detail, for the hover. */
  skippedDetail: string[];
  /** "tree 1a2b3c4 · attempt 2"; null when neither is known. */
  where: string | null;
}

/** `passed`: the decision the receipt is for passed (`true`), did not (`false`), or is unknown (`null`). */
export function receiptWords(r: AssuranceReceipt, passed: boolean | null = null): ReceiptWords {
  const kind = assuranceKind(r);
  const list = (xs: readonly string[]): string => (xs.length === 0 ? 'nothing' : xs.map(instrumentWord).join(', '));
  const seats: string[] = [];
  if (r.creator !== null) seats.push(`built by ${r.creator}`);
  if (r.evaluator !== null) seats.push(`evaluated by ${r.evaluator}`);
  if (r.judge !== null) seats.push(`judged by ${r.judge}`);
  const sep = separationWords(r);
  const who = seats.length === 0 ? null : `${seats.join(' · ')}${sep !== null ? ` (${sep})` : ''}`;
  const skipped = r.skipped.length === 0
    ? null
    : `skipped: ${r.skipped.map((s) => `${instrumentWord(s.instrument)} (${skipReasonWord(s.reason)})`).join(', ')}`;
  const where: string[] = [];
  if (r.tree !== null) where.push(`tree ${r.tree.slice(0, 7)}`);
  if (r.attempt > 0) where.push(`attempt ${r.attempt}`);
  return {
    kind,
    label: (passed === true ? ACCEPTED_LABEL : CHECKED_LABEL)[kind],
    reduced: r.mode === 'reduced',
    required: `required: ${list(r.required)}`,
    ran: `ran: ${list(r.ran)}`,
    who,
    skipped,
    skippedDetail: r.skipped.flatMap((s) => (s.detail === null ? [] : [`${instrumentWord(s.instrument)}: ${s.detail}`])),
    where: where.length === 0 ? null : where.join(' · '),
  };
}

export const REDUCED_ASSURANCE_LABEL = 'Reduced assurance';

// ── The seat gates the contract raises ────────────────────────────────────────────────────────

/** The newest `gateEscalated` frame for `ord`: its class (`condition`), denial layer and summary. */
export function escalationFor(events: readonly CoreEvent[] | null, ord: number | null | undefined): { condition: string; denialSource: string; summary: string } | null {
  if (typeof ord !== 'number') return null;
  const log = events ?? [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]! as Record<string, unknown>;
    if (e['type'] !== 'gateEscalated' || e['ord'] !== ord) continue;
    return {
      condition: typeof e['condition'] === 'string' ? e['condition'] : '',
      denialSource: typeof e['denialSource'] === 'string' ? e['denialSource'] : '',
      summary: typeof e['verdictSummary'] === 'string' ? e['verdictSummary'] : '',
    };
  }
  return null;
}

/**
 * EX-02: a required judge that could not run holds the gate (`judge_unavailable`) — the work was not
 * rejected; the run waits for a judge seat. Read off the escalation's class, else the engine's
 * prompt ("could not be judged — no eligible judge seat remained").
 */
export function waitsForJudge(events: readonly CoreEvent[] | null, ord: number | null | undefined, prompt: string | undefined): boolean {
  const esc = escalationFor(events, ord);
  if (esc !== null) return esc.condition === 'judge_unavailable' || esc.denialSource === 'judge_unavailable';
  return /could not be judged\b.*no eligible judge seat/i.test(prompt ?? '');
}

// ── The reduced-assurance opt-in (EX-01) ──────────────────────────────────────────────────────

export const REDUCED_OPT_IN_LABEL = 'Run with reduced assurance';

/** What the opt-in means, said before it is taken. */
export const REDUCED_OPT_IN_DISCLOSURE =
  'With one seat, the seat that builds the work is the only one that can review it. Without this, a '
  + 'review step stops and asks for a second seat. With it, the creator\'s seat reviews its own work, '
  + 'a missing judge does not hold a gate, and the session, every gate and the delivery say "Reduced assurance".';

/**
 * EX-01: the dead-seat gate's CREATOR-SEAT refusal — the run requires a distinct evaluator and no
 * seat other than the one that built the work can review it (distribution's refusal, parked at the
 * dead-seat gate, or the fold's `same_seat_evaluator` denial). A team run refuses this for good
 * ("a team run never grades on its creator seat"), so only the distinct-evaluator wording offers
 * the reduced opt-in; a run already reduced never sees it.
 */
export function creatorSeatRefusal(events: readonly CoreEvent[] | null, ord: number | null | undefined, prompt: string | undefined): boolean {
  const esc = escalationFor(events, ord);
  const said = `${esc?.summary ?? ''}\n${prompt ?? ''}`;
  // A team run's refusal is not waivable: reduced assurance would not let it grade on its creator seat.
  if (/team run never grades on its creator seat/i.test(said)) return false;
  if (esc !== null && esc.denialSource === 'same_seat_evaluator') return true;
  if (esc !== null && esc.condition !== 'dead_seat') return false;
  return /requires a distinct evaluator/i.test(said);
}
