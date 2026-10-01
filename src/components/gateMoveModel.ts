import type { CoreEvent, WorkUnit } from '../api/types.js';
import { DELIVER_STEP, type PlanGateView } from '../board/planModel.js';
import { checkOutcome, phaseLabel, type GateVerdictView } from './gateVerdictModel.js';

/**
 * The ONE recommended move at a gate (brainstorm-actionable idea 1) and the verdict diff beside it
 * (idea 2). Pure: every input is already on the card (the verdict fold, the run's units, the plan
 * gate view, the deliver diff), so this module makes zero requests.
 *
 * The card used to show state (a NOT PASS verdict, a floor that failed) and leave the operator to
 * work out the answer and type the note. Now the gate's kind and verdict pick the move, the move
 * names itself on the primary button, the consequence line says what happens before it is taken,
 * and the note arrives pre-filled with the reviewer's failing lines. The other answers stay, as
 * secondary buttons.
 *
 * The moves, each answered on a crew route the card already speaks (`POST /runs/:id/gate`):
 *  - `send-back`       an evaluator said NOT PASS → `{approve:false, action:'request_changes', amend}`:
 *                      the creator phase reruns with the failing items, the reviewer re-reviews;
 *  - `retry-findings`  a validator / repository checks rejected the unit (or a legacy NOT PASS gate
 *                      whose approve retries) → an approve carrying the findings as the note;
 *  - `approve-plan`    a plan gate at a low band → a plain approve of the plan as shown;
 *  - `deliver`         the gate before the deliver unit → review the diff, then approve.
 * `null` everywhere else: the card keeps its existing layout and nothing is recommended.
 */

export type GateMoveKind = 'send-back' | 'retry-findings' | 'approve-plan' | 'deliver';

export interface GateMove {
  kind: GateMoveKind;
  /** The primary button's text — the move, named. */
  label: string;
  /** The consequence line rendered above the button, before the move is taken. */
  consequence: string;
  /** The note the steer box is pre-filled with (`null` = the move takes no note). */
  prefill: string | null;
  /** The reviewer's failing items the move carries (empty for plan / deliver). */
  items: string[];
}

