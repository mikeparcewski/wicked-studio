import type { CoreEvent, RunAcceptanceSummary, WalkthroughStepState } from '../api/types.js';
import { attemptBefore, gateVerdict } from '../components/gateVerdictModel.js';
import { fmtTime } from './walkthroughModel.js';
import type { ChainModel, ChainStep } from './chainModel.js';

/**
 * "Checked" (DES-WALKTHROUGH-PROOF-001 §3 scenes 21, 22, 28; §4.9; slice WT-U2, placed by rebuild S13):
 * the only source of the word is crew's acceptance read — `GET /runs/:id/acceptance` →
 * `walkthrough.steps[].checkState`, computed by crew at every read from the newest SEALED
 * walkthrough. Nothing here derives it from a unit's status, a plan row or a take on screen.
 *
 *  - `checked`      → the step is "checked", with a chip "checked at 0:34 ▸" that opens the walkthrough
 *                     at the proving moment (the first proving chapter that has one);
 *  - `failed`       → "check failed at 0:41" (the step stays as the plan reports it: the chain's state
 *                     words come from the bus, the check words from the seal);
 *  - `owned_by_you` → "end-to-end testing is yours" (scene 28: the accepted plan's override removed the
 *                     walkthrough pair);
 *  - `claimed`      → no chip. The step passed its own gate; nothing has proved it yet, and the chain
 *                     already says "done".
 *
 * The MOMENT. crew's `provedBy[].atSec` is `null` on today's wire (the moment is not sealed, so crew
 * does not assert it — `walkthrough-acceptance.ts` `walkthroughCheckStates`). The chip takes it from
 * the walkthrough the session already reads (`WalkthroughView.chapters` → the chapter's start in the
 * stitched take, or its failing moment), through a {@link MomentOf} the caller builds from that
 * recording. No recording on screen = "checked" with nothing to open, never an invented time.
 *
 * The deliver card's acceptance line is crew's `summary.line`, verbatim (WT-W3): studio only picks the
 * tone, never the words.
 */

export type CheckChipKind = 'checked' | 'failed' | 'yours';

export interface CheckChip {
  kind: CheckChipKind;
  text: string;
  /** Seconds into the stitched take the chip opens at; `null` = nothing to open (no moment known). */
  atSec: number | null;
}

/** The moment a chapter stands for in the stitched take: its start, or (for a failed check) the
 *  failing moment. `null` = the take does not hold the chapter. */
export type MomentOf = (chapter: string, kind: 'start' | 'fail') => number | null;

/** The steps' check states folded onto the chain: `checkState` on every matched step, and a done step
 *  a sealed walkthrough proves becomes "checked". Steps are matched by plan step id (crew's `stepId` is
 *  the plan step's id, the same id the team fold gives a chain step). `null`/absent steps = no change. */
export function applyCheckState(chain: ChainModel, steps: readonly WalkthroughStepState[] | null | undefined): ChainModel {
  if (steps === null || steps === undefined || steps.length === 0 || chain.proposed) return chain;
  const byId = new Map(steps.map((s) => [s.stepId, s] as const));
  let changed = false;
  const next = chain.steps.map((s) => {
    const w = byId.get(s.id);
    if (w === undefined || s.state === 'struck' || s.state === 'replaced') return s;
    changed = true;
    const state = w.checkState === 'checked' && s.state === 'done' ? 'checked' as const : s.state;
    return { ...s, checkState: w.checkState, state };
  });
  if (!changed) return chain;
  const live = next.filter((s) => s.state !== 'struck' && s.state !== 'replaced');
  // Only a sealed take's verdicts make a count: steps merely claimed, or left to the operator's own
  // testing, keep the plain "3 of 4 done" (their chips say the rest).
  const verdicts = live.filter((s) => s.checkState === 'checked' || s.checkState === 'failed');
  return {
    ...chain,
    steps: next,
    done: live.filter((s) => s.state === 'done' || s.state === 'checked').length,
    total: live.length,
    checked: verdicts.length === 0 ? null : live.filter((s) => s.state === 'checked').length,
  };
}

