/**
 * The phase report's CONTEXT DOCUMENT words (called the working document before the engine kept a context block; power
 * mode spike 3, context-doc-switch): who wrote a section, the version trail, and the
 * Decisions lines the plugin writes as itself. Pure; the plugin and the tests use it.
 */

import { stepLabelOf } from '../../board/chainModel.js';
import { clock as clockOf, gateWord, openGates, type PauseChoice, type Report } from './model.js';

export type SectionId = 'goal' | 'approach' | 'decisions' | 'constraints' | 'questions' | 'next';
export const SECTIONS: readonly SectionId[] = ['goal', 'approach', 'decisions', 'constraints', 'questions', 'next'];

export const SECTION_LABELS: Readonly<Record<SectionId, string>> = {
  goal: 'Goal', approach: 'Approach', decisions: 'Decisions', constraints: 'Constraints and steering',
  questions: 'Open questions', next: 'Next and trailing work',
};

/** What saving a section does, said under its editor (an engine with no context block: crew's notes). */
export const SECTION_EFFECT: Readonly<Record<SectionId, string>> = {
  goal: 'Saving tells the next step.',
  approach: 'Saving tells the next step.',
  next: 'Saving tells the next step.',
  constraints: 'Saving tells the next step and every step after it.',
  decisions: 'Recorded here. Not sent to a step.',
  questions: 'Recorded here. Not sent to a step.',
};

export const STEER_NOTE = 'Edits steer the next step. They can raise rigor, never lower it.';

/** (context-doc-switch) With the engine's context block: Goal, Approach and Constraints reach every agent of the job. */
export const SECTION_EFFECT_BLOCK: Readonly<Record<SectionId, string>> = {
  goal: 'Saving sends it to every agent of this job as context.',
  approach: 'Saving sends it to every agent of this job as context.',
  constraints: 'Saving sends it to every agent of this job as context.',
  next: 'Saving tells the next step.',
  decisions: 'Recorded here. Not sent to a step.',
  questions: 'Recorded here. Not sent to a step.',
};
export const STEER_NOTE_BLOCK = 'What you write in Goal, Approach and Constraints goes to every agent this job starts (builders, reviewers, judges and QE) as context. It adds to what is checked, never skips a check.';

/** What saving a section does, for this document. */
export function sectionEffect(view: Pick<DocView, 'context'> | null, id: SectionId): string {
  return view?.context?.engine === true ? SECTION_EFFECT_BLOCK[id] : SECTION_EFFECT[id];
}

/** The line under the heading. */
export function steerNote(view: Pick<DocView, 'context'> | null): string {
  return view?.context?.engine === true ? STEER_NOTE_BLOCK : STEER_NOTE;
}

/** Who wrote a version: a person, a plugin, crew (the job's request), or an AGENT — the orchestrator's own Approach and
 *  Decisions, written by crew as `agent:<seat>` (power-mode-engine's contract). Only a person's edit steers. */
export interface Author { kind: 'human' | 'plugin' | 'system' | 'agent'; id: string }
export interface TrailEntry { version: number; author: Author; surface: string | null; sections: SectionId[]; at: number; steerId: string | null }
export interface Steer { id: string; kind: 'next' | 'standing'; pickedUp: { ord: number | null; step: string | null; at: number } | null; queuedAt: number | null; error: string | null }
/** One seat the engine handed the context block to (crew, from the engine's `runContextDelivered`). */
export interface ContextRecipient { recipient: string; cli: string; ord: number }
/** (context-doc-switch) The engine's context block, as crew fed it. */
export interface DocContext {
  engine: boolean;
  version: number | null;
  sections: SectionId[];
  cut: SectionId[];
  at: number | null;
  error: { version: number; reason: string; at: number; cleared: boolean } | null;
  seenBy: ContextRecipient[];
}
export interface DocView {
  doc: { head: number } | null;
  sections: Record<SectionId, string> | null;
  trail: TrailEntry[];
  steers: Steer[];
  /** Crew writes the event-derived Decisions, Open questions and Next lines itself (engine-gaps, 2026-10-30), so a run
   *  nobody views gets them too. Then this plugin writes none: it renders the document and saves a person's edits. */
  eventLines?: boolean;
  /** (context-doc-switch) Absent on an older crew or an engine with no context block. */
  context?: DocContext;
}

/** The plugin writes its own lines only while crew does not (an older crew: absent). */
export function pluginWritesLines(view: Pick<DocView, 'eventLines'> | null): boolean {
  return view?.eventLines !== true;
}

const SEAT_NAMES: Readonly<Record<string, string>> = {
  claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', antigravity: 'Antigravity', pi: 'Pi CLI', opencode: 'OpenCode', copilot: 'Copilot',
};

