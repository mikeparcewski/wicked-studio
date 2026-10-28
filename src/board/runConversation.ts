import type { CoreEvent, SessionView } from '../api/types.js';
import { deliveryOf, hasDeliveredRef } from '../components/delivery.js';
import type { ChainModel } from './chainModel.js';

/**
 * THE RUN AS A CONVERSATION (DES-CHAT-NATIVE-RUN, operator 2026-10-17: "I never see a clean simple chat
 * display"). Pure: what the thread says for one run, rebuilt from what crew already records — the run's units
 * (each finished step's captured output), its gate events (what was asked, what you answered) and its delivery.
 * The same model serves a live run and an old one opened fresh: nothing here needs the browser to have watched.
 *
 * The thread renders, in order: the plan (who proposed it, its steps), your answers to its gates (your own
 * bubbles), one message per finished step (its output, concise), and — once the run ends — one final message.
 * The run's status, phases, agents, checks and spend are the details panel's, not the thread's.
 */

export interface StepMessage {
  ord: number;
  /** The unit key the output route resolves (`<runId>:<key>` → `<key>`). */
  key: string;
  /** The step's plain name ("Research", "Build", "Review"). */
  label: string;
  /** The seat that did it, when one did. */
  cli: string | null;
  state: 'done' | 'rejected';
  /** Which attempt's words these are: a step that ran again (a resume, a retry) is read again (codex r1 #2). */
  version: string;
}

export interface DecisionMessage {
  ord: number;
  at: number;
  /** What was done, in words: "Approved the plan", "Approved", "Sent it back", "The job retried automatically". */
  text: string;
  /** Who acted (J4 0.16.6: the thread said "Sent it back" for the engine's own rounds): you answered a question the job
   *  asked, or the job decided on its own. */
  by: 'you' | 'job';
}

/** The step words the thread uses for a unit key or catalog id (one vocabulary with the chain line). */
const STEP_WORDS: Record<string, string> = {
  understand: 'Research', 'pa-scope': 'Plan', recon: 'Research', research: 'Research', build: 'Build', test: 'Test',
  review: 'Review', critique: 'Review', security_review: 'Security check', deliver: 'Deliver', design: 'Design',
  architecture: 'Architecture', test_plan: 'Test plan', produce: 'Write', walkthrough_review: 'Walkthrough',
};

