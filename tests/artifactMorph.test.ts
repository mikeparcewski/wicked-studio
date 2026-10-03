// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addChip } from '../src/board/aboutChips.js';
import {
  anchorWords, coverageLine, coverageOf, editedLine, editorKindOf, elementChip, grow, namesId, notUndoneLine,
  requirementChip, shrink, slideChip, slideInView, slidesOf, undoneLine,
} from '../src/board/artifactMorph.js';

/**
 * S8 (DES-STUDIO-REBUILD-001 §11; DESIGN-interaction rules 1 and 3): the artifact is the control —
 * its preview grows inline → pane → full and Esc shrinks it one step; an element picked on the page
 * is the subject of the next message; a touch edit lands one version with an undo line, and an Undo
 * that would bury a helper's version says "Not undone".
 */
describe('grow / shrink — the morph steps', () => {
  it('grows one step and stops at full', () => {
    expect(grow('inline')).toBe('pane');
    expect(grow('pane')).toBe('full');
    expect(grow('full')).toBe('full');
  });
  it('Esc shrinks one step and stops at inline', () => {
    expect(shrink('full')).toBe('pane');
    expect(shrink('pane')).toBe('inline');
    expect(shrink('inline')).toBe('inline');
  });
});

describe('elementChip — the picked element as an about-chip', () => {
  it('quotes the element text, cut at the chip width, keyed by its anchor', () => {
    const c = elementChip('headline', 'Q3 was a quarter of significant and wide-ranging positive developments');
    expect(c.kind).toBe('about');
    expect(c.key).toBe('el:headline');
    expect(c.label.startsWith('“Q3 was a quarter')).toBe(true);
    expect(c.label.endsWith('…”')).toBe(true);
    expect(c.label.length).toBeLessThanOrEqual(46);
  });
  it('is keyed by the document too, so the same anchor in two pages makes two chips', () => {
    expect(elementChip('headline', 'x', 'offsite-plan').key).toBe('el:offsite-plan/headline');
  });
  it('picked again after its text changed, the one chip quotes the element as it reads now', () => {
    const other = { kind: 'about' as const, key: 'q:pay', label: '“the Pay button”' };
    const first = addChip([elementChip('headline', 'Q3 was a quarter', 'offsite-plan'), other], elementChip('headline', 'Q3, by the helper', 'offsite-plan'));
    expect(first.map((c) => c.key)).toStrictEqual(['el:offsite-plan/headline', 'q:pay']);
    expect(first[0]!.label).toBe('“Q3, by the helper”');
  });
  it('falls back to the anchor id when the element has no text', () => {
    expect(elementChip('hero-image', '').label).toBe('hero-image');
    expect(elementChip('hero-image', '   ').label).toBe('hero-image');
  });
});

describe('the lines under a touch edit', () => {
  it('names the version and the element, and offers Undo', () => {
    expect(editedLine(2, 'the headline')).toBe('Changed the headline — version 2.');
    expect(editedLine(2, anchorWords('slide-1-heading-1', 'deck'))).toBe('Changed slide 2’s title — version 2.');
  });
  it('says what Undo did, or why it did not', () => {
    expect(undoneLine(3)).toBe('Undone — version 3 is the page before your change.');
    expect(notUndoneLine(4)).toBe('Not undone — a helper changed the page since (version 4). Your change stays; undo by hand if you still want it.');
  });
});

/**
 * S9 (DES-STUDIO-REBUILD-001 §11; DES-EDITOR-PLUGINS-001 §7.2): the document and slide editors on
 * the same parts — which editor a document opens in, an anchor in plain words, the deck's slides,
 * and the coverage slot as the requirements read plus where the document names each one.
 */
describe('editorKindOf — the recorded style decides the editor', () => {
  it('a deck style is a deck, a document style is a document, anything else is a page', () => {
    expect(editorKindOf('ppt')).toBe('deck');
    // Only the styles the bridge records decide (the host rule, `resolveKind`): no other spelling.
    expect(editorKindOf('slides')).toBe('page');
    expect(editorKindOf('doc')).toBe('document');
    expect(editorKindOf('brochure')).toBe('document');
    expect(editorKindOf('web')).toBe('page');
    expect(editorKindOf(undefined)).toBe('page');
    expect(editorKindOf(null)).toBe('page');
    expect(editorKindOf('something-newer')).toBe('page');
  });
});