/** "You", a plugin's own name, an agent's seat ("Claude Code (agent)"), or crew. */
export function authorWord(a: Author): string {
  if (a.kind === 'human') return a.id === 'local' ? 'You' : a.id;
  if (a.kind === 'plugin') return /^plugin:wicked-phase-report@/u.test(a.id) ? 'Phase report (plugin)' : `${a.id.replace(/^plugin:/u, '').replace(/@.*$/u, '')} (plugin)`;
  if (a.kind === 'agent') {
    const seat = a.id.replace(/^agent:/u, '');
    return `${SEAT_NAMES[seat] ?? seat} (agent)`;
  }
  return 'From the job’s request';
}

/** A trail entry's author kind as crew may send it: an `agent:<seat>` id is an agent whatever the kind says. */
function kindOf(a: Author): Author {
  return a.kind !== 'agent' && /^agent:/u.test(a.id) ? { kind: 'agent', id: a.id } : a;
}

/** Who wrote a section, by the trail: every author, newest first ("Phase report (plugin), You"), so a section with a
 *  person's lines and a plugin's lines names both. */
export function sectionAuthor(view: DocView, id: SectionId): string | null {
  const who: string[] = [];
  for (let i = view.trail.length - 1; i >= 0; i -= 1) {
    const t = view.trail[i]!;
    if (!t.sections.includes(id)) continue;
    const w = authorWord(kindOf(t.author));
    if (!who.includes(w)) who.push(w);
  }
  return who.length > 0 ? who.join(', ') : null;
}

const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * The step that picked a steer up, in words. Crew's `pickedUp.step` is sometimes the ENGINE's unit id
 * ("wf-<run>:unit-2"), not a plan step id: that is never shown. The step is named from the run's own step at `ord`
 * (`stepOfOrd`, the label the thread gives it), else from a plan step id, else "step N".
 */
export function pickedUpStep(p: { ord: number | null; step: string | null }, stepOfOrd: (ord: number) => string | null = () => null): string {
  const named = p.ord !== null ? stepOfOrd(p.ord) : null;
  if (named !== null && named !== '') return named;
  if (p.step !== null && p.step !== '' && !p.step.includes(':')) return stepLabelOf(p.step);
  return p.ord !== null ? `step ${p.ord}` : 'a step';
}

/** Where a steer stands: picked up at a step, waiting for the next one, or why it was not sent. */
export function steerWords(s: Steer | undefined, stepOfOrd?: (ord: number) => string | null): string | null {
  if (s === undefined) return null;
  if (s.error !== null) return `not sent: ${s.error}`;
  if (s.pickedUp !== null) return `picked up at ${pickedUpStep(s.pickedUp, stepOfOrd)} ${clock(s.pickedUp.at)}`;
  return 'waiting for the next step';
}

const RECIPIENT_WORDS: Readonly<Record<string, string>> = {
  judge: 'judge', triage: 'failure triage', council: 'council', team_member: 'team member', qe: 'QE', team_review: 'team review',
  send_back: 'plan send-back',
};

