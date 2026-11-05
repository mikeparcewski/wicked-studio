/**
 * Operator on :7721 (2026-11-05): "Repositories page ... is just a giant list of boxes". Two stylesheets styled the
 * same class: the repository marks' `.wk-know` (sections/repo-know.css: a wrapping row of pills, a 5-column tile band)
 * and the Desk Knowledge view's root (sections/knowledge.css: a column). knowledge.css is imported after
 * repo-know.css, so the column won at equal specificity: every repository on /repos stacked its five marks one per
 * line, and a repository's page stacked its band. The Knowledge view's root is `.wk-knowview` now; only the marks
 * style `.wk-know`.
 * @vitest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const STYLES = fileURLToPath(new URL('../src/styles', import.meta.url));
const read = (p: string): string => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : n.endsWith('.css') ? [p] : [];
  });
}

/** The declarations of the first top-level rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const m = new RegExp(`(?:^|\\})\\s*${selector.replace(/\./gu, '\\.')}\\s*\\{([^}]*)\\}`, 'u').exec(css);
  if (m === null) throw new Error(`no rule for ${selector}`);
  return m[1]!.replace(/\s+/gu, ' ').trim();
}

/** The bare class `.wk-know` (not `.wk-know-dot`, `.wk-know--band`, `.wk-knowview`). */
const BARE = /\.wk-know(?![\w-])/u;

describe('the repository marks lay out as a row (no other sheet styles .wk-know)', () => {
  it('only repo-know.css styles the bare .wk-know class', () => {
    const owners = cssFiles(STYLES).filter((f) => BARE.test(read(f))).map((f) => relative(STYLES, f));
    expect(owners).toEqual(['sections/repo-know.css']);
  });

  it('the marks are a wrapping row on /repos and a grid band on a repository page', () => {
    const css = read(join(STYLES, 'sections/repo-know.css'));
    const strip = ruleBody(css, '.wk-know');
    expect(strip).toMatch(/display: flex/u);
    expect(strip).toMatch(/flex-wrap: wrap/u);
    expect(strip).not.toMatch(/flex-direction/u);
    expect(ruleBody(css, '.wk-know--band')).toMatch(/display: grid/u);
  });

  it('the Desk Knowledge view keeps its column under its own root class', () => {
    expect(ruleBody(read(join(STYLES, 'sections/knowledge.css')), '.wk-knowview'))
      .toBe('display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; overflow-wrap: anywhere;');
    const view = readFileSync(fileURLToPath(new URL('../src/components/desk/KnowledgeView.tsx', import.meta.url)), 'utf8');
    expect(view).toContain('<div className="wk-knowview" data-testid="knowledge-view">');
    expect(view).not.toMatch(/className="wk-know"/u);
  });
});
