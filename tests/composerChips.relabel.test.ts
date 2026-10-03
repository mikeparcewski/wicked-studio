// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { addAboutChip, chipsOf, clearAboutChips, relabelAboutChip, removeAboutChip, useComposerChips } from '../src/store/composerChips.js';

/**
 * S9: a chip quotes its subject as it reads now. When the page changes under a chip that is already
 * on the composer (the operator's own edit, an Undo, a helper's version), the chip takes the new
 * words in place — and a chip the operator removed is never put back.
 */
const KEY = 'session-1';
const chips = (): Array<{ key: string; label: string }> => chipsOf(useComposerChips.getState(), KEY).map((c) => ({ key: c.key, label: c.label }));

describe('relabelAboutChip', () => {
  beforeEach(() => clearAboutChips(KEY));

  it('a chip on the composer takes the newer words, in place', () => {
    addAboutChip(KEY, { kind: 'about', key: 'el:deck/slide-2-heading-1', label: '“Staff stay in control”' });
    addAboutChip(KEY, { kind: 'about', key: 'q:pay', label: '“the Pay button”' });
    relabelAboutChip(KEY, { kind: 'about', key: 'el:deck/slide-2-heading-1', label: '“Staff are in charge”' });
    expect(chips()).toStrictEqual([
      { key: 'el:deck/slide-2-heading-1', label: '“Staff are in charge”' },
      { key: 'q:pay', label: '“the Pay button”' },
    ]);
  });

  it('a subject that is not on the composer is not added — a removed chip stays removed', () => {
    addAboutChip(KEY, { kind: 'about', key: 'el:deck/slide-2-heading-1', label: '“Staff stay in control”' });
    removeAboutChip(KEY, 'el:deck/slide-2-heading-1');
    relabelAboutChip(KEY, { kind: 'about', key: 'el:deck/slide-2-heading-1', label: '“Staff are in charge”' });
    expect(chips()).toStrictEqual([]);
  });

  it('the same words change nothing (no new list, no re-render)', () => {
    addAboutChip(KEY, { kind: 'about', key: 'el:deck/slide-2', label: 'slide 3 — “Staff stay in control”' });
    const before = chipsOf(useComposerChips.getState(), KEY);
    relabelAboutChip(KEY, { kind: 'about', key: 'el:deck/slide-2', label: 'slide 3 — “Staff stay in control”' });
    expect(chipsOf(useComposerChips.getState(), KEY)).toBe(before);
  });
});
