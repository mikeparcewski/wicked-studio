/**
 * Understand's repository chips (crew#1157): a CHOSEN chip must not look like a hovered one. Live on :7721
 * (wicked-dark) the chosen fill was the hover fill, so the default pick could not be told apart. Chosen is
 * a stronger ink fill than hover, semibold, with a check before the name.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/sections/calm-ue.css', import.meta.url)), 'utf8');
const rule = (selector: string): string => {
  const i = css.indexOf(`${selector} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};

describe('Understand scope chips: chosen is not hover', () => {
  it('chosen has its own fill (the press step, not the hover step), semibold words and a check', () => {
    const chosen = rule('.wk-ue .wk-ue-chip--pick[aria-pressed="true"]');
    expect(chosen).toContain('var(--ue-press)');
    expect(chosen).toContain('var(--weight-semi)');
    expect(rule('.wk-ue .wk-ue-chip--pick[aria-pressed="true"]::before')).toContain('content: "\\2713"');
    expect(rule('.wk-ue-chip:hover')).not.toContain('var(--ue-press)');
  });
});
