import { test, expect } from '@playwright/test';
import { SIZES, place, watch, read, waitForMotion, expectStill, setHidden, snaps } from './offscreen-kit';

/**
 * Every interactive on the page stops when nobody can see it, and never moves the page
 * (operator, 2026-11-04: "when interactives are playing the scroll is scrolling back to them").
 *
 * For each one, at 1440x900, 1280x720 and 390x844: it plays on screen; off screen (and, where the
 * page does not snap, peeking in under a quarter at an edge) nothing in it changes or animates for
 * two of its cycles, the page holds still and nothing takes focus; back on screen it plays again.
 * A Pause stays paused when it comes back, a hidden tab holds it, and a job focused in the demo's
 * rail never pulls the page back to the demo when a timer re-renders the rail.
 */

const ITEMS = [
  { name: 'the hero demo', sel: '[data-ide]', cycle: 4000 },
  { name: 'scene a (your ask)', sel: '[data-scene="a"]', cycle: 1600 },
  { name: 'scene b (the gate card)', sel: '[data-scene="b"]', cycle: 1500 },
  { name: 'scene c (your sources)', sel: '[data-scene="c"]', cycle: 1300 },
  { name: 'the sidebar tour', sel: '.explorer[data-tour]', cycle: 4000 },
  { name: 'the review relay', sel: '[data-relay]', cycle: 1000 },
  { name: 'the rule drawer', sel: '[data-drawer="rule"]', cycle: 6000 },
  { name: 'the sandbox hand-off', sel: '.sandbox', cycle: 3200, css: true },
  { name: 'the project search', sel: '[data-search]', cycle: 4200 },
  { name: "the What's new tour", sel: '.news[data-tour]', cycle: 4500 },
  { name: 'the typed command', sel: '[data-typed]', cycle: 1000 },
];

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    for (const it of ITEMS) {
      test(`${it.name} holds off screen and plays again when it is back`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.goto('/');
        await place(page, it.sel, 'on');
        const css = 'css' in it;
        const playing = await waitForMotion(page, it.sel, it.cycle + 2500, css);
        expect(css ? playing.running : playing.mutations, `${it.name} plays on screen`).toBeGreaterThan(0);
        expect(playing.moved, `${it.name}: the page moved while it played`).toBeLessThanOrEqual(1);
        await expectStill(page, it.sel, it.cycle, 'off', it.name);
        if (!(await snaps(page))) await expectStill(page, it.sel, it.cycle, 'edge', it.name);
        await place(page, it.sel, 'on');
        const again = await waitForMotion(page, it.sel, 2 * it.cycle + 1500, css);
        expect(css ? again.running : again.mutations, `${it.name} plays again back on screen`).toBeGreaterThan(0);
        expect(again.moved, `${it.name}: the page moved while it played`).toBeLessThanOrEqual(1);
        expect(again.focusMoved, `${it.name}: focus moved while it played`).toBe(false);
      });
    }

    test('a Pause stays paused when its section comes back on screen', async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto('/');
      const tour = '.explorer[data-tour]';
      await place(page, tour, 'on');
      await waitForMotion(page, tour, 5000);
      await page.locator('#desk [data-play-toggle]').click();
      await place(page, tour, 'off');
      await place(page, tour, 'on');
      await watch(page, tour);
      await page.waitForTimeout(9000);
      const s = await read(page, tour);
      expect(s.mutations, 'a paused tour does not advance back on screen').toBe(0);
      expect(s.running, 'a paused tour does not animate back on screen').toBe(0);
      expect(s.focusMoved).toBe(false);
    });

    test('a hidden tab holds the playing tour; visible again, it plays', async ({ page }) => {
      test.setTimeout(60_000);
      await page.goto('/');
      const tour = '.explorer[data-tour]';
      await place(page, tour, 'on');
      await waitForMotion(page, tour, 5000);
      await setHidden(page, true);
      await watch(page, tour);
      await page.waitForTimeout(9000);
      const s = await read(page, tour);
      expect(s.mutations, 'DOM changes in a hidden tab').toBe(0);
      expect(s.running, 'animations running in a hidden tab').toBe(0);
      await setHidden(page, false);
      const again = await waitForMotion(page, tour, 6000);
      expect(again.mutations, 'the tour plays once the tab is visible').toBeGreaterThan(0);
    });
  });
}

test.describe('the demo rail', () => {
  // a phone scrolls freely, so the page can sit where the rail is out of view and the demo still plays
  test.use({ viewport: { width: 390, height: 844 } });
  test('a focused job in the rail never pulls the page back when a timer re-renders the rail', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    const tab = page.locator('[data-ide] .ide-sess').first();
    await tab.focus();
    // the rail just above the window; the rest of the demo (well over a quarter of it) still on screen
    await page.evaluate(() => {
      const t = document.querySelector('[data-ide] .ide-sess') as HTMLElement;
      window.scrollTo({ top: Math.round(t.getBoundingClientRect().bottom + window.scrollY + 24), behavior: 'instant' as ScrollBehavior });
    });
    await page.waitForTimeout(400);
    const share = await page.evaluate(() => {
      const r = (document.querySelector('[data-ide]') as HTMLElement).getBoundingClientRect();
      return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / innerHeight;
    });
    expect(share, 'the demo is still live').toBeGreaterThan(0.3);
    await watch(page, '[data-ide]');
    // the background job's two steps (4 s apart) and the prompt's own run re-render the rail
    await page.waitForTimeout(9000);
    const s = await read(page, '[data-ide]');
    expect(s.mutations, 'the demo played meanwhile').toBeGreaterThan(0);
    expect(s.moved, 'the page moved back to the rail').toBeLessThanOrEqual(1);
  });
});
