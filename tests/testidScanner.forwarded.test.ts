/**
 * The testid scanner reads the whole denominator (COVERAGE.md finding 3, wave 5): ids handed to a
 * component through a testId-like prop are in the DOM, so they are in the inventory; a TS type is
 * never read as a declaration.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanFileText, type TestidInventory } from '../scripts/testid-inventory.mjs';

const values = (text: string, kind: 'static' | 'dynamic' | 'computed'): string[] =>
  scanFileText(text).entries.filter((e) => e.kind === kind).map((e) => e.value);

describe('forwarded ids', () => {
  it('a literal passed through a testId-like prop is static (or dynamic for a template)', () => {
    const src = `<MetricTile testId="stat-repos" /> <Grid testid={'repos-grid'} /> <Sw triggerTestId="project-name" />
      <Row tid={\`row-\${id}\`} /> <X testId={on ? 'a-on' : 'a-off'} />`;
    expect(values(src, 'static')).toStrictEqual(['stat-repos', 'repos-grid', 'project-name', 'a-on', 'a-off']);
    expect(values(src, 'dynamic')).toStrictEqual(['row-*']);
  });

  it('a table key, a typed parameter and a /* testid */ mark are ids too', () => {
    const src = `const A = [{ panel: 'x', testId: 'context-learn', label: 'l' }];
      const line = (row: NeedRow, testId: 'need-row' | 'need-member'): R => r;
      const T = { add: /* testid */ 'diff-line-add' };`;
    expect(values(src, 'static')).toStrictEqual(['context-learn', 'need-row', 'need-member', 'diff-line-add']);
  });

  it('forwarding a variable is not an id; the element that renders it stays computed', () => {
    const src = `<Inner testId={testId} /> <span data-testid={testId} />`;
    expect(values(src, 'static')).toStrictEqual([]);
    expect(values(src, 'computed')).toStrictEqual(['testId']);
  });
});

describe('a type is not a declaration', () => {
  it("`'data-testid': string;` in an interface is skipped (Tech.tsx was read as one huge computed entry)", () => {
    const src = `interface Props {\n  'data-testid': string;\n  parts: readonly Part[];\n}\nexport function Tech({ 'data-testid': testId, parts }: Props) { return <span data-testid={testId} />; }`;
    const computed = values(src, 'computed');
    expect(computed).toStrictEqual(['testId', 'testId']);
  });
});

describe('the committed inventory is the whole denominator', () => {
  const inv = JSON.parse(readFileSync(fileURLToPath(new URL('../testid-inventory.json', import.meta.url)), 'utf8')) as TestidInventory;
  it('carries forwarded ids and no misread type', () => {
    const ids = new Set(inv.static.map((e) => e.testId));
    for (const id of ['stat-repos', 'need-row', 'need-member', 'diff-line-add', 'chat-scope-system', 'context-learn', 'steering-grid-filter']) {
      expect(ids.has(id), id).toBe(true);
    }
    for (const c of inv.computed) expect(c.expression, c.expression.slice(0, 60)).not.toMatch(/;/);
  });
});

describe('codex on the scanner', () => {
  it('any property signature after a data-testid key is a type, not a declaration', () => {
    for (const ty of ['TestId;', 'string | undefined;', "'a' | 'b';", 'string[];', 'Ids.Kind;']) {
      const src = `interface P {\n  'data-testid': ${ty}\n  other: () => void;\n}\n<i data-testid="kept" />`;
      expect(values(src, 'computed'), ty).toStrictEqual([]);
      expect(values(src, 'static'), ty).toStrictEqual(['kept']);
    }
  });

  it('a testId in a comment is not an id', () => {
    const src = `// <Tile testId="from-a-comment" />\n/* testid: 'block-comment' */\n<Tile testId="real" />`;
    expect(values(src, 'static')).toStrictEqual(['real']);
  });
});

describe('comment masking never eats code', () => {
  it('a glob or a URL in a string is not a comment', () => {
    const src = `const g = 'src/**/*.ts'; <Tile testId="after-glob" /> const u = 'https://x.y/z'; <Tile testId="after-url" /> /* end */`;
    expect(values(src, 'static')).toStrictEqual(['after-glob', 'after-url']);
  });
});
