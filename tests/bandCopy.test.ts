import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bandHint, bandLabel } from '../src/board/bandCopy.js';

describe('bandLabel', () => {
  it.each([
    ['needs-you', 'Needs you'],
    ['working',   'Working'],
    ['quiet',     'Quiet'],
  ] as const)('returns the operator label for %s', (band, expected) => {
    expect(bandLabel(band)).toBe(expected);
  });
});

describe('bandHint', () => {
  it.each([
    ['needs-you', 'A gate is open or a recent run failed — your attention is required.'],
    ['working',   'A run is active and progressing without your input.'],
    ['quiet',     'No active runs or open gates — this project is idle.'],
  ] as const)('returns a hint for %s', (band, expected) => {
    expect(bandHint(band)).toBe(expected);
  });
});

/**
 * The module only earns its place if the board USES it. As opened, this slice added the copy and
 * left `HomeBoard.tsx` holding the same three strings inline — a second source of truth, which is
 * worse than no module at all: the next person changes one and the other silently disagrees.
 *
 * Asserted against the SOURCE because the alternative (rendering HomeBoard) needs the whole run
 * store; the property that matters is "the literals are gone from the component", and that reads
 * directly.
 */
describe('the board consumes this module rather than repeating it', () => {
  const src = readFileSync(
    join(import.meta.dirname, '..', 'src', 'components', 'HomeBoard.tsx'),
    'utf8',
  );
  // Comments legitimately mention the band names (e.g. a note about `Quiet (9)`), so only JSX
  // TEXT counts — `>Needs you<` is a rendered literal, a mention in prose is not.
  const jsxText = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each([
    ['needs-you', 'Needs you'],
    ['working', 'Working'],
    ['quiet', 'Quiet'],
  ] as const)('renders the %s label from bandLabel(), not a literal', (band, literal) => {
    expect(jsxText).toContain(`bandLabel('${band}')`);
    expect(jsxText).not.toContain(`>${literal}<`);
  });

  it('gives every hint a consumer — three strings that render nowhere are not copy, they are dead weight', () => {
    for (const band of ['needs-you', 'working', 'quiet'] as const) {
      expect(jsxText).toContain(`bandHint('${band}')`);
    }
  });
});