const isMoment = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n) && n >= 0;

/** The first proving moment with a time, in take order as crew lists them: the wire's `atSec` when
 *  crew ever asserts one, else the recording's moment for that chapter. */
export function provedAt(step: WalkthroughStepState, momentOf?: MomentOf, kind: 'start' | 'fail' = 'start'): number | null {
  for (const p of step.provedBy) {
    if (isMoment(p.atSec)) return p.atSec;
    const at = momentOf?.(p.chapter, kind);
    if (isMoment(at)) return at;
  }
  return null;
}

/** The chip a chain step wears for its check state; `null` for a step with none, or one merely claimed. */
export function checkChip(step: ChainStep, wire: readonly WalkthroughStepState[] | null | undefined, momentOf?: MomentOf): CheckChip | null {
  const w = wire?.find((x) => x.stepId === step.id);
  if (w === undefined) return null;
  switch (w.checkState) {
    case 'checked': {
      const at = provedAt(w, momentOf, 'start');
      return { kind: 'checked', text: `checked${at === null ? '' : ` at ${fmtTime(at)}`}`, atSec: at };
    }
    case 'failed': {
      const at = provedAt(w, momentOf, 'fail');
      return { kind: 'failed', text: `check failed${at === null ? '' : ` at ${fmtTime(at)}`}`, atSec: at };
    }
    case 'owned_by_you': return { kind: 'yours', text: 'end-to-end testing is yours', atSec: null };
    default: return null;
  }
}

/** The chain's sentence once steps carry check states: "3 of 3 done and checked" only when EVERY step
 *  of the chain is checked (crew lists creator steps only, so a chain with a step crew never checks
 *  reads the count — the sentence never says more than the chips); else "6 of 6 done · 1 checked".
 *  `null` = the caller keeps its own sentence (no step carries a check state). */
export function checkedSentence(c: ChainModel): string | null {
  if (c.checked === null || c.total === 0 || c.proposed) return null;
  const withCheck = c.steps.filter((s) => s.checkState !== undefined && s.state !== 'struck' && s.state !== 'replaced');
  // Only a sealed take's verdicts count: steps merely claimed, or left to the operator's own testing,
  // keep the plain "3 of 4 done" (the chips say the rest).
  if (!withCheck.some((s) => s.checkState === 'checked' || s.checkState === 'failed')) return null;
  if (c.checked === c.total) return `${c.done} of ${c.total} done and checked`;
  return `${c.done} of ${c.total} done · ${c.checked} checked`;
}

export type AcceptanceTone = 'ok' | 'bad' | 'quiet';

/** The run's OWN evidence for a hand-over (studio#577), read off its event log: the latest floor
 *  result per unit, and how many of the units the engine evaluated passed their gate. */
export interface OwnEvidence {
  floor: 'passed' | 'failed' | null;
  gatesPassed: number;
  gatesTotal: number;
}

/** {@link OwnEvidence} from the run's events; `null` when the log carries neither a floor nor a gate. */
export function ownEvidenceOf(events: readonly CoreEvent[]): OwnEvidence | null {
  const floors = new Map<number, boolean>();
  const ords = new Set<number>();
  for (const e of events) {
    const r = e as unknown as { type?: unknown; ord?: unknown; passed?: unknown };
    if (typeof r.ord !== 'number') continue;
    if (r.type === 'repoChecksEvaluated' && typeof r.passed === 'boolean') floors.set(r.ord, r.passed);
    if (r.type === 'gateEvaluated') ords.add(r.ord);
  }
  if (floors.size === 0 && ords.size === 0) return null;
  let gatesPassed = 0;
  let gatesTotal = 0;
  for (const ord of ords) {
    const v = gateVerdict(events, ord);
    if (v === null || v.ord !== ord) continue;
    // A pre-run approval emits an UNGATED frame (no floor, no judge, no policy — nothing was judged):
    // not a reviewer gate, so not in the count either way (codex r2).
    if (v.outcome === 'ungated') continue;
    gatesTotal++;
    if (v.outcome !== 'pass') continue;
    // A verdict on an EARLIER attempt is not the unit's: once a retry was dispatched and has no
    // verdict yet, that unit has not passed (the rule `gateVerdictFor` holds for a gate card; codex r1).
    const latest = attemptBefore(events, ord);
    if (latest !== null && v.attempt !== null && v.attempt !== latest) continue;
    gatesPassed++;
  }
  const floor = floors.size === 0 ? null : [...floors.values()].every(Boolean) ? 'passed' : 'failed';
  if (floor === null && gatesTotal === 0) return null;
  return { floor, gatesPassed, gatesTotal };
}