const listWords = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)!}`);

/** "Seen by: Fix (Claude Code), judge (Codex) and QE (Pi CLI)": the seats the engine handed the block in force to, one
 *  name per step or role and seat. Null when none yet. */
export function seenByWords(c: DocContext | undefined, stepOfOrd: (ord: number) => string | null = () => null): string | null {
  if (c === undefined || c.seenBy.length === 0 || c.sections.length === 0) return null;
  const names: string[] = [];
  for (const r of c.seenBy) {
    const role = r.recipient === 'unit' ? (stepOfOrd(r.ord) ?? `step ${r.ord}`) : (RECIPIENT_WORDS[r.recipient] ?? r.recipient.replace(/_/gu, ' '));
    const seat = r.cli !== '' ? ` (${SEAT_NAMES[r.cli] ?? r.cli})` : '';
    const name = `${role}${seat}`;
    if (!names.includes(name)) names.push(name);
  }
  return `Version ${c.version ?? '?'} seen by: ${listWords(names)}.`;
}

const n = (x: string): string => Number(x).toLocaleString('en-US');

/** The engine's refusal in a person's words: its size limit as "too long" with the numbers; anything else as said. */
function reasonWords(reason: string): string {
  const framed = /renders to (\d+) bytes[^;]*; at most (\d+)/u.exec(reason);
  if (framed !== null) return `it is too long once framed for the agents (${n(framed[1]!)} bytes; the most is ${n(framed[2]!)})${/; (.+)$/u.exec(reason.slice(framed.index + framed[0].length))?.[0] ?? ''}`;
  return reason.replace(/[.\s]+$/u, '');
}

/** What the document says about the engine's context block, or null (no block engine, nothing to say). */
export function contextWords(c: DocContext | undefined): { text: string; bad: boolean } | null {
  if (c === undefined || !c.engine) return null;
  // What the agents have now: the block the engine holds (its version, sections and cuts), said in every case, also
  // beside a failed later version (codex s1: a refusal hid a block still in force).
  const cut = c.cut.length > 0 && c.sections.length > 0
    ? ` ${listWords(c.cut.map((x) => SECTION_LABELS[x]))} ${c.cut.length === 1 ? 'was' : 'were'} cut to fit: agents get a shorter copy that says it was cut.`
    : '';
  const now = c.version !== null && c.sections.length > 0 ? `version ${c.version}: ${listWords(c.sections.map((x) => SECTION_LABELS[x]))}.${cut}` : null;
  if (c.error !== null && (c.version === null || c.error.version >= c.version)) {
    const fix = /too long|renders to|characters; at most/iu.test(c.error.reason) ? ' Shorten Goal, Approach or Constraints and save again.' : '';
    const kept = c.error.cleared
      ? ' The earlier context was taken out, so agents do not follow words you replaced.'
      : now !== null && c.version !== c.error.version ? ` Agents still have ${now}` : '';
    return { text: `Version ${c.error.version} is not in agents’ context: ${reasonWords(c.error.reason)}.${kept}${fix}`, bad: true };
  }
  if (now === null) return { text: 'Nothing of yours is in agents’ context now. Write a Goal, Approach or Constraints to add it.', bad: false };
  return { text: `In every agent’s context from ${now}`, bad: false };
}

/** "v3 · You · Constraints and steering · 14:32 · picked up at Review 14:40", newest first. */
const isContextEdit = (t: TrailEntry): boolean => t.sections.some((x) => x === 'goal' || x === 'approach' || x === 'constraints');

export function trailLines(view: DocView, max = 6, stepOfOrd?: (ord: number) => string | null): string[] {
  const lastContextEdit = view.trail.reduce((m, t) => (t.author.kind === 'human' && isContextEdit(t) ? Math.max(m, t.version) : m), -1);
  return view.trail.slice(-max).reverse().map((t) => {
    const a = kindOf(t.author);
    const parts = [`v${t.version}`, authorWord(a), t.sections.map((s) => SECTION_LABELS[s]).join(', '), clock(t.at)];
    const s = steerWords(view.steers.find((x) => x.id === t.steerId), stepOfOrd);
    const ctx = view.context;
    const inBlock = a.kind === 'human' && ctx?.engine === true && isContextEdit(t);
    if (inBlock && ctx !== undefined) {
      // (context-doc-switch) A person's Goal, Approach or Constraints go to every agent as context, not a step's note.
      // Said for the outcome crew keeps (the newest only): an older, superseded version gets no claim.
      if (ctx.error?.version === t.version) parts.push('not in agents’ context');
      else if (ctx.version === t.version) parts.push(t.sections.some((x) => ctx.sections.includes(x)) ? 'in every agent’s context' : 'taken out of agents’ context');
      else if (t.version === lastContextEdit && (ctx.version === null || ctx.version < t.version)) parts.push('going into agents’ context');
    }
    if (s !== null) parts.push(s);
    // A plugin's or an agent's text is recorded, never sent to a step.
    else if (!inBlock && (a.kind === 'plugin' || a.kind === 'agent')) parts.push('not sent to a step');
    return parts.join(' · ');
  });
}


// ── the lines the Phase report writes as itself (operator 2026-10-30: "the plugin should fill it from events") ──
//
// Decisions: each decision answered (a gate, a checkpoint pause: who and what) — kept, never taken back.
// Open questions: what waits on a person now (an open gate, a pause) — gone once answered.
// Next and trailing work: what the newest hand-off round left (a step that failed or was skipped) — gone once a later
// round passes it.
// A person's own lines in those sections are never touched. Only a person's edit steers (crew decides that).

const PAUSE_KIND_WORDS: Readonly<Record<string, string>> = {
  longer_than_estimated: 'taking much longer than estimated', tests_failing: 'the tests kept failing',
  changes_undone: 'changes were undone', rigor_jumped: 'rigor jumped two levels at once', spread: 'the change spread into another product',
  other: 'it grew more complex than planned',
};
const CHOICE_WORDS: Readonly<Record<PauseChoice, string>> = {
  continue_high: 'continue at high rigor', continue: 'continue as planned', switch_phased: 'switch to phased steps', stop: 'stop the job',
};
const HANDOFF_WORDS: Readonly<Record<string, { failed: string; skipped: string }>> = {
  checks: { failed: 'the checks failed: fix them and hand off again', skipped: 'the checks were skipped' },
  review: { failed: 'the review asked for changes: make them and hand off again', skipped: 'the review was skipped' },
  security: { failed: 'the security check found problems: fix them and hand off again', skipped: 'the security check was skipped' },
  qe: { failed: 'QE acceptance did not pass: fix it and hand off again', skipped: 'QE acceptance was skipped' },
  compliance: { failed: 'the compliance check did not pass', skipped: 'the compliance check was skipped' },
};

const why = (kinds: readonly string[]): string => (kinds.length > 0 ? ` (${kinds.map((k) => PAUSE_KIND_WORDS[k] ?? k).join('; ')})` : '');

/** What the plugin's own lines say now, per section, from the run's events. */
export function docLines(r: Report): { decisions: string[]; questions: string[]; next: string[] } {
  // Decisions in the order they were made.
  const made: Array<{ at: number; line: string }> = [];
  const questions: string[] = [];
  const next: string[] = [];
  for (const g of r.gates) if (g.answeredAt !== null) made.push({ at: g.answeredAt, line: `${gateWord(g.kind)} · answered ${clockOf(g.answeredAt)}` });
  const p = r.power;
  for (const pz of p?.pauses ?? []) {
    if (pz.choice !== null && pz.answeredAt !== null) {
      made.push({ at: pz.answeredAt, line: `Checkpoint ${pz.n} pause${why(pz.kinds)} · ${pz.byPerson ? 'you chose' : 'answered'}: ${CHOICE_WORDS[pz.choice]} · ${clockOf(pz.answeredAt)}` });
    } else if (r.finished === null) {
      questions.push(`Waiting on you · checkpoint ${pz.n} paused${why(pz.kinds)}: split it, switch to phased steps, continue at high rigor, or stop? · since ${clockOf(pz.at)}`);
    }
  }
  for (const g of openGates(r)) questions.push(`Waiting on you · ${gateWord(g.kind)} · since ${clockOf(g.openedAt)}`);
  if (p?.handoff != null) {
    for (const [step, st] of p.handoff.steps) {
      const w = HANDOFF_WORDS[step];
      if (w === undefined) continue;
      if (st.status === 'failed') next.push(`After hand-off round ${p.handoff.round} · ${w.failed}`);
      else if (st.status === 'skipped') next.push(`After hand-off round ${p.handoff.round} · ${w.skipped}`);
    }
  }
  const decisions = made.sort((a, b) => a.at - b.at).map((d) => d.line);
  return { decisions, questions, next };
}

/**
 * Every open-question line the plugin has written or would write for this run, exactly: one per decision and per
 * checkpoint pause it has seen, open or answered. A question line is the plugin's only when it is one of these: a line
 * a person edited, even inside the gate's name or the pause's reason, is theirs (codex + agy on #937).
 */
export function ownQuestionLines(r: Report): string[] {
  const out = r.gates.map((g) => `Waiting on you · ${gateWord(g.kind)} · since ${clockOf(g.openedAt)}`);
  for (const pz of r.power?.pauses ?? []) {
    out.push(`Waiting on you · checkpoint ${pz.n} paused${why(pz.kinds)}: split it, switch to phased steps, continue at high rigor, or stop? · since ${clockOf(pz.at)}`);
  }
  return out;
}

/** Whether a saved line stands for a generated one: it is that line, or a person's edit that kept its words. */
export function represents(saved: string, generated: string): boolean {
  return saved === generated || saved.startsWith(generated);
}

/**
 * The generated lines a write of `wanted` would ADD to a section's saved text: those no saved line stands for. Only
 * these become the plugin's own (codex r7 on #937): a line already there, a person's even in the plugin's words, is
 * never claimed.
 */
export function addedLines(current: string, wanted: readonly string[]): string[] {
  const saved = current.split('\n').map((l) => l.trim());
  return wanted.filter((w) => !saved.some((k) => represents(k, w)));
}

/**
 * A section's new text with the plugin's lines brought up to date, or null when nothing changes. A person's lines stay
 * as they are, in place. Decisions only ever gain lines; in Open questions and Next, the plugin's own lines that no
 * longer hold are taken out.
 */
export function reconcileSection(
  section: 'decisions' | 'questions' | 'next', current: string, wanted: readonly string[], ownQuestions: readonly string[] = [],
  ownNext: readonly string[] = [],
): string | null {
  const lines = current.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  // A Next line is the plugin's to take back only when it is, word for word, a line the plugin wrote (`ownNext`): a
  // template never establishes ownership, so a person's edit is never deleted, this round or a later one (codex r4/r6
  // on #937). A stale line the plugin wrote before a page reload stays until someone removes it.
  const mine = (l: string): boolean => (section === 'next' ? ownNext.includes(l) : ownQuestions.includes(l));
  const kept = section === 'decisions' ? lines : lines.filter((l) => !mine(l) || wanted.includes(l));
  // A person's edit that kept the line's words ("After hand-off round 1 · … — check the retry path first") stands for it.
  const add = wanted.filter((w) => !kept.some((k) => represents(k, w)));
  const out = [...kept, ...add];
  return out.join('\n') === lines.join('\n') ? null : out.join('\n');
}
