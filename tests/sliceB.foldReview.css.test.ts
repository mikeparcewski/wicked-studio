/**
 * B-2: at a phone width (<= 640 px) the floating chat button (the Ask launcher) must stand down ONLY on
 * the Understand CHAT pane (data-pane="chat") — Knowledge, Coverage and Compare have no composer, so the
 * launcher stays available there. A CSS rule scoped to that pane qualifier.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/sections/desk.css', import.meta.url)), 'utf8');

describe('the phone FAB stands down only on the Understand chat pane', () => {
  it('the <= 640px hide rule requires data-pane="chat"', () => {
    const rule = /@media\s*\(max-width:\s*640px\)\s*\{[^}]*\[data-testid="understand-page"\]\[data-pane="chat"\][^}]*\[data-testid="ask-launcher"\][^}]*display:\s*none[^}]*\}/s;
    expect(css).toMatch(rule);
    // The old unscoped form (understand-page with no pane qualifier on the hide) must be gone.
    expect(css).not.toMatch(/\[data-testid="understand-page"\]\s+\[data-testid="ask-launcher"\]/);
  });
});
