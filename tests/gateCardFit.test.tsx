/**
 * The gate card at 1440x700 and 390 wide:
 *  - studio#1021: the dock surface scrolls inside itself (60vh) under a sticky go-row; a five-choice gate left its last
 *    tile (Stop) and the "If you choose this" line under the row with no sign there was more.
 *  - studio#1112: an inactive seat's row ("Reassign to codex — inactive: quota exceeded: ...") ran off the card at 390,
 *    because a .wk-btn keeps to one line.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DecisionDockFrame } from '../src/components/session/DecisionDock.js';

afterEach(cleanup);
const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
const body = (css: string, selector: string): string | null => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1] ?? null;
};
const ITEM = { key: 'r1', who: 'Pi', since: null, question: 'Redo the QE check?', tone: 'waiting' as const };
const frames = (): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
/** jsdom has no layout: the surface's scroll geometry, set by hand. */
function geometry(el: HTMLElement, g: { scrollHeight: number; clientHeight: number; scrollTop: number }): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => g.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => g.clientHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => g.scrollTop, set: (v: number) => { g.scrollTop = v; } });
}

describe('the dock says when its card goes on under the sticky row (studio#1021)', () => {
  it('more below: data-more; scrolled to the end: none; a surface that fits: none', async () => {
    render(<DecisionDockFrame items={[ITEM]}><div /></DecisionDockFrame>);
    const surface = screen.getByTestId('decision-dock-surface');
    const g = { scrollHeight: 604, clientHeight: 420, scrollTop: 0 };
    geometry(surface, g);
    surface.dispatchEvent(new Event('scroll'));
    await frames();
    expect(surface.dataset['more']).toBe('below');
    g.scrollTop = 184;
    surface.dispatchEvent(new Event('scroll'));
    await frames();
    expect(surface.dataset['more']).toBeUndefined();
    g.scrollTop = 120;
    surface.dispatchEvent(new Event('scroll'));
    await frames();
    expect(surface.dataset['more']).toBe('below');
    g.scrollHeight = 300; g.clientHeight = 300; g.scrollTop = 0;
    surface.dispatchEvent(new Event('scroll'));
    await frames();
    expect(surface.dataset['more']).toBeUndefined();
  });

  it('the row draws a fade and "More below" while there is more, hidden from assistive tech; key moves clear the row', () => {
    const css = read('src/styles/sections/ask-card.css');
    const cue = body(css, '.wk-dock-surface[data-more="below"] .wk-ask--bare .wk-ask-go::before');
    expect(cue).not.toBeNull();
    expect(cue).toMatch(/content: "More below \\2193" \/ "";/u);
    expect(cue).toMatch(/bottom: 100%/u);
    expect(cue).toMatch(/linear-gradient\(to bottom, transparent, var\(--surface-raised\)/u);
    expect(cue).toMatch(/pointer-events: none/u);
    // The row it sits on is the sticky one; a card scrolled to by key stops above it.
    expect(body(css, '.wk-dock-surface .wk-ask--bare .wk-ask-go')).toMatch(/position: sticky; bottom: 0;/u);
    expect(body(css, '.wk-dock-surface:has(.wk-ask--bare .wk-ask-go)')).toMatch(/scroll-padding-bottom: \d+px/u);
  });
});

describe("an inactive seat's row wraps inside the card (studio#1112)", () => {
  it('its buttons may shrink and wrap (a .wk-btn is nowrap everywhere else)', () => {
    const css = read('src/styles/components.css');
    expect(body(css, '.wk-btn')).toMatch(/white-space: nowrap/u);
    const row = body(css, '.wk-gate-withheld .wk-btn');
    expect(row).not.toBeNull();
    expect(row).toMatch(/white-space: normal/u);
    expect(row).toMatch(/max-width: 100%/u);
    expect(row).toMatch(/min-width: 0/u);
    expect(row).toMatch(/overflow-wrap: break-word/u);
    expect(body(css, '.wk-gate-withheld')).toMatch(/max-width: 100%/u);
  });
});