/** Denial layers that are an evaluator's judgement of the work (the creator should fix it). */
const EVALUATOR_SOURCES = new Set(['evaluator_verdict', 'agent_validator', 'evaluator']);
/** Denial layers that are a deterministic validator of the work (retry with what it found). */
const VALIDATOR_SOURCES = new Set(['repo_checks', 'repo_checks_timeout', 'pinned_validator', 'substance', 'deliverables']);

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;
/** Lines that frame a verdict rather than state a finding. */
const FRAME = /^(?:the evaluator'?s verdict is\b|verdict\s*[:=]|agent judge:\s*fail\s*$|not pass\b|reviewed\b|findings?:?$)/i;

function lines(text: string | null | undefined): string[] {
  return (text ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

/** The bulleted findings in a reviewer's text, in order, deduplicated. */
function bullets(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const l of lines(text)) {
    const m = BULLET.exec(l);
    if (m !== null && !FRAME.test(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** A reviewer's prose findings when it wrote no bullets: every line that is not a frame line. */
function proseFindings(text: string | null | undefined): string[] {
  return lines(text)
    .map((l) => l.replace(/^agent judge:\s*fail\s*[—-]\s*/i, ''))
    .filter((l) => !FRAME.test(l));
}

/**
 * R4 (ship-prove-3) — a governed evaluator writes a SECTIONED report (garden `governed-worker`
 * output contract: What I did / Commands run / Counts / Findings / Open questions / VERDICT). Only
 * the Findings section is what failed; reading every bullet of the whole report made "Read
 * `…/SKILL.md` — exit 0." the headline of a send-back while the real Critical finding sat below it.
 */
/** Markdown dress stripped before a line is read as a heading: a leading `#…` and the emphasis
 *  wrapper around the line's LEAD only (`**Findings:**`, `**Critical:** body`, `**Critical**: body`),
 *  so `### Findings` and `Findings` read alike (codex review). Markers inside the body stay —
 *  `src/__tests__/math.test.ts` is a path, not emphasis (Copilot). */
function plain(line: string): string {
  const t = line.replace(/^#{1,6}\s*/, '').trim();
  const m = /^(\*\*|__)(.+?)\1(.*)$/.exec(t);
  return (m !== null ? `${m[2]}${m[3]}` : t).trim();
}
/** A top-level section heading of the output contract, read on {@link plain} text. */
const SECTION_HEAD = /^(?:\d+[.)]\s*)?(findings(?: or plan)?|what (?:i|you) did|commands run|run-record evidence|counts|open questions\b.*?)\s*:?$/i;
const VERDICT_LINE = /^verdict\s*[:=]/i;
/** A sub-heading inside Findings ("Critical:", "**Concerns:**", "Verified from the build evidence:"),
 *  read on {@link plain} text: a non-bullet line ending in a colon. */
const SUB_HEAD = /^([^-*•\d].*?)\s*:$/;
/** The severities that FAIL a review (`Suggestion` does not; neither does a "Verified …" list). */
const FAILING_SEVERITY = /^(?:critical|blockers?|blocking|must[- ]fix|high|major|concerns?|conditions?)\b/i;
/** The MUST-FIX tier: when a report names any, its Concerns are not the reason it failed (the
 *  governed-worker contract — FAIL needs a Critical or a CONDITIONS list; Copilot). */
const MUST_FIX = /^(?:critical|blockers?|blocking|must[- ]fix|high|major|conditions?)\b/i;
/** Groups that are explicitly NOT failures: what the reviewer verified, praised or only suggests. */
const PASSING_GROUP = /^(?:verified|confirmed|pass(?:es|ed|ing)?|strengths?|what (?:works|passed)|ok\b|good\b|suggestions?|nits?|non[- ]blocking|optional)/i;
/** An inline severity lead, on {@link plain} text: "Critical — src/text.ts:26 slices …",
 *  "Concern: …". A bare "Critical:" has no body and is a sub-heading instead. */
const INLINE_SEVERITY = /^((?:critical|blockers?|blocking|must[- ]fix|high|major|concerns?|conditions?)\b[^—:]*?)(?:\s*[—–:]|\s+-)\s*(.*\S)\s*$/i;
/** "Concerns: none." states no finding. */
const NO_FINDING = /^(?:none|n\/a|nil|no (?:critical |blocking )?(?:findings?|issues?|concerns?))\b[.!]?$/i;

/** `[test/math.test.ts](/abs/worktree/test/math.test.ts:9)` → `test/math.test.ts:9`: the link text,
 *  plus the target's line when the text lacks one. The absolute worktree path is never shown. */
function unlink(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, target: string) => {
    const line = /:(\d+(?::\d+)?)$/.exec(target);
    return line !== null && !/:\d+(?::\d+)?$/.test(label) ? `${label}:${line[1]}` : label;
  });
}

/** The lines of the Findings section of a sectioned report, or `null` when it has none. */
function findingsSection(text: string | null | undefined): string[] | null {
  const all = lines(text);
  let start = -1;
  for (let i = 0; i < all.length; i++) {
    const m = SECTION_HEAD.exec(plain(all[i]!));
    if (m !== null && /^findings/i.test(m[1]!)) start = i + 1;
  }
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start; i < all.length; i++) {
    const l = all[i]!;
    if (SECTION_HEAD.test(plain(l)) || VERDICT_LINE.test(plain(l))) break;
    out.push(l);
  }
  return out;
}

/**
 * The failing items of a sectioned report's Findings section, best reading first:
 *  1. the items under a failing severity — a severity sub-heading's bullets, or a line that leads
 *     with one ("Critical — …"); a "Verified …" or Suggestion group is not a failure;
 *  2. else every bullet in the section;
 *  3. else its prose lines.
 * `null` when the report has no Findings section (the caller keeps its older readings); `[]` when
 * it has one that names no failure — then the rest of the report (Commands run, evidence) is still
 * not a finding (codex review, HIGH).
 */
/** What a Findings sub-heading opens: a failing group (and whether it is the must-fix tier), a
 *  passing one, or a neutral one. */
function groupOf(head: string): { group: 'failing' | 'passing' | 'other'; groupMust: boolean } {
  const group = FAILING_SEVERITY.test(head) ? 'failing' : PASSING_GROUP.test(head) ? 'passing' : 'other';
  return { group, groupMust: group === 'failing' && MUST_FIX.test(head) };
}

function findingsItems(text: string | null | undefined): string[] | null {
  const section = findingsSection(text);
  if (section === null) return null;
  const mustFix: string[] = [];
  const severe: string[] = [];
  const allBullets: string[] = [];
  const prose: string[] = [];
  let group: 'failing' | 'passing' | 'other' | null = null;
  /** Whether the current failing group is the must-fix tier (Critical…), not a Concern. */
  let groupMust = false;
  const push = (into: string[], item: string): void => {
    const clean = unlink(item).trim();
    if (clean !== '' && !NO_FINDING.test(clean) && !into.includes(clean)) into.push(clean);
  };
  const failing = (item: string, must: boolean): void => {
    push(severe, item);
    if (must) push(mustFix, item);
  };
  for (const l of section) {
    const bullet = BULLET.exec(l);
    // A bulleted sub-heading (`- **Verified:**`, `- Critical:`) opens a group like a plain one; the
    // nested bullets under it arrive here already un-indented (codex review).
    const bulletHead = bullet !== null ? SUB_HEAD.exec(plain(bullet[1]!)) : null;
    if (bulletHead !== null && bulletHead[1]!.length <= 80) {
      ({ group, groupMust } = groupOf(bulletHead[1]!.trim()));
      continue;
    }
    if (bullet !== null) {
      // A "Verified …" / Suggestion group's bullets are never failures, whatever word they lead
      // with — "- Critical: boundary handling is fixed." under "Verified:" is a pass (codex review,
      // MEDIUM; Copilot).
      if (group === 'passing') continue;
      const body = bullet[1]!;
      const inline = INLINE_SEVERITY.exec(plain(body));
      if (inline !== null) failing(inline[2]!, MUST_FIX.test(inline[1]!));
      else if (group === 'failing') failing(body, groupMust);
      push(allBullets, inline !== null ? inline[2]! : body);
      continue;
    }
    const inline = INLINE_SEVERITY.exec(plain(l));
    if (inline !== null) {
      // A severity-led LINE (not a bullet) is a new finding at the section's top level, the way
      // the run-2 report wrote "Critical — …": it ends any group above it.
      group = 'failing';
      groupMust = MUST_FIX.test(inline[1]!);
      failing(inline[2]!, groupMust);
      continue;
    }
    const sub = SUB_HEAD.exec(plain(l));
    if (sub !== null) {
      ({ group, groupMust } = groupOf(sub[1]!.trim()));
      continue;
    }
    if (group !== 'passing' && !FRAME.test(l)) push(prose, l);
  }
  // The must-fix tier is why the review failed; Concerns ride only when it names none (Copilot).
  if (mustFix.length > 0) return mustFix;
  if (severe.length > 0) return severe;
  if (allBullets.length > 0) return allBullets;
  return prose;
}

/**
 * The newest `gateEscalated.verdictSummary` for `ord` — the engine's copy of the reviewer's words on
 * the escalation it opened. `null` when the log holds none for that unit.
 */
export function escalationSummaryFor(events: readonly CoreEvent[], ord: number | null | undefined): string | null {
  if (typeof ord !== 'number') return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'gateEscalated' && e.ord === ord && typeof e.verdictSummary === 'string' && e.verdictSummary.trim() !== '') {
      return e.verdictSummary;
    }
  }
  return null;
}

/**
 * The reviewer's failing items for a failed verdict, best source first:
 *  0. the Findings section of a sectioned report (denial reason, then summary) — {@link findingsItems};
 *  1. the bullets of the denial's reason (the evaluator's own findings — `VERDICT: FAIL` output);
 *  2. the bullets of `gateEscalated.verdictSummary`;
 *  3. the failing repository checks of the floor (`name — how it ended`);
 *  4. the bullets, then the prose, of the judge's reasoning;
 *  5. the prose of the denial reason / summary, minus the frame lines.
 * Empty for a passing (or absent) verdict: there is nothing to send back.
 */
export function failingItems(verdict: GateVerdictView | null, verdictSummary?: string | null): string[] {
  if (verdict === null || verdict.outcome !== 'fail') return [];
  const reason = verdict.denial?.reason ?? null;
  // A sectioned report's Findings section outranks every other reading (R4). When the report HAS
  // one, its other sections (Commands run, evidence, counts) are never read as findings — even if
  // the section itself names nothing; the floor's checks and the judge still speak below.
  const fromFindings = findingsItems(reason);
  if (fromFindings !== null && fromFindings.length > 0) return fromFindings;
  const fromSummaryFindings = findingsItems(verdictSummary);
  if (fromSummaryFindings !== null && fromSummaryFindings.length > 0) return fromSummaryFindings;
  const sectioned = fromFindings !== null || fromSummaryFindings !== null;
  if (!sectioned) {
    const fromBullets = bullets(reason);
    if (fromBullets.length > 0) return fromBullets;
    const fromSummary = bullets(verdictSummary);
    if (fromSummary.length > 0) return fromSummary;
  }
  const checks = (verdict.floor?.checks ?? [])
    .filter((c) => !checkOutcome(c).ok)
    .map((c) => `${c.name} — ${checkOutcome(c).word}`);
  if (checks.length > 0) return checks;
  const judge = bullets(verdict.agentReasoning);
  if (judge.length > 0) return judge;
  if (verdict.agentReasoning !== null && verdict.agentReasoning.trim() !== '' && verdict.denial?.source === 'agent_validator') {
    return proseFindings(verdict.agentReasoning);
  }
  // A validator's prose ("Repository checks failed on head") is a headline, not a finding: without
  // its checks there is nothing to carry, so the card recommends nothing rather than echo it.
  if (verdict.denial?.source != null && VALIDATOR_SOURCES.has(verdict.denial.source)) return [];
  if (sectioned) return [];
  const prose = proseFindings(reason);
  return prose.length > 0 ? prose : proseFindings(verdictSummary);
}

/** The note a send-back / retry carries: the failing items, one per line, under one plain ask. */
export function findingsNote(items: readonly string[], who: 'reviewer' | 'validator'): string {
  return [`Fix the ${who}'s failing items:`, ...items.map((i) => `- ${i}`)].join('\n');
}

/**
 * The creator phase a send-back reruns: the newest unit before `ord` whose role is `creator`, else
 * the newest `build`-stage unit before it; `null` when the units cannot say (no units, no ord).
 */
export function creatorUnitBefore(units: readonly WorkUnit[], ord: number | null): WorkUnit | null {
  if (ord === null) return null;
  const before = units.filter((u) => u.ord < ord).sort((a, b) => b.ord - a.ord);
  return before.find((u) => u.role === 'creator') ?? before.find((u) => u.stage === 'build' && u.role !== 'evaluator') ?? null;
}

/** A plan band is LOW when the plan is not high risk and the band tops out below 40 (`0-19`, `20-39`). */
export function isLowBand(view: PlanGateView): boolean {
  if (view.highRisk) return false;
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(view.band.trim());
  return m !== null && Number(m[2]) < 40;
}

/** Whether the gate is the pre-run gate on the run's deliver unit. */
export function isDeliverGate(runId: string, units: readonly WorkUnit[], ord: number | null | undefined): boolean {
  if (typeof ord !== 'number') return false;
  return units.some((u) => u.ord === ord) && phaseLabel(runId, units, ord) === 'deliver';
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The engine's single-line segment marker between a unit's description and its phase's
 *  instructions (wicked-core `plan::INSTRUCTION_SEP`). Never rendered. */
export const INSTRUCTION_SEP = ' ||| ';

/** The head of an approved intent amendment's segment (wicked-core `INTENT_AMENDMENT_PREFIX`). */
const INTENT_AMENDMENT_HEAD = 'APPROVED INTENT AMENDMENT';

/**
 * What THIS deliver push will actually do, as the workflow's own gate card says it (N3, ship
 * re-proof) — the first part of the deliver unit's instructions, up to the push-identity sentence:
 * crew's `newPrTargetSentence`, e.g. "Pushes the run branch wicked/<run> to origin (…) — a local
 * path, so no pull request can be opened against it: …". `null` when the unit carries no card (a
 * def authored without instructions) — the caller then claims no pull request at all.
 *
 * The consent line used to be the diffstat alone while the prompt said both "no pull request can
 * be opened" (behind "show the full prompt" and a raw ` ||| `) and "…opens a pull request".
 */
export function deliverTargetOf(units: readonly WorkUnit[], ord: number | null | undefined): string | null {
  if (typeof ord !== 'number') return null;
  const desc = units.find((u) => u.ord === ord)?.description ?? '';
  // Segment 0 is `deliver — <intent>`; an approved intent amendment adds its own
  // `APPROVED INTENT AMENDMENT …` segment, which is never the card (Copilot on core#684).
  const card = desc
    .split(INSTRUCTION_SEP)
    .slice(1)
    .map((s) => s.trim())
    .find((s) => s !== '' && !s.startsWith(INTENT_AMENDMENT_HEAD));
  if (card === undefined) return null;
  const identity = card.indexOf(' Push identity:');
  const target = (identity === -1 ? card : card.slice(0, identity)).trim();
  return target === '' ? null : target;
}

/** The first item, clipped for a button, with how many more ride along. */
function itemsLabel(items: readonly string[]): string {
  const first = items[0] ?? '';
  const clipped = first.length > 56 ? `${first.slice(0, 55).trimEnd()}…` : first;
  return items.length > 1 ? `${clipped} (+${items.length - 1} more)` : clipped;
}

export interface GateMoveInput {
  runId: string;
  ord: number | undefined;
  units: readonly WorkUnit[];
  /** The deciding verdict (`gateVerdictFor`) — `null` on a plan gate or an evaluation-less log. */
  verdict: GateVerdictView | null;
  /** `gateEscalated.verdictSummary` for the verdict's unit (`escalationSummaryFor`). */
  verdictSummary: string | null;
  /** The card's `isEscalationGate` reading (the four-verb layout). */
  escalationGate: boolean;
  /** Whether the gate has a deliver-lift story (a failed deliver — the engine's remedy governs). */
  hasLift: boolean;
  /** The worktree-guard restored-tree retry — the card already relabels Approve for it. */
  restoredRetry: boolean;
  isPlanGate: boolean;
  planView: PlanGateView | null;
  /** The deliver gate's diffstat label (`2 files changed, +3, −1`), when the diff was read. */
  diffstat: string | null;
}

/** The ONE recommended move for this gate, or `null` when the card should recommend nothing. */
export function recommendGateMove(input: GateMoveInput): GateMove | null {
  const { runId, ord, units, verdict, verdictSummary, escalationGate, hasLift, restoredRetry } = input;

  if (input.isPlanGate) {
    const view = input.planView;
    if (view === null || !isLowBand(view)) return null;
    // F4 — THE CONSEQUENCE IS DERIVED FROM THE PLAN IT GATES, never from the editor's seed.
    //
    // This read `view.editSeed`, which is what the plan EDITOR is filled with: it strips the two
    // steps an operator cannot author (`pa-scope`, the launch's `deliver`) and names steps by
    // CATALOG. Used as the plan it said "approve runs 6 phases: understand → design → build →
    // review → test → critique" over a plan of `pa-scope → clarify → design → build →
    // adversarial-review → test → review → deliver` — the wrong count, the wrong names, and
    // `deliver`, the only phase with an external side effect, absent from the line that gates it.
    //
    // The names the card shows are step IDS; the floor's additions and the deliver step are named
    // by CATALOG. Mixing the two namespaces double-counts a floor addition already in the plan and
    // reads the side effect off the wrong field (codex review of this PR, two MEDIUMs), so each
    // question is answered from the field that can answer it. A step the payload could not name is
    // still counted, and said to be unnamed rather than dropped or invented.
    const named = view.planSteps.map((st) => st.id ?? '(unnamed phase)');
    const inPlan = new Set<string>(
      view.planSteps.flatMap((st) => [st.id, st.catalog].filter((n): n is string => n !== null)),
    );
    const phases = [...named, ...view.floorAdded.filter((p) => !inPlan.has(p))];
    // Said out loud rather than left to be spotted in an eight-item arrow list: this is a consent
    // line, and one of those names reaches outside the machine.
    const delivers =
      view.planSteps.some((st) => st.catalog === DELIVER_STEP) || view.floorAdded.includes(DELIVER_STEP);
    const sideEffect = delivers
      ? `; its ${DELIVER_STEP} phase is the one with an external side effect`
      : '';
    return {
      kind: 'approve-plan',
      label: 'Approve the plan',
      consequence: phases.length > 0
        ? `Band ${view.band}, low risk — approve runs ${plural(phases.length, 'phase')}: ${phases.join(' → ')}${sideEffect}`
        : `Band ${view.band}, low risk — approve runs the plan as shown`,
      prefill: null,
      items: [],
    };
  }

  if (hasLift || restoredRetry) return null;

  // A failed verdict on THIS gate's unit (an escalation, or a legacy NOT PASS gate whose approve retries).
  const own = verdict !== null && verdict.outcome === 'fail' && typeof ord === 'number' && verdict.ord === ord;
  const source = verdict?.denial?.source ?? null;
  // Only a judgement of the WORK recommends a move: a worktree-guard, governance or worker-failure
  // denial is about how the phase ran, and the card's own remedy for it stands.
  const judged = source !== null && (EVALUATOR_SOURCES.has(source) || VALIDATOR_SOURCES.has(source));
  // core#469: a floor that did not FINISH judged nothing — "retry with its findings" would re-run the
  // seat over a timeout. The card's extend / targeted / accept arms are that gate's moves.
  if (own && source === 'repo_checks_timeout') return null;
  if (own && judged) {
    const items = failingItems(verdict, verdictSummary);
    if (items.length === 0) return null;
    const reviewer = phaseLabel(runId, units, verdict.ord);
    if (escalationGate && EVALUATOR_SOURCES.has(source)) {
      const creator = creatorUnitBefore(units, verdict.ord);
      const creatorName = creator === null ? 'the creator' : phaseLabel(runId, units, creator.ord);
      return {
        kind: 'send-back',
        label: `Send back to the creator: ${itemsLabel(items)}`,
        consequence: `${creatorName} reruns with ${plural(items.length, 'item')}; ${reviewer} re-reviews`,
        prefill: findingsNote(items, 'reviewer'),
        items,
      };
    }
    const validator = VALIDATOR_SOURCES.has(source);
    const who = validator ? 'validator' : 'reviewer';
    return {
      kind: 'retry-findings',
      label: `Retry with the ${who}'s findings`,
      consequence: `${reviewer} reruns with ${plural(items.length, validator && verdict.floor !== null ? 'failing check' : 'finding')} as its note`,
      prefill: findingsNote(items, who),
      items,
    };
  }

  if (!escalationGate && isDeliverGate(runId, units, ord)) {
    const diff = input.diffstat !== null ? input.diffstat : 'no diff read for it yet';
    const target = deliverTargetOf(units, ord);
    return {
      kind: 'deliver',
      label: 'Review the diff, then deliver',
      // N3: the visible consent line states what will ACTUALLY happen on this origin, then what
      // the push carries. Without the workflow's card it claims no pull request either way.
      consequence: target !== null
        ? `${target} The push carries: ${diff}`
        : input.diffstat !== null
          ? `Deliver pushes the run branch: ${input.diffstat}`
          : 'Deliver pushes the run branch (no diff read for it yet)',
      prefill: null,
      items: [],
    };
  }
  return null;
}

// ── Idea 2: the verdict diff ────────────────────────────────────────────────────────────────────

/** One failing criterion beside what the creator claimed about it. */
export interface VerdictDiffRow {
  criterion: string;
  /** The creator's line that speaks to it (best word overlap), or `null` — it claimed nothing on it. */
  claim: string | null;
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'still', 'have', 'has', 'was', 'were',
  'are', 'not', 'but', 'its', 'now', 'all', 'any', 'every', 'each', 'should', 'would', 'missing',
]);

function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9_./-]+/).map((w) => w.replace(/^[./-]+|[./-]+$/g, ''))
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/**
 * What the creator claimed: the bullets of its output when it wrote any, else its non-empty lines —
 * the `VERDICT:` line and fenced-code markers dropped.
 */
