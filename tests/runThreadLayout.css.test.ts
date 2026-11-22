/**
 * The run thread's layout at 1440x700 (rig shots, crew 0.17.0 / studio 0.15.0):
 *  - studio#846: a step's "Commands run" table broke its "Exit" header mid-word ("Exi" / "t"), because `.wk-chat-md`
 *    sets `overflow-wrap: anywhere` and the table cells inherited it.
 *  - studio#985: the jump-to-latest button, centred at the thread's foot, covered the reading column's words and chips.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/sections/chat-native.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
const MD = ':is(.wk-chat-md, .wk-session-turn--helper .wk-session-text)';
const rule = (selector: string, within = css): string | null => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'u').exec(within)?.[1] ?? null;
};
/** The bodies of every `@media <query> {` block, joined. */
function media(query: string): string {
  const out: string[] = [];
  for (let at = css.indexOf(`@media ${query} {`); at > -1; at = css.indexOf(`@media ${query} {`, at + 1)) {
    let depth = 0;
    const open = css.indexOf('{', at);
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}' && --depth === 0) { out.push(css.slice(open + 1, i)); break; }
    }
  }
  expect(out.length, `@media ${query}`).toBeGreaterThan(0);
  return out.join('\n');
}

describe('a markdown table in the thread keeps its words whole (studio#846)', () => {
  it('headers stay on one line and never break inside a word', () => {
    const th = rule(`${MD} th`);
    expect(th).not.toBeNull();
    expect(th).toMatch(/white-space:\s*nowrap/u);
    expect(th).toMatch(/overflow-wrap:\s*normal/u);
  });
  it('cells break between words (break-word keeps the column minimum); code in a cell may still break anywhere', () => {
    expect(rule(`${MD} td`)).toMatch(/overflow-wrap:\s*break-word/u);
    expect(rule(`${MD} td code`)).toMatch(/overflow-wrap:\s*anywhere/u);
  });
});

describe('the jump-to-latest button never covers the reading column (studio#985)', () => {
  it('outside a phone it leaves the centre for the right gutter, centred in the thread padding, 36 px wide', () => {
    const desk = rule('.wk-jump-latest', media('(min-width: 768px)'));
    expect(desk).not.toBeNull();
    expect(desk).toMatch(/left:\s*auto/u);
    expect(desk).toMatch(/transform:\s*none/u);
    expect(desk).toMatch(/width:\s*36px/u);
    // The same gutter the thread's padding uses (.wk-measure--thread: --page-pad = --space-12, --measure-max = --thread-max).
    expect(desk).toMatch(/right:\s*calc\(\(max\(var\(--space-12\), \(100% - var\(--thread-max\)\) \/ 2 \+ var\(--space-12\)\) - 36px\) \/ 2\)/u);
    const layout = readFileSync(fileURLToPath(new URL('../src/styles/sections/layout.css', import.meta.url)), 'utf8');
    expect(layout).toMatch(/\.wk-measure--thread \{ --measure-max: var\(--thread-max\); --page-pad: var\(--space-12\); \}/u);
    expect(layout).toMatch(/padding-inline: max\(var\(--page-pad\), calc\(\(100% - var\(--measure-max\)\) \/ 2 \+ var\(--page-pad\)\)\)/u);
  });
  it('a phone keeps the centred button (its gutter is 16 px)', () => {
    expect(rule('.wk-jump-latest')).toMatch(/left:\s*50%/u);
    expect(media('(max-width: 767px)')).not.toMatch(/\.wk-jump-latest\s*\{[^}]*left:\s*auto/u);
  });
});
