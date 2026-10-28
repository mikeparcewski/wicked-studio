import type { CoreEvent, RosterSeat, RunAcceptanceSummary, SessionView as RunView } from '../api/types.js';
import { reassignCandidates, runBenchesOf, type ReassignCandidate } from '../components/gateVerdictModel.js';
import { isDeliverGate } from '../components/gateMoveModel.js';
import { deliverAcceptance } from './checkState.js';
import { choicesOf, type OpenGate } from '../store/gates.js';
import { creatorSeatRefusal, isReduced, sessionAssurance, sessionQe, waitsForJudge } from './assuranceModel.js';
import { governanceDenialHeadline, plainGateQuestion } from './deskWords.js';
import type { GateRowModel } from './gateRowModel.js';
import { isHelperSeat } from './responder.js';

/**
 * THE GATE'S PLAIN-CAUSE HEADLINE (mockup ui-v2-gate): what a decision is about, in a person's words —
 * "GitHub Copilot CLI can review this instead", "One test this change broke needs fixing before the job
 * can go on" — never the engine's framing. ONE source: the decision dock (GateRow) and every row that
 * names a gate (Needs you, the project home, Nerve Center's cards, via `rowHeadline`) read it here.
 */

/** The seat's name in the Desk's words: the roster's, else its key with a capital ("Copilot"). */
export function seatName(cli: string, label: string | null): string {
  if (label !== null && label !== '') return label;
  const base = cli.split('#')[0] ?? cli;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** The run's seat pool: `session.clis` (the full list), else its units' assigned CLIs. */
export function runPoolOf(view: RunView): string[] {
  const sessionClis = (view.session as unknown as { clis?: unknown }).clis;
  if (Array.isArray(sessionClis) && sessionClis.length > 0) return sessionClis as string[];
  return view.units.map((u) => u.assigned_cli).filter((c): c is string => typeof c === 'string' && c !== '');
}

/**
 * evaluator ≠ creator, read off the live roster: who may judge the gate's step. `builders` are the seats that built
 * the judged work — every creator step at or before the gate, the seat crew names ("built on `codex`") and the seat
 * the gate's own step ran on. `inJob`: a seat of the job's own pool that is none of them and can take work now (the
 * only kind crew's reassign accepts). `outside`: a signed-in helper outside the job that is none of them.
 */
export function judgeSeats(view: RunView, ord: number, prompt: string, pool: readonly string[], roster: readonly RosterSeat[] | null, benched: ReturnType<typeof runBenchesOf> = []): {
  builders: string[]; inJob?: ReassignCandidate; outside?: RosterSeat;
} {
  const builtOn = /built on `([^`]+)`/.exec(prompt)?.[1] ?? null;
  const unitCli = view.units.find((u) => u.ord === ord)?.assigned_cli ?? null;
  const builders = [...new Set([
    ...view.units.filter((u) => u.role === 'creator' && u.ord <= ord && isHelperSeat(u.assigned_cli)).map((u) => u.assigned_cli as string),
    ...(builtOn !== null ? [builtOn] : []),
    ...(isHelperSeat(unitCli) ? [unitCli] : []),
  ])];
  const inJob = reassignCandidates(pool, unitCli, roster, builders, benched).find((c) => c.state === 'ready' && !builders.includes(c.cli));
  const outside = (roster ?? []).find((r) => r.signed_in === true && !pool.includes(r.key) && !builders.includes(r.key) && isHelperSeat(r.key)
    && (r as { health?: { status?: string } }).health?.status !== 'inactive');
  return { builders, ...(inJob !== undefined ? { inJob } : {}), ...(outside !== undefined ? { outside } : {}) };
}

/**
 * Crew's `GET /runs/:id/gate` caches only the prompt (no `choices`, `recommended` or `gateKind`), so a
 * gate this client did not see live — a reload, a late join — lost what the engine offered: a team
 * dispute read back as Approve / Reject only, without its Send back (rig run ac5d1033). The run's own
 * log has the `awaitingHuman` frame that opened the gate; what the cached gate lacks is read from the
 * newest one for the same step. Pure.
 */
export function gateWithLogChoices(gate: OpenGate, events: readonly CoreEvent[]): OpenGate {
  if (gate.choices !== undefined && gate.gateKind !== undefined) return gate;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i] as unknown as Record<string, unknown>;
    if (e['type'] !== 'awaitingHuman' || e['ord'] !== gate.ord) continue;
    const choices = gate.choices !== undefined ? undefined : choicesOf(e);
    const rec = e['recommended'];
    const kind = e['gateKind'];
    return {
      ...gate,
      ...(choices !== undefined ? { choices } : {}),
      ...(gate.recommended === undefined && typeof rec === 'number' ? { recommended: rec } : {}),
      ...(gate.gateKind === undefined && typeof kind === 'string' ? { gateKind: kind } : {}),
    };
  }
  return gate;
}

/**
 * A run's open gate read off its own log: the newest `awaitingHuman` frame (for step `ord` when given) that no
 * later answer or dispatch of that step closed. For a row that names a gate this page never saw live. Pure.
 */
export function openGateFromEvents(runId: string, events: readonly CoreEvent[], ord: number | null = null): OpenGate | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i] as unknown as Record<string, unknown>;
    const at = e['ord'];
    if (typeof at !== 'number' || (ord !== null && at !== ord)) continue;
    if (e['type'] === 'unitDispatched' || e['type'] === 'gateDecided') return null;
    if (e['type'] !== 'awaitingHuman') continue;
    const kind = e['gateKind'];
    const choices = choicesOf(e);
    return {
      runId, ord: at, prompt: typeof e['prompt'] === 'string' ? e['prompt'] : '', lifecycle: 'open', receivedAt: 0,
      ...(choices !== undefined ? { choices } : {}),
      ...(typeof kind === 'string' && kind !== '' ? { gateKind: kind } : {}),
    };
  }
  return null;
}

/** What the headline is made of (GateRow's derived lead reads the same facts). */
export interface GateCause {
  /** The run requires a distinct evaluator and only the builder's seat could review (not a reduced run). */
  seatRefusal: boolean;
  /** A required judge could not run; the gate waits for one. */
  judgeWait: boolean;
  judges: ReturnType<typeof judgeSeats> | null;
  /** The failures new with this change, when the engine told them apart from the base's; else null. */
  fresh: string[] | null;
  /** The cause in plain words, or null when the gate's own question says it. */
  headline: string | null;
}

export function gateCause({ view, gate, events, model, roster, pool = runPoolOf(view), benched = runBenchesOf(view.session) }: {
  view: RunView;
  gate: OpenGate | undefined;
  events: readonly CoreEvent[] | null;
  model: GateRowModel | null;
  roster: readonly RosterSeat[] | null;
  pool?: readonly string[];
  benched?: ReturnType<typeof runBenchesOf>;
}): GateCause {
  const reduced = isReduced(sessionAssurance(view, events));
  const judgeWait = gate !== undefined && model !== null && waitsForJudge(events, gate.ord, gate.prompt);
  const seatRefusal = gate !== undefined && model !== null && !reduced && creatorSeatRefusal(events, gate.ord, gate.prompt);
  const split = model?.failingTests?.split;
  const fresh = split !== undefined ? split.fresh : null;
  const judges = gate === undefined ? null : judgeSeats(view, gate.ord, gate.prompt, pool, roster, benched);
  const broke = fresh !== null && fresh.length > 0
    ? (fresh.length === 1 ? 'One test this change broke needs fixing before the job can go on' : `${fresh.length} tests this change broke need fixing before the job can go on`)
    : null;
  // The failures only this change has come before a missing judge (J4 0.16.6: a fix gate with both led with the judge).
  const headline = seatRefusal ? (judges?.inJob !== undefined ? `${seatName(judges.inJob.cli, judges.inJob.label)} can review this instead`
      : judges?.outside !== undefined ? `${seatName(judges.outside.key, judges.outside.display_name ?? null)} could review this, but isn’t one of this job’s helpers`
        : 'No second helper is free to review this')
    : broke !== null ? broke
      : judgeWait && model?.qe === undefined ? (judges?.inJob !== undefined
        // (J4 0.16.6) The live roster has a helper of this job, not the builder, signed in: say so, never "sign one in".
        ? `${seatName(judges.inJob.cli, judges.inJob.label)} is signed in but wasn’t used to check this step`
        : 'No helper could check this step independently')
        : fresh !== null ? 'Every failing test fails on the base too'
          : gate !== undefined ? governanceDenialHeadline(gate.prompt) : null;
  return { seatRefusal, judgeWait, judges, fresh, headline };
}

/** A governance denial as a plain cause (the words live in deskWords, beside the gate questions). */
export { governanceDenialHeadline };

/** The dock's question: a QE review's why first, then the cause, then the gate's own question in plain words. */
export function gateQuestion(model: GateRowModel | null, headline: string | null, gate: Pick<OpenGate, 'prompt' | 'gateKind'> | undefined): string {
  return model?.qe?.lead ?? headline ?? plainGateQuestion(gate?.prompt, gate?.gateKind);
}

/** The question every unreadable gate falls back to: a row keeps crew's own title instead. */
export const GENERIC_GATE_QUESTION = 'Waiting on your answer';

/** A hand-over QE refused (QE acceptance required and not passed): the dock's hand-over card leads with it, and so does
 *  every row that names that gate (live nit 2026-10-27: the rows read "Approve the hand-over" under a refusal). */
export const QE_REFUSED_DELIVER = 'QE hasn’t passed, so this can’t be delivered yet';

/** Whether crew will refuse this hand-over: the deliver card's own rule (`deliverAcceptance(…).blocksDeliver`). */
export function deliverRefusedByQe(view: RunView, events: readonly CoreEvent[] | null, summary: RunAcceptanceSummary | null | undefined): boolean {
  return deliverAcceptance(summary, null, sessionQe(view, events)?.status === 'required', null)?.blocksDeliver === true;
}

/** A row's headline for a hand-over gate: the refusal when QE refused it, else null (the gate's own question). */
export function deliverRowHeadline(view: RunView, gate: Pick<OpenGate, 'ord' | 'gateKind'>, events: readonly CoreEvent[] | null, summary: RunAcceptanceSummary | null | undefined): string | null {
  const deliver = gate.gateKind === 'deliver' || isDeliverGate(view.session.id, view.units, gate.ord);
  return deliver && deliverRefusedByQe(view, events, summary) ? QE_REFUSED_DELIVER : null;
}
