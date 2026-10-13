import { describe, expect, it } from 'vitest';
import { adaptInstruction, audienceLabel, deckOf, slideWords } from '../src/board/deck.js';
import { diffSummary, slideDiff } from '../src/board/deckDiff.js';

/**
 * The deck read from a version (DES-PRESENTATION-EDITOR-001 P-D1): the engine's slides, in DOCUMENT
 * order, named by `data-slide-id` — never by the index inside a positional `section-{i}` anchor, which
 * is kept when a slide moves (the filmstrip order bug).
 */

const slide = (id: string, wid: string, title: string, body = '', notes = ''): string =>
  `<section data-slide-id="${id}" data-wid="${wid}"><h2 data-wid="${wid}-h">${title}</h2>${body === '' ? '' : `<p>${body}</p>`}${notes === '' ? '' : `<aside class="notes" data-notes-for="${id}" hidden>${notes}</aside>`}</section>`;

describe('deckOf — the engine’s slides, in document order', () => {
  it('a moved slide is numbered by its place, not by its kept positional anchor (the order bug)', () => {
    // section-0 was moved to the end: its anchor still says 0
    const html = `<main>${slide('sb', 'section-1', 'Revenue')}${slide('sc', 'section-2', 'Next')}${slide('sa', 'section-0', 'Q3 review')}</main>`;
    const d = deckOf(html);
    expect(d.map((s) => [s.n, s.id, s.title])).toStrictEqual([[1, 'sb', 'Revenue'], [2, 'sc', 'Next'], [3, 'sa', 'Q3 review']]);
    expect(d[2]!.wid).toBe('section-0');
  });
  it('the engine’s rule: nested sections are part of their slide; void elements and notes asides are never slides', () => {
    const html = '<section data-slide-id="a"><h1>A</h1><section><h2>inside A</h2></section>'
      + '<img class="slide" src="x.png"><aside class="slide notes" data-notes-for="a" hidden><section><h2>Speaker</h2></section>Say it</aside></section>'
      + '<div data-slide data-slide-id="b"><p>Only a line, no heading</p></div><div class="title slide" data-slide-id="c"></div>';
    const d = deckOf(html);
    expect(d.map((s) => s.id)).toStrictEqual(['a', 'b', 'c']);
    expect(d[0]!.notes).toContain('Say it');
    expect(d[0]!.text).toBe('A inside A');
    expect(d[1]!.title).toBe('Only a line, no heading');
    expect(d[2]!.title).toBe('');
    expect(slideWords(d[2]!)).toBe('slide 3');
    expect(slideWords(d[0]!)).toBe('slide 1 — “A”');
  });
  it('a long first line is cut for the title; notes are the slide’s own', () => {
    const d = deckOf(slide('a', 'section-0', 'x'.repeat(120), 'body', 'n1') + slide('b', 'section-1', 'B'));
    expect(d[0]!.title.endsWith('…')).toBe(true);
    expect(d[0]!.title.length).toBe(80);
    expect(d[0]!.notes).toBe('n1');
    expect(d[1]!.notes).toBe('');
  });
});

describe('slideDiff — two versions, slide by slide, by id', () => {
  const v1 = deckOf(slide('a', 'section-0', 'Q3 review', 'Where we are') + slide('b', 'section-1', 'Revenue', 'Up 18%') + slide('c', 'section-2', 'Next', 'Hire two AEs'));
  it('added, removed, moved, changed words and changed notes', () => {
    const v2 = deckOf(slide('c', 'section-2', 'Next', 'Hire three AEs', 'Name them') + slide('a', 'section-0', 'Q3 review', 'Where we are') + slide('d', 'section-3', 'Risks'));
    const rows = slideDiff(v1, v2);
    expect(rows.map((r) => [r.kind, r.before?.id ?? null, r.after?.id ?? null, r.moved, r.notesChanged])).toStrictEqual([
      ['changed', 'c', 'c', true, true],
      ['same', 'a', 'a', true, false],
      ['added', null, 'd', false, false],
      ['removed', 'b', null, false, false],
    ]);
    expect(rows[0]!.words!.filter((p) => p.change !== 'same').map((p) => [p.change, p.text])).toStrictEqual([['removed', 'two'], ['added', 'three']]);
    expect(rows[0]!.notes!.some((p) => p.change === 'added' && p.text.includes('Name them'))).toBe(true);
    expect(diffSummary(rows)).toBe('1 changed · 1 added · 1 removed · 2 moved · notes on 1');
  });
  it('an insert does not count the slides after it as moved', () => {
    const v2 = deckOf(slide('a', 'section-0', 'Q3 review', 'Where we are') + slide('n', 'section-9', 'New') + slide('b', 'section-1', 'Revenue', 'Up 18%') + slide('c', 'section-2', 'Next', 'Hire two AEs'));
    const rows = slideDiff(v1, v2);
    expect(rows.filter((r) => r.moved)).toHaveLength(0);
    expect(diffSummary(rows)).toBe('1 added');
    expect(diffSummary(slideDiff(v1, v1))).toBe('No slide changed');
  });
});

describe('audiences (D8)', () => {
  it('three presets plus custom words; the instruction keeps every anchor', () => {
    expect(audienceLabel(null)).toBe('Not set');
    expect(audienceLabel({ preset: 'exec' })).toBe('Executives');
    expect(audienceLabel({ preset: 'custom', label: ' Board of trustees ' })).toBe('Board of trustees');
    const i = adaptInstruction({ preset: 'customer' }, 'shorten');
    expect(i).toMatch(/customers/);
    expect(i).toMatch(/shorter/);
    expect(i).toMatch(/speaker notes/);
    expect(i).toMatch(/data-wid and data-slide-id/);
    expect(adaptInstruction({ preset: 'custom', label: 'the board' }, 'keep')).toMatch(/^Rewrite this slide for the board\./);
  });
});