describe('anchorWords — an anchor in plain words, never its raw id', () => {
  it('a deck names the slide: its title, or the role and its number', () => {
    expect(anchorWords('slide-1-heading-1', 'deck')).toBe('slide 2’s title');
    expect(anchorWords('slide-1-heading-2', 'deck')).toBe('slide 2’s heading 2');
    expect(anchorWords('slide-0-paragraph-3', 'deck')).toBe('slide 1’s paragraph 3');
    expect(anchorWords('slide-3-list-item-2', 'deck')).toBe('slide 4’s list item 2');
    expect(anchorWords('section-2', 'deck')).toBe('slide 3');
  });
  it('a page or a document names the role, and the section past the first', () => {
    expect(anchorWords('slide-0-paragraph-2', 'document')).toBe('paragraph 2');
    expect(anchorWords('slide-0-heading-1', 'page')).toBe('heading 1');
    expect(anchorWords('slide-2-paragraph-1', 'document')).toBe('paragraph 1 in section 3');
    expect(anchorWords('slide-0-cell-4', 'page')).toBe('table cell 4');
    expect(anchorWords('slide-0-text-1', 'page')).toBe('line 1');
    expect(anchorWords('section-1', 'document')).toBe('section 2');
  });
  it('an id the engine did not mint reads as its own words — when it is made of words', () => {
    expect(anchorWords('headline', 'page')).toBe('the headline');
    expect(anchorWords('hero_fact-strip', 'page')).toBe('the hero fact strip');
    expect(anchorWords('Pricing-Table', 'document')).toBe('the pricing table');
  });
  it('an id that is not words is never shown', () => {
    for (const wid of ['a8f09c', 'blk_12', 'x', 'el-3f', '9', 'slide-x-heading-1']) expect(anchorWords(wid, 'page')).toBe('this part');
  });
  it('no words hold the raw anchor grammar', () => {
    for (const wid of ['slide-0-heading-1', 'slide-4-block-2', 'section-0']) {
      for (const kind of ['page', 'document', 'deck'] as const) expect(anchorWords(wid, kind)).not.toMatch(/slide-\d|section-\d/);
    }
  });
});

describe('slidesOf / slideInView / slideChip — the deck, read from the frame', () => {
  const blocks = {
    'section-0': { text: 'Library room booking A study room in two taps.', composite: true },
    'slide-0-heading-1': { text: 'Library room booking', composite: false },
    'slide-0-paragraph-1': { text: 'A study room in two taps.', composite: false },
    'section-1': { text: 'Residents first', composite: true },
    'slide-1-heading-1': { text: 'Residents first', composite: false },
    'slide-2-paragraph-1': { text: 'A slide with no heading — its first line names it, however long that line turns out to be.', composite: false },
    headline: { text: 'not the engine’s', composite: false },
  };
  it('one slide per index that carries a block, named by its title, else its first line (cut)', () => {
    const slides = slidesOf(blocks);
    expect(slides.map((s) => s.index)).toStrictEqual([0, 1, 2]);
    expect(slides[0]).toStrictEqual({ index: 0, title: 'Library room booking', first: 'slide-0-heading-1' });
    expect(slides[1]!.title).toBe('Residents first');
    expect(slides[2]!.title.endsWith('…')).toBe(true);
    expect(slides[2]!.first).toBe('slide-2-paragraph-1');
    expect(slidesOf({ headline: { text: 'x', composite: false } })).toStrictEqual([]);
  });
  it('the slide in view is the last one that starts at or above the middle of the frame', () => {
    const slides = slidesOf(blocks);
    const tops = { 'slide-0-heading-1': 60, 'slide-1-heading-1': 560, 'slide-2-paragraph-1': 1060 };
    expect(slideInView(slides, tops, 0, 600)).toBe(0);
    expect(slideInView(slides, tops, 300, 600)).toBe(1);
    expect(slideInView(slides, tops, 900, 600)).toBe(2);
    expect(slideInView(slides, {}, 0, 600)).toBeNull();
    expect(slideInView([], tops, 0, 600)).toBeNull();
  });
  it('a slide is a subject, keyed by the document and the slide', () => {
    const [first] = slidesOf(blocks);
    expect(slideChip(first!, 'library-pitch')).toStrictEqual({ kind: 'about', key: 'el:library-pitch/slide-0', label: 'slide 1 — “Library room booking”' });
    expect(slideChip({ index: 3, title: '', first: 'slide-3-block-1' }, 'd').label).toBe('slide 4');
  });
});

