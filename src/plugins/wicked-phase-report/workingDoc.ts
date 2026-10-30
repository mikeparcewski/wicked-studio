/**
 * The phase report's WORKING DOCUMENT words (power mode spike 3): who wrote a section, the version trail, and the
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

/** What saving a section does, said under its editor. */
export const SECTION_EFFECT: Readonly<Record<SectionId, string>> = {
  goal: 'Saving tells the next step.',
  approach: 'Saving tells the next step.',
  next: 'Saving tells the next step.',
  constraints: 'Saving tells the next step and every step after it.',
  decisions: 'Recorded here. Not sent to a step.',
  questions: 'Recorded here. Not sent to a step.',
};

export const STEER_NOTE = 'Edits steer the next step. They can raise rigor, never lower it.';

/** Who wrote a version: a person, a plugin, crew (the job's request), or an AGENT — the orchestrator's own Approach and
 *  Decisions, written by crew as `agent:<seat>` (power-mode-engine's contract). Only a person's edit steers. */
export interface Author { kind: 'human' | 'plugin' | 'system' | 'agent'; id: string }
export interface TrailEntry { version: number; author: Author; surface: string | null; sections: SectionId[]; at: number; steerId: string | null }
export interface Steer { id: string; kind: 'next' | 'standing'; pickedUp: { ord: number | null; step: string | null; at: number } | null; queuedAt: number | null; error: string | null }
export interface DocView {
  doc: { head: number } | null;
  sections: Record<SectionId, string> | null;
  trail: TrailEntry[];
  steers: Steer[];
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

/** Where a steer stands: picked up at a step, waiting for the next one, or why it was not sent. */
export function steerWords(s: Steer | undefined): string | null {
  if (s === undefined) return null;
  if (s.error !== null) return `not sent: ${s.error}`;
  if (s.pickedUp !== null) return `picked up at ${s.pickedUp.step !== null ? stepLabelOf(s.pickedUp.step) : `step ${s.pickedUp.ord ?? '?'}`} ${clock(s.pickedUp.at)}`;
  return 'waiting for the next step';
}

/** "v3 · You · Constraints and steering · 14:32 · picked up at Review 14:40", newest first. */
export function trailLines(view: DocView, max = 6): string[] {
  return view.trail.slice(-max).reverse().map((t) => {
    const a = kindOf(t.author);
    const parts = [`v${t.version}`, authorWord(a), t.sections.map((s) => SECTION_LABELS[s]).join(', '), clock(t.at)];
    const s = steerWords(view.steers.find((x) => x.id === t.steerId));
    if (s !== null) parts.push(s);
    // A plugin's or an agent's text is recorded, never sent to a step.
    else if (a.kind === 'plugin' || a.kind === 'agent') parts.push('not sent to a step');
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

/** The plugin's own lines in a section (the ones it may take back): an open question or a hand-off follow-up. */
const MINE: Readonly<Record<'questions' | 'next', RegExp>> = { questions: /^Waiting on you · /u, next: /^After hand-off round \d+ · /u };

/**
 * A section's new text with the plugin's lines brought up to date, or null when nothing changes. A person's lines stay
 * as they are, in place. Decisions only ever gain lines; in Open questions and Next, the plugin's own lines that no
 * longer hold are taken out.
 */
export function reconcileSection(section: 'decisions' | 'questions' | 'next', current: string, wanted: readonly string[]): string | null {
  const lines = current.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const kept = section === 'decisions' ? lines : lines.filter((l) => !MINE[section].test(l) || wanted.includes(l));
  const add = wanted.filter((w) => !kept.includes(w));
  const out = [...kept, ...add];
  return out.join('\n') === lines.join('\n') ? null : out.join('\n');
}
