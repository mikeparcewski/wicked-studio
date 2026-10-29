/**
 * The phase report's WORKING DOCUMENT words (power mode spike 3): who wrote a section, the version trail, and the
 * Decisions lines the plugin writes as itself. Pure; the plugin and the tests use it.
 */

import { stepLabelOf } from '../../board/chainModel.js';

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

export interface Author { kind: 'human' | 'plugin' | 'system'; id: string }
export interface TrailEntry { version: number; author: Author; surface: string | null; sections: SectionId[]; at: number; steerId: string | null }
export interface Steer { id: string; kind: 'next' | 'standing'; pickedUp: { ord: number | null; step: string | null; at: number } | null; queuedAt: number | null; error: string | null }
export interface DocView {
  doc: { head: number } | null;
  sections: Record<SectionId, string> | null;
  trail: TrailEntry[];
  steers: Steer[];
}

/** "You", a plugin's own name, or crew. */
export function authorWord(a: Author): string {
  if (a.kind === 'human') return a.id === 'local' ? 'You' : a.id;
  if (a.kind === 'plugin') return /^plugin:wicked-phase-report@/u.test(a.id) ? 'Phase report (plugin)' : `${a.id.replace(/^plugin:/u, '').replace(/@.*$/u, '')} (plugin)`;
  return 'From the job’s request';
}

/** Who last wrote a section, by the trail. */
export function sectionAuthor(view: DocView, id: SectionId): string | null {
  for (let i = view.trail.length - 1; i >= 0; i -= 1) {
    const t = view.trail[i]!;
    if (t.sections.includes(id)) return authorWord(t.author);
  }
  return null;
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
    const parts = [`v${t.version}`, authorWord(t.author), t.sections.map((s) => SECTION_LABELS[s]).join(', '), clock(t.at)];
    const s = steerWords(view.steers.find((x) => x.id === t.steerId));
    if (s !== null) parts.push(s);
    return parts.join(' · ');
  });
}

/** The Decisions text with a line the plugin writes for an answered decision, or null when it is there already. */
export function withDecisionLine(current: string, line: string): string | null {
  const lines = current.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.includes(line)) return null;
  return [...lines, line].join('\n');
}