describe('coverageOf — the requirements read, and where the document names each one', () => {
  const reqs = [
    { key: 'booking::REQ-001', reqId: 'REQ-001', title: 'Two views', risk: false },
    { key: 'booking::REQ-002', reqId: 'REQ-002', title: 'Unclaimed rooms return', risk: true },
    { key: 'booking::REQ-00', reqId: 'REQ-00', title: 'A prefix of another id', risk: false },
    { key: 'booking::R.3', reqId: 'R.3', title: 'An id with a dot', risk: false },
  ];
  const blocks = {
    'section-0': { text: 'everything, REQ-001 and REQ-002 and R.3 included', composite: true },
    'slide-0-paragraph-1': { text: 'One app and one day view (REQ-001).', composite: false },
    'slide-0-paragraph-2': { text: 'Rooms go back to the list, req-002, after ten minutes.', composite: false },
    'slide-0-paragraph-3': { text: 'Rxx3 is not R.3 said with any character.', composite: false },
  };
  it('keeps every row of the read, in order, and finds the first block of its own text that names the id', () => {
    const rows = coverageOf(reqs, blocks);
    expect(rows.map((r) => r.key)).toStrictEqual(reqs.map((r) => r.key));
    expect(rows[0]!.wid).toBe('slide-0-paragraph-1');
    expect(rows[1]!.wid).toBe('slide-0-paragraph-2'); // any letter case
    expect(rows[1]!.risk).toBe(true);
  });
  it('an id is a whole word: REQ-00 is not named by REQ-001, and a dot is a dot', () => {
    const rows = coverageOf(reqs, blocks);
    expect(rows[2]!.wid).toBeNull();
    expect(rows[3]!.wid).toBe('slide-0-paragraph-3');
    expect(coverageOf([{ key: 'k', reqId: 'R.3', title: 't', risk: false }], { p: { text: 'Rxx3', composite: false } })[0]!.wid).toBeNull();
  });
  it('an id inside a longer id does not name it', () => {
    for (const longer of ['REQ-10', 'REQ-1-2', 'REQ-1_b', 'REQ-1.2', 'XREQ-1', 'pre-REQ-1', 'v2.REQ-1']) expect(namesId(`see ${longer} here`, 'REQ-1')).toBe(false);
    for (const whole of ['(REQ-1).', 'REQ-1, then', 'req-1', 'ends with REQ-1.', 'REQ-1: two taps', '“REQ-1”']) expect(namesId(whole, 'REQ-1')).toBe(true);
    // A later whole mention counts even after a longer id that only starts like it.
    expect(namesId('REQ-10 and REQ-1', 'REQ-1')).toBe(true);
    expect(namesId('anything', '')).toBe(false);
  });
  it('a container never counts, and a requirement with no id is never named', () => {
    expect(coverageOf([reqs[0]!], { 'section-0': blocks['section-0'] })[0]!.wid).toBeNull();
    expect(coverageOf([{ key: 'k', reqId: ' ', title: 't', risk: false }], blocks)[0]!.wid).toBeNull();
  });
  it('the line counts what the document names, and says when the read holds more than the rows shown', () => {
    const rows = coverageOf(reqs, blocks);
    expect(coverageLine(rows, 4)).toBe('3 of 4 named in this document');
    expect(coverageLine(rows, 42)).toBe('3 of 4 named in this document (the first 4 of 42)');
    expect(coverageLine([], 0)).toBe('0 of 0 named in this document');
  });
  it('a requirement is a subject', () => {
    expect(requirementChip(reqs[1]!)).toStrictEqual({ kind: 'about', key: 'req:booking::REQ-002', label: 'requirement REQ-002' });
  });
});