/** "floor passed · 4 of 4 reviewer gates passed" — or null with nothing to say. */
export function ownEvidenceWords(own: OwnEvidence | null | undefined): string | null {
  if (own === null || own === undefined) return null;
  const parts: string[] = [];
  if (own.floor !== null) parts.push(`floor ${own.floor}`);
  if (own.gatesTotal > 0) parts.push(`${own.gatesPassed} of ${own.gatesTotal} reviewer gate${own.gatesTotal === 1 ? '' : 's'} passed`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** crew's QE acceptance gate found NO verdict to judge (qe/acceptance.ts: no ledger, no verdict
 *  recorded, none attributed to this run, no repo context) — as opposed to a verdict that FAILED or a
 *  ledger that could not be read. */
const NO_VERDICT_RECORDED = /\((?:missing|unattributed) ⇒ deny\)\s*$/;

/**
 * The deliver card's acceptance line: crew's words, with a tone — nothing required reads quiet, a
 * satisfied gate ok, an unsatisfied one bad. `null` = this daemon has no summary (before WT-W3).
 *
 * studio#577: when the gate's answer is only that NO QE verdict exists ("… (missing ⇒ deny)"), the
 * line is not what the press below it does — crew's deliver does not consult the QE acceptance gate
 * (the push went through under that very line on the rig). The card then says what this hand-over
 * rests on: the run's own evidence (`own`, off its events), quietly. A FAILED verdict, or a ledger
 * that could not be read, keeps crew's words and the bad tone: that is evidence.
 */
export function deliverAcceptance(summary: RunAcceptanceSummary | null | undefined, own: OwnEvidence | null = null): { text: string; tone: AcceptanceTone } | null {
  if (summary === null || summary === undefined || typeof summary.line !== 'string' || summary.line === '') return null;
  if (summary.required && !summary.satisfied && NO_VERDICT_RECORDED.test(summary.line)) {
    const words = ownEvidenceWords(own);
    return {
      text: `No QE verdict is recorded for this run, and Deliver doesn’t consult the QE gate — this hand-over rests on the run’s own evidence${words === null ? '' : `: ${words}`}.`,
      tone: 'quiet',
    };
  }
  const tone: AcceptanceTone = !summary.required ? 'quiet' : summary.satisfied ? 'ok' : 'bad';
  return { text: summary.line, tone };
}

/** The run's accepted plan carries an override that removed the walkthrough pair (WT §4.9, the
 *  operator's "our QA team tests end to end") — `session.team_plan.accepted.floor_override.remove`
 *  names `walkthrough_review` or `walkthrough_plan`. Read defensively: the DTO types it as unknown. */
export function overrideRemovedWalkthrough(session: unknown): boolean {
  const plan = (session as { team_plan?: { accepted?: { floor_override?: { remove?: unknown } | null } | null } | null } | null)?.team_plan;
  const remove = plan?.accepted?.floor_override?.remove;
  return Array.isArray(remove) && remove.some((r) => r === 'walkthrough_review' || r === 'walkthrough_plan');
}
