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
}

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
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

/** The run's contract off any record carrying `{mode, required}`; `null` when it carries none. */
export function runAssuranceOf(raw: unknown): RunAssurance | null {
  if (!isRecord(raw) || typeof raw['mode'] !== 'string' || raw['mode'] === '') return null;
  return { mode: raw['mode'], required: strings(raw['required']) };
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
    if (e.type !== 'gateEvaluated' || e.ord !== ord) continue;
    const r = receiptOf((e as Record<string, unknown>)['assurance']);
    if (r !== null) return r;
    break;
  }
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
export function deliveryReceiptOf(view: SessionView | null | undefined, events: readonly CoreEvent[] | null): AssuranceReceipt | null {
  const log = events ?? [];
  let lifted: AssuranceReceipt | null = null;
  for (let i = log.length - 1; i >= 0 && lifted === null; i--) {
    const e = log[i]!;
    if (e.type === 'deliverLiftEvaluated') lifted = receiptOf((e as Record<string, unknown>)['assurance']);
  }
  const gates = gateReceipts(view, log);
  const who = whoOf(gates);
  if (lifted !== null) return { ...lifted, creator: lifted.creator ?? who.creator, evaluator: lifted.evaluator ?? who.evaluator, judge: lifted.judge ?? who.judge };
  if (gates.length === 0) return null;
  const run = sessionAssurance(view, log) ?? { mode: gates[0]!.mode, required: gates[0]!.required };
  const out: AssuranceReceipt = { ...run, ran: [], skipped: [], ...who, tree: str((view?.session as unknown as { verified_tree?: unknown } | undefined)?.verified_tree), attempt: 0 };
  for (const g of gates) {
    for (const r of g.ran) if (!out.ran.includes(r)) out.ran.push(r);
    for (const s of g.skipped) if (!out.skipped.some((k) => k.instrument === s.instrument)) out.skipped.push(s);
  }
  return out;
}

/** Every unit's newest gate receipt, in ord order (the log first, the unit record as fallback). */
function gateReceipts(view: SessionView | null | undefined, log: readonly CoreEvent[]): AssuranceReceipt[] {
  const byOrd = new Map<number, AssuranceReceipt>();
  for (const e of log) {
    if (e.type !== 'gateEvaluated' || typeof e.ord !== 'number') continue;
    const r = receiptOf((e as Record<string, unknown>)['assurance']);
    if (r !== null) byOrd.set(e.ord, r);
  }
  for (const u of view?.units ?? []) {
    if (byOrd.has(u.ord)) continue;
    const r = receiptOf((u as unknown as { assurance?: unknown }).assurance);
    if (r !== null) byOrd.set(u.ord, r);
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
 *  - `same-seat` — the work was evaluated or judged on the seat that built it (a reduced run, or a
 *    roster with one seat);
 *  - `floor-only` — only deterministic floors (pinned validator, repo checks) or the policy pass ran;
 *  - `unchecked` — nothing ran.
 */
export type AssuranceKind = 'independent' | 'same-seat' | 'floor-only' | 'unchecked';

export function assuranceKind(r: AssuranceReceipt): AssuranceKind {
  if (r.ran.includes('distinct_evaluator')) return 'independent';
  const judged = r.ran.includes('judge');
  const judgeOnCreator = judged && r.judge !== null && r.creator !== null && r.judge === r.creator;
  if (judged && !judgeOnCreator) return 'independent';
  if (judgeOnCreator || r.skipped.some((s) => s.instrument === 'distinct_evaluator')) return 'same-seat';
  if (r.ran.length > 0) return 'floor-only';
  return 'unchecked';
}

/** The lead word when the decision PASSED (an approval, a delivery) … */
const ACCEPTED_LABEL: Record<AssuranceKind, string> = {
  independent: 'Independently accepted',
  'same-seat': 'Accepted on the creator\'s own seat',
  'floor-only': 'Floor-only approval',
  unchecked: 'Approved with nothing checked',
};
/** … and when it did not, or the outcome is not known: what checked it, never "accepted". */
const CHECKED_LABEL: Record<AssuranceKind, string> = {
  independent: 'Checked independently',
  'same-seat': 'Checked on the creator\'s own seat',
  'floor-only': 'Floor checks only',
  unchecked: 'Nothing checked this',
};

/** How the evaluator stood to the creator: separate seats, the same seat (and why), or no
 *  evaluator on this gate. */
export function separationWords(r: AssuranceReceipt): string | null {
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
