import { describe, expect, it } from 'vitest';
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