export function stepWord(key: string): string {
  const base = key.replace(/#\d+$/, '');
  if (STEP_WORDS[base] !== undefined) return STEP_WORDS[base]!;
  const s = base.replace(/[-_]+/g, ' ').trim();
  return s === '' ? 'Step' : s[0]!.toUpperCase() + s.slice(1);
}

export function unitKeyOf(runId: string, unit: { id: string; ord: number }): string {
  return unit.id.startsWith(`${runId}:`) ? unit.id.slice(runId.length + 1) : `u${unit.ord}`;
}

/** A unit that plans the run (the PA's scope step): its words are the plan message, not a step message. */
function isPlanningUnit(key: string): boolean {
  return key === 'pa-scope' || key === 'scope';
}

/** The finished steps that speak in the thread, in run order. The deliver step speaks in the final message. */
/**
 * `events`: the run's log — each step's own dispatch attempts (`unitDispatched{ord, attempt}`) version its words, so a
 * step that ran again is read again while the others keep theirs (codex r2 #1: the session's `attempt` is the
 * cursor's, and resets when the cursor moves).
 */
export function stepMessages(view: SessionView, events: readonly CoreEvent[] | null | undefined = null): StepMessage[] {
  const id = view.session.id;
  const tries = new Map<number, number>();
  for (const raw of events ?? []) {
    const e = raw as Ev;
    if (e.type !== 'unitDispatched' || typeof e.ord !== 'number') continue;
    const attempt = typeof (e as { attempt?: unknown }).attempt === 'number' ? (e as { attempt: number }).attempt : 0;
    tries.set(e.ord, Math.max(tries.get(e.ord) ?? 0, attempt + 1));
  }
  return [...view.units]
    .filter((u) => u.status === 'done' || u.status === 'rejected')
    .sort((a, b) => a.ord - b.ord)
    .map((u) => ({ u, key: unitKeyOf(id, u) }))
    .filter(({ key }) => !isPlanningUnit(key) && key.replace(/#\d+$/, '') !== 'deliver')
    .map(({ u, key }) => ({
      ord: u.ord, key, label: /^u\d+$/.test(key) ? stepWord(String(u.stage)) : stepWord(key),
      cli: typeof u.assigned_cli === 'string' && u.assigned_cli !== '' ? u.assigned_cli : null,
      state: u.status === 'rejected' ? 'rejected' : 'done',
      version: `${String(u.status)}:${tries.get(u.ord) ?? 0}`,
    }));
}

/** The plan's steps, in plain words: the chain's (a team run's proposal or its accepted plan), else the units'. */
export function planSteps(view: SessionView, chain: ChainModel): string[] {
  const steps = chain.pending !== undefined && chain.pending.length > 0 ? chain.pending : chain.steps;
  const live = steps.filter((s) => s.state !== 'struck' && s.state !== 'replaced').map((s) => s.label);
  if (live.length > 0) return live;
  const id = view.session.id;
  return [...view.units].sort((a, b) => a.ord - b.ord).map((u) => unitKeyOf(id, u)).filter((k) => !isPlanningUnit(k)).map(stepWord);
}

type Ev = CoreEvent & { ord?: unknown; allow?: unknown; prompt?: unknown; gateKind?: unknown; ts?: unknown };

/**
 * The run's gate decisions, from its event log, labelled by who made them. A `gateDecided` answers YOU only when it
 * answers a question the job asked (`awaitingHuman` for that step, still open). The engine decides every other gate
 * itself: a pass says nothing here (the step's own message does), and a denial the job retries on its own — the
 * automatic floor round, a no-change answer — is "The job retried automatically", never your "Sent it back". A denial
 * that stops to ask you is the question itself (the dock), not a message.
 */
export function decisionMessages(events: readonly CoreEvent[] | null | undefined): DecisionMessage[] {
  if (events === null || events === undefined) return [];
  const asked = new Map<number, { plan: boolean }>();
  const out: DecisionMessage[] = [];
  const list = events as readonly (Ev & { scope?: unknown })[];
  const answered = (ord: number, at: number, allow: boolean): void => {
    const q = asked.get(ord);
    if (q === undefined) return;
    asked.delete(ord);
    out.push({ ord, at, by: 'you', text: allow ? (q.plan ? 'Approved the plan' : 'Approved') : (q.plan ? 'Turned the plan down' : 'Sent it back') });
  };
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    const ord = typeof e.ord === 'number' ? e.ord : null;
    if (ord === null) continue;
    const at = typeof e.ts === 'number' ? e.ts : 0;
    if (e.type === 'awaitingHuman') {
      const prompt = typeof e.prompt === 'string' ? e.prompt : '';
      asked.set(ord, { plan: e.gateKind === 'plan_approval' || /^\s*approve plan\b/i.test(prompt) });
    } else if (e.type === 'gateDecided') {
      if (asked.has(ord)) { answered(ord, at, e.allow === true); continue; }
      if (e.allow === true) continue;
      // What the job did next with this step: retried it on its own, or stopped to ask.
      for (let j = i + 1; j < list.length; j++) {
        const n = list[j]!;
        if (n.ord !== ord) continue;
        if (n.type === 'awaitingHuman' || n.type === 'gateEscalated' || n.type === 'gateDecided') break;
        if (n.type === 'unitReworkAmended' || n.type === 'resumed' || n.type === 'unitDispatched') {
          out.push({ ord, at, text: 'The job retried automatically', by: 'job' });
          break;
        }
      }
    } else if (e.type === 'resumed' && asked.has(ord)) {
      // Your answer resumes the run: an approve's `gateDecided` follows at once; a plan approval has none (the next
      // `gateDecided` for that step is the engine judging the step's own work).
      const next = list.slice(i + 1).find((n) => n.ord === ord);
      if (next?.type === 'gateDecided' && next.ts === e.ts) continue;
      answered(ord, at, true);
    } else if (e.type === 'unitReworkAmended' && e.scope === 'request_changes') {
      // A send-back or a rewind from a later question ("Run QE again" at the hand-over) re-arms an earlier step.
      const open = [...asked.keys()].filter((q) => q >= ord).sort((x, y) => y - x)[0];
      if (open !== undefined) { asked.delete(open); out.push({ ord, at, text: 'Sent it back', by: 'you' }); }
    } else if (e.type === 'unitDispatched') {
      // A question closed by something other than an answer (a reassign) is not open any more.
      asked.delete(ord);
    }
  }
  return out;
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** A step output's own verdict header ("VERDICT: PASS") — said by the message in words, not shouted. */
const VERDICT = /^\s*VERDICT:\s*(PASS|FAIL|NOT PASS)\s*$/im;

export interface ConciseOutput {
  /** The markdown the message shows. */
  text: string;
  /** More was captured than the message shows: "Show all" opens the rest. */
  more: boolean;
  /** A review step's verdict, when its output led with one. */
  verdict: 'pass' | 'fail' | null;
}

/** At most this many lines (or characters) of a step's output are the message; the rest opens on demand. */
export const CONCISE_LINES = 14;
export const CONCISE_CHARS = 1200;

/**
 * A step's captured output as a chat message: ANSI and a leading verdict header out, then the first
 * {@link CONCISE_LINES} lines (cut at a paragraph boundary, never inside a code fence, never right after a
 * heading whose body was cut).
 */
export function conciseOutput(raw: string): ConciseOutput {
  let text = raw.replace(ANSI, '').replace(/\r\n?/g, '\n').trim();
  let verdict: ConciseOutput['verdict'] = null;
  const m = VERDICT.exec(text);
  if (m !== null && text.slice(0, m.index).trim() === '') {
    verdict = m[1]!.toUpperCase() === 'PASS' ? 'pass' : 'fail';
    text = text.slice(m.index + m[0].length).trim();
  }
  const lines = text.split('\n');
  if (lines.length <= CONCISE_LINES && text.length <= CONCISE_CHARS) return { text, more: false, verdict };
  // Walk to the limit; the cut is the last paragraph break outside a code fence before it (a fence open at
  // the limit is cut before it starts), else the limit itself.
  let chars = 0;
  let fenceAt: number | null = null;
  let lastBreak = 0;
  let limit = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^ {0,3}(```|~~~)/.test(line)) fenceAt = fenceAt === null ? i : null;
    else if (fenceAt === null && line.trim() === '') lastBreak = i;
    chars += line.length + 1;
    if (i + 1 >= CONCISE_LINES || chars >= CONCISE_CHARS) { limit = i + 1; break; }
  }
  const end = fenceAt !== null ? fenceAt : lastBreak > 0 ? lastBreak : limit;
  // A heading is never the last thing shown: the cut lands on the blank line between a heading and
  // its body (the governed-worker report's `## Commands run` + table, run b445c17e), which showed
  // the heading over nothing — every step read "Commands run" with no commands under it.
  const kept = withoutTrailingHeadings(lines, end > 0 ? end : limit);
  const shown = lines.slice(0, kept > 0 ? kept : limit).join('\n').trim();
  return { text: shown, more: true, verdict };
}

/** A line that only names the section after it: an ATX heading (`## Commands run`) or a bold-only
 *  label (`**Commands run:**`). */
const SECTION_HEADING = /^ {0,3}(?:#{1,6}(?:\s|$)|(?:\*\*|__)[^*_]+(?:\*\*|__):?\s*$)/;

/** The cut `end` moved back past trailing blank lines and section headings, so a heading whose body
 *  was cut off is dropped with it. `0` when nothing but headings precedes the cut. */
function withoutTrailingHeadings(lines: readonly string[], end: number): number {
  let e = end;
  while (e > 0 && (lines[e - 1]!.trim() === '' || SECTION_HEADING.test(lines[e - 1]!))) e -= 1;
  return e;
}

export interface FinalWords {
  /** The lead word: Done / Stopped. */
  lead: string;
  /** The sentences after it, plain words (operator 2026-10-17: "Done. Tests pass (38), and codex reviewed and
   *  approved it. Pull request #12 is open." — never crew's internal phrases). */
  line: string;
  /** The pull request, when the delivery opened one. */
  pr: { url: string; number: string | null } | null;
  /** The branch the work went to, when it was pushed without a PR. */
  branch: string | null;
}

/** What checked the work, as the final message says it. */
export interface FinalChecks {
  /** crew's acceptance verdict: passed, did not pass, or none read. */
  passed: boolean | null;
  /** The test count crew's own acceptance words name ("38 tests"), when they name one. */
  tests: number | null;
  /** Nothing at all checked the finished run (the coverage read, studio#770). */
  nothing: boolean;
  /** The seats whose review step finished (an accepted review), in run order. */
  reviewers: readonly string[];
  /** rig 0.15.8: the operator overrode a failed floor on the way here — the sentence that says so
   *  (`overriddenLine`), said instead of "The checks passed"; absent/null when nothing was overridden. */
  overridden?: string | null;
  /** J4: what assured the tree that was DELIVERED — `false` for a hand-over nothing re-verified (crew's
   *  `delivery_assurance.verified: false`, the post-hoc lift); absent/null when no record says so. */
  deliveryVerified?: boolean | null;
}

/** The test count in crew's acceptance words ("the repo's checks passed (38 tests)"), or null. */
export function testCountOf(...texts: ReadonlyArray<string | null | undefined>): number | null {
  for (const t of texts) {
    const m = typeof t === 'string' ? /\b(\d+)\s+tests?\b/i.exec(t) : null;
    if (m !== null) return Number(m[1]);
  }
  return null;
}

/**
 * The seats whose review step finished AND said it passed (its output's `VERDICT: PASS`), from the run's units. A
 * review that finished with no verdict read, or with a failing one, approved nothing (codex r1 #3: an ungated review
 * can finish while its report says FAIL).
 */
export function approvingReviewers(view: SessionView, isReview: (u: SessionView['units'][number]) => boolean,
  verdictOf: (ord: number) => 'pass' | 'fail' | null): string[] {
  const out: string[] = [];
  for (const u of [...view.units].sort((a, b) => a.ord - b.ord)) {
    const cli = u.assigned_cli;
    if (u.status !== 'done' || !isReview(u) || typeof cli !== 'string' || cli === '') continue;
    if (verdictOf(u.ord) !== 'pass') continue;
    if (!out.includes(cli)) out.push(cli);
  }
  return out;
}

function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** The final message's words for a finished, stopped or cancelled run. */
export function finalWords(view: SessionView, steps: { done: number; total: number }, checks: FinalChecks): FinalWords {
  const s = view.session.status;
  const d = deliveryOf(view);
  const pr = d.url !== null ? { url: d.url, number: /\/pull\/(\d+)/.exec(d.url)?.[1] ?? null } : null;
  const branch = d.pushed?.branch ?? null;
  const sentences: string[] = [];
  if (s !== 'completed' && steps.total > 0) sentences.push(`It stopped after ${steps.done} of ${steps.total} steps.`);
  // An override replaces only "passed": checks that did not pass are still said (pr-xreview on studio#899).
  const overridden = checks.overridden ?? null;
  if (overridden !== null) sentences.push(overridden);
  // J4 (rig run f3d30829): "The checks passed" is said of the tree that SHIPPED. A run with a deliver step
  // says it only when that tree was delivered (a recorded PR or pushed branch) by the engine's checked
  // hand-over; a hand-over nothing re-verified says so instead, and work that was not pushed claims nothing.
  const deliverStep = d.state !== 'none';
  const shipped = s === 'completed' && (pr !== null || d.state === 'pushed' || (d.state === 'delivered' && hasDeliveredRef(view)));
  const unverified = shipped && checks.deliveryVerified === false;
  const passedHere = !deliverStep || (shipped && !unverified);
  const tested = checks.passed === true ? (overridden !== null || !passedHere ? null : checks.tests !== null ? `Tests pass (${checks.tests})` : 'The checks passed')
    : checks.passed === false ? 'The checks did not pass' : null;
  if (unverified) sentences.push('Nothing re-checked the tree that was delivered.');
  const reviewed = checks.reviewers.length > 0 ? andList(checks.reviewers) : null;
  if (tested !== null && reviewed !== null) sentences.push(`${tested}, and ${reviewed} reviewed and approved it.`);
  else if (tested !== null) sentences.push(`${tested}.`);
  else if (reviewed !== null) sentences.push(`Reviewed and approved by ${reviewed}.`);
  else if (checks.nothing) sentences.push('Nothing checked this work.');
  if (s === 'completed') {
    if (pr !== null) sentences.push(pr.number !== null ? `Pull request #${pr.number} is open.` : 'A pull request is open.');
    else if (d.state === 'pushed') sentences.push(branch !== null ? `The work is on branch ${branch}.` : 'The branch was pushed.');
    else if (d.state === 'stranded') sentences.push('The work hasn’t been pushed anywhere yet: “Deliver — open a PR” on its delivery card pushes it.');
    else if (d.state === 'nothing-to-deliver') sentences.push('There was nothing to deliver.');
    else if (d.state === 'failed') sentences.push('The delivery didn’t go through.');
    else if (d.state === 'delivered' && !shipped) sentences.push('No pull request or pushed branch is recorded.');
  }
  // A finished run whose hand-over did not land is not "Done" (J4): it says so first.
  const lead = s !== 'completed' ? 'Stopped' : d.state === 'stranded' || d.state === 'failed' ? 'Not delivered' : 'Done';
  return { lead, line: sentences.join(' '), pr, branch };
}
