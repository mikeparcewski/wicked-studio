// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('reserves room for the Ask bubble below the Agents panel and setup steps', () => {
  const css = readFileSync(new URL('../src/styles/sections/agents.css', import.meta.url), 'utf8');
  const panel = css.match(/\.wk-agents-panel\s*\{([^}]+)\}/)?.[1];
  expect(panel).toMatch(/padding-bottom:\s*var\(--fab-clear\)/);
});
