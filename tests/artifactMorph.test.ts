// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  editedLine, elementChip, grow, notUndoneLine, shrink, undoneLine,
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
  it('falls back to the anchor id when the element has no text', () => {
    expect(elementChip('hero-image', '').label).toBe('hero-image');
    expect(elementChip('hero-image', '   ').label).toBe('hero-image');
  });
});

describe('the lines under a touch edit', () => {
  it('names the version and the element, and offers Undo', () => {
    expect(editedLine(2, 'headline')).toBe('Changed headline — version 2.');
  });
  it('says what Undo did, or why it did not', () => {
    expect(undoneLine(3)).toBe('Undone — version 3 is the page before your change.');
    expect(notUndoneLine(4)).toBe('Not undone — a helper changed the page since (version 4). Your change stays; undo by hand if you still want it.');
  });
});
