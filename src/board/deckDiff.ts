import { diffWords } from 'diff';
import type { DeckSlide } from './deck.js';

/**
 * Two versions of a deck compared slide by slide (DES-PRESENTATION-EDITOR-001 D3's slide diff). Its
 * own module so the deck model the `wicked-deck` plugin bundles never pulls in the word diff (jsdiff).
 */

// ── compare: two versions, slide by slide (D3's slide diff) ─────────────────────────────────

export type WordPart = { text: string; change: 'same' | 'added' | 'removed' };

export interface SlideDiffRow {
  /** What happened to the slide from `before` to `after`. A slide can have moved AND changed. */
  kind: 'added' | 'removed' | 'changed' | 'same';
  moved: boolean;
  notesChanged: boolean;
  before: DeckSlide | null;
  after: DeckSlide | null;
  /** Word-level diff of the slide's text (jsdiff `diffWords`), when it changed. */
  words: WordPart[] | null;
  /** Word-level diff of the notes, when they changed. */
  notes: WordPart[] | null;
}

const partsOf = (a: string, b: string): WordPart[] =>
  diffWords(a, b).map((p) => ({ text: p.value, change: p.added ? 'added' : p.removed ? 'removed' : 'same' }));

/**
 * Two versions of a deck, slide by slide, matched by `data-slide-id`: added, removed, moved (its
 * place among the slides both versions have changed), changed text, changed notes. Rows follow the
 * AFTER version's order; removed slides come last, in the order they stood before. Slides without an id
 * (an engine that has not assigned them) are matched by position.
 */
export function slideDiff(before: readonly DeckSlide[], after: readonly DeckSlide[]): SlideDiffRow[] {
  const key = (s: DeckSlide): string => s.id ?? `#${s.n}`;
  const was = new Map(before.map((s) => [key(s), s]));
  const now = new Map(after.map((s) => [key(s), s]));
  // Moves are judged among the slides both versions have, so an insert does not "move" the rest.
  const commonBefore = before.filter((s) => now.has(key(s))).map(key);
  const commonAfter = after.filter((s) => was.has(key(s))).map(key);
  const rankBefore = new Map(commonBefore.map((k, i) => [k, i]));
  const rankAfter = new Map(commonAfter.map((k, i) => [k, i]));
  const rows: SlideDiffRow[] = [];
  for (const s of after) {
    const old = was.get(key(s));
    if (old === undefined) {
      rows.push({ kind: 'added', moved: false, notesChanged: false, before: null, after: s, words: null, notes: null });
      continue;
    }
    const changed = old.text !== s.text;
    const notesChanged = old.notes !== s.notes;
    rows.push({
      kind: changed ? 'changed' : 'same',
      moved: rankBefore.get(key(s)) !== rankAfter.get(key(s)),
      notesChanged,
      before: old,
      after: s,
      words: changed ? partsOf(old.text, s.text) : null,
      notes: notesChanged ? partsOf(old.notes, s.notes) : null,
    });
  }
  for (const s of before) {
    if (!now.has(key(s))) rows.push({ kind: 'removed', moved: false, notesChanged: false, before: s, after: null, words: null, notes: null });
  }
  return rows;
}

/** One line for the whole compare: "2 changed · 1 added · 1 moved · notes on 3". */
export function diffSummary(rows: readonly SlideDiffRow[]): string {
  const count = (f: (r: SlideDiffRow) => boolean): number => rows.filter(f).length;
  const parts = [
    [count((r) => r.kind === 'changed'), 'changed'],
    [count((r) => r.kind === 'added'), 'added'],
    [count((r) => r.kind === 'removed'), 'removed'],
    [count((r) => r.moved), 'moved'],
  ].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`);
  const notes = count((r) => r.notesChanged);
  if (notes > 0) parts.push(`notes on ${notes}`);
  return parts.length === 0 ? 'No slide changed' : parts.join(' · ');
}

