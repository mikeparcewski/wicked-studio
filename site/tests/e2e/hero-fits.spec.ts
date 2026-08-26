import { test, expect } from '@playwright/test';

/**
 * The hero has to fit a laptop screen.
 *
 * WHAT WAS WRONG. Measured on the deployed build at 1440x700 the `.hero` section rendered 970px
 * idle and 999px once the steering gate raised — 270 to 299px past the bottom of the window. The
 * page pairs a fixed 64px topbar with `scroll-snap-align: start`, so the hero is pinned at y=64
 * and everything past y=700 is simply not on screen. What fell off the bottom was the whole
 * bottom half of the console: the Approve / Approve with steer / Reject buttons, the terminal
 * line, and the insight rail. The section's entire argument — "Below is not a mock —
 * it IS the interface" — was below the fold, and the copy above it was making a promise the
 * viewport never delivered on.
 *
 * These tests assert against the VIEWPORT, not against fixed pixel counts, so ordinary copy edits
 * do not trip them — only edits that push the section back off the screen do.
 *
 * WHY 1440x700 AND NOT 1440x900. 900 is taller than the usable height of a real laptop window
 * once browser chrome is accounted for. At 900 this defect measured as "fits" and shipped.
 */

const LAPTOP = { width: 1440, height: 700 };
const LAPTOP_TALL = { width: 1440, height: 760 };

/** Wait for the console's scroll-in auto-play to reach the gate. No scrolling: these assertions
 *  are about what is on screen when the page loads, so moving the viewport would void them. */
async function gateRaised(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-console-gate]:not([hidden])', { timeout: 20_000 });
  await page.waitForTimeout(150);
}

