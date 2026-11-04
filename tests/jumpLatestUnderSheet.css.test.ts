/**
 * The B5 rig shot (gate-data-use-dark-390): on a phone, with the decision sheet unfolded, the thread keeps almost no
 * room, so its jump-to-latest button (absolutely placed at the thread's foot) floated over the job's title. Unfolded,
 * the sheet hides it; folded, or with a dock that drew nothing, the button stays.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/sections/decision-dock.css', import.meta.url)), 'utf8');

/** The body of the `@media (max-width: 640px)` block that holds the phone sheet's rules. */
function phoneBlock(): string {
  const at = css.indexOf('@media (max-width: 640px) {');
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i);
  }
  throw new Error('unclosed @media block');
}

describe("the phone sheet and the thread's jump-to-latest button", () => {
  it('an unfolded sheet that drew its decision hides the button; a folded one does not', () => {
    const block = phoneBlock();
    const rule = /\.wk-session:has\(\.wk-dock\[data-collapsed="false"\] \.wk-dock-slot:not\(:empty\)\) \.wk-jump-latest\s*\{\s*display:\s*none;\s*\}/u;
    expect(block).toMatch(rule);
    // Only on a phone: the desk's dock sits under a thread that keeps its room.
    expect(css.replace(block, '')).not.toMatch(/\.wk-jump-latest/u);
    expect(block).not.toMatch(/data-collapsed="true"\][^{]*\.wk-jump-latest/u);
  });
});
