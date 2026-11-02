/**
 * Round-5 look on :7721: Report's document scrolled to 4893 px at a 700 px window (and the run page did in round 3).
 * Screen-reader-only words are absolutely placed; with no offsets they sit at their static position, so one deep in a
 * page whose scroll container is not positioned stretched the document. Pinned to the containing block's top-left, a
 * 1 px clipped box never reaches past the window, whatever contains it.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(fileURLToPath(new URL(`../src/styles/${p}`, import.meta.url)), 'utf8');
const rule = (css: string, selector: string): string => { const i = css.indexOf(`${selector} {`); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };

describe('visually hidden words never stretch the page', () => {
  it.each([
    ['components.css', '.wk-visually-hidden'], ['components.css', '.wk-desk-move-status'],
    ['sections/desk.css', '.wk-sr-only'], ['sections/calm.css', '.sr-only'],
  ])('%s %s is pinned to its containing block\'s top-left', (file, selector) => {
    const r = rule(read(file), selector);
    expect(r).toMatch(/position: absolute/u);
    expect(r).toMatch(/top: 0;/u);
    expect(r).toMatch(/left: 0;/u);
  });
});