for (const vp of [LAPTOP, LAPTOP_TALL]) {
  // The topbar is position:fixed and overlays the page, so the height a section actually gets is
  // the viewport MINUS the topbar -- which is exactly what the sections are sized to
  // (min-height: calc(100svh - var(--topbar-h))). Comparing against the raw viewport height is
  // therefore ~64px too generous: a section could clear it and still sit partly under the bar.
  // Measure the bar rather than hardcoding 64px, so a token change cannot silently loosen this.
  const usableHeight = async (page: import('@playwright/test').Page) =>
    vp.height -
    (await page.evaluate(() => {
      const bar = document.querySelector('.topbar, header[class*="topbar"]');
      return bar ? Math.round(bar.getBoundingClientRect().height) : 0;
    }));

  test.describe(`hero at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('the hero fits the viewport before and after the gate raises', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      const heroH = () =>
        page.evaluate(() => Math.round(document.querySelector('.hero')!.getBoundingClientRect().height));

      const idle = await heroH();
      const usable = await usableHeight(page);
      expect(idle, `.hero is ${idle}px in ${usable}px of usable height before the gate raises`).toBeLessThanOrEqual(usable);

      await gateRaised(page);
      const raised = await heroH();
      expect(raised, `.hero grows to ${raised}px, past ${usable}px of usable height, once the steering gate raises`).toBeLessThanOrEqual(usable);
    });

    test('the steering decision is on screen without scrolling', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      await gateRaised(page);

      // The page has not been scrolled, so every one of these must sit inside the window.
      for (const action of ['approve', 'steer', 'reject']) {
        const bottom = await page.locator(`[data-cg-action="${action}"]`).evaluate(
          (el) => el.getBoundingClientRect().bottom,
        );
        expect(
          Math.round(bottom),
          `the "${action}" control ends ${Math.round(bottom)}px down a ${vp.height}px window — below the fold`,
        ).toBeLessThanOrEqual(vp.height);  // absolute page position, so the raw viewport is right here
      }

      // The tag row is the last thing in the section now that the hero CTAs are gone; if it is
      // on screen, the whole hero is. (It used to be .hero-cta -- "Get it" / "See the seam" --
      // which was removed: the page already ends on a Get it section, and the topbar carries the
      // links, so the hero was spending its last 43px repeating navigation.)
      const footBottom = await page
        .locator('.hero-tags')
        .evaluate((el) => el.getBoundingClientRect().bottom);
      expect(Math.round(footBottom), 'the hero foot is below the fold').toBeLessThanOrEqual(vp.height);  // absolute position
    });

    test('the hero has content headroom, not just a passing rendered height', async ({ page }) => {
      // The rendered height of .hero is CLAMPED by min-height: calc(100svh - var(--topbar-h)),
      // so it reports exactly the usable height right up until the content outgrows it -- at
      // which point it jumps past in one step. Measuring the rendered box therefore reads
      // "fits, 0px to spare" both when there is room and when there is none.
      //
      // That is not academic: CI (Linux) renders this page's webfonts about 6px taller than
      // macOS. A hero tuned to exactly the usable height passed locally and failed on CI with
      // ".hero is 642px in 636px of usable height". Measure the CONTENT and require slack.
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);

      const { content, usable } = await page.evaluate((vh) => {
        const hero = document.querySelector('.hero') as HTMLElement;
        const bar = document.querySelector('.topbar, header[class*="topbar"]');
        const st = getComputedStyle(hero);
        let total = parseFloat(st.paddingTop) + parseFloat(st.paddingBottom);
        Array.from(hero.children).forEach((c) => {
          const el = c as HTMLElement;
          if (el.classList.contains('amber-floor')) return; // absolutely positioned decoration
          const cs = getComputedStyle(el);
          total +=
            el.getBoundingClientRect().height +
            parseFloat(cs.marginTop) +
            parseFloat(cs.marginBottom);
        });
        return {
          content: Math.round(total),
          usable: vh - (bar ? Math.round(bar.getBoundingClientRect().height) : 0),
        };
      }, vp.height);

      // This runs on BOTH platforms, and CI's Linux runner renders this page ~24px taller than
      // macOS (measured: 583px of content locally vs 607px on CI, same commit). So the bar has to
      // be one that the TALLER platform clears: 20px of real slack, which is 53 locally and 29 on
      // CI. It was briefly 30, which failed CI by a single pixel on a hero that genuinely fits.
      const MIN_SLACK = 20;
      expect(
        usable - content,
        `.hero content is ${content}px in ${usable}px of usable height — only ` +
          `${usable - content}px of slack, and CI's Linux runner renders this page ~24px taller`,
      ).toBeGreaterThanOrEqual(MIN_SLACK);
    });

    test('the platform band fits the viewport', async ({ page }) => {
      // Shared chrome (wicked-web SameGarden). It rendered 1115px before the band was rebuilt;
      // a site that has not re-pinned the chrome commit will fail here.
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      const h = await page.evaluate(() =>
        Math.round(document.querySelector('.same-garden')!.getBoundingClientRect().height),
      );
      const usable = await usableHeight(page);
      expect(h, `.same-garden is ${h}px in ${usable}px of usable height`).toBeLessThanOrEqual(usable);
    });
  });
}

test.describe('the gate can never hide its own controls', () => {
  test.use({ viewport: LAPTOP });

  /**
   * Guard on the FIX rather than a reproduction of the original defect: the height came partly
   * out of `.console-feed`'s clamp, and that clamp sets the floor for the row the gate shares
   * with the feed. Clamp it below the gate's own content and the Approve/Reject buttons end up
   * inside an overflow scroller — invisible, and still "fitting" every height assertion above.
   */
  test('the gate is never an overflow scroller, in either of its states', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-console-gate]:not([hidden])', { timeout: 20_000 });

    const hidden = () =>
      page.locator('[data-console-gate]').evaluate((el) => el.scrollHeight - el.clientHeight);

    expect(await hidden(), 'the raised gate clips its own content').toBeLessThanOrEqual(1);

    await page.locator('[data-cg-action="steer"]').click();
    await page.waitForSelector('.cg-amend input');
    expect(await hidden(), 'the gate clips its content once the amendment opens').toBeLessThanOrEqual(1);
    await expect(page.locator('.cg-amend button')).toBeInViewport();
  });
});