export function creatorClaims(output: string | null | undefined): string[] {
  const all = lines(output).filter((l) => !/^verdict\s*[:=]/i.test(l) && !l.startsWith('```'));
  const fromBullets = all.map((l) => BULLET.exec(l)?.[1] ?? null).filter((l): l is string => l !== null);
  return fromBullets.length > 0 ? fromBullets : all;
}

/**
 * Each failing criterion beside the creator's claim that shares the most words with it (at least
 * one), so "why it failed" reads without the timeline: the reviewer says the test is missing, the
 * creator said it added the test.
 */
export function verdictDiff(items: readonly string[], creatorOutput: string | null | undefined): VerdictDiffRow[] {
  const claims = creatorClaims(creatorOutput).map((c) => ({ text: c, words: words(c) }));
  return items.map((criterion) => {
    const want = words(criterion);
    let best: string | null = null;
    let bestScore = 0;
    for (const c of claims) {
      let score = 0;
      for (const w of want) if (c.words.has(w)) score++;
      if (score > bestScore) { bestScore = score; best = c.text; }
    }
    return { criterion, claim: best };
  });
}

// ── The Home gate row's verb ──────────────────────────────────────────────────────────────────

/**
 * The Home "Needs you" gate row's verb, naming the move the gate card will recommend, read off the
 * gate record the row already holds (the prompt the engine wrote and the live frame's kind). The row
 * still OPENS the gate — the trailing ellipsis says the answer is given there; nothing is sent from
 * Home. `null` = the prompt names no move this can read (the row keeps "Open gate ›").
 */
export function gateRowVerb(prompt: string | undefined, gateKind?: string): string | null {
  const p = prompt ?? '';
  if (gateKind === 'plan_approval' || /^\s*Approve plan rev\b/i.test(p)) {
    const band = /\bband\s+(\d+)\s*-\s*(\d+)/i.exec(p);
    return band !== null && Number(band[2]) < 40 ? 'Approve plan… ›' : null;
  }
  if (/^\s*Unit\s+\d+\s+verdict is NOT PASS/i.test(p)) {
    // The worktree-guard mutation gate retries against the restored tree; every other NOT PASS
    // goes back to the creator.
    return /restored|changed the tree/i.test(p) ? 'Retry… ›' : 'Send back… ›';
  }
  if (/^\s*Unit\s+\d+\s+(?:failed and triage escalated|failed its deterministic floor)/i.test(p)) return 'Retry… ›';
  if (/^\s*Approve unit\s+\d+\s+before it runs:\s*deliver\b/i.test(p)) return 'Review diff… ›';
  // The engine's own deliver-gate prompt (`deliver_gate_prompt`).
  if (/^\s*Approve delivery before unit\s+\d+\s+runs\b/i.test(p)) return 'Review diff… ›';
  return null;
}
