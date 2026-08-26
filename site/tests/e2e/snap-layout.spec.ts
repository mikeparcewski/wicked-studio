import { test, expect } from '@playwright/test';

/**
 * Regression guard for two defects that shipped together on this page.
 *
 * 1. SKIPPED SECTIONS. `studio.css` gives snap points via a hardcoded selector list
 *    (`.hero, .board, .proj, .work, .ctx, .pair, .get`). A section added to index.astro but not
 *    to that list gets `scroll-snap-align: none`, and the browser scrolls straight past it. That
 *    is what happened to `.work` and `.ctx`, and it reads to a user as "the snap skips sections".
 *
 * 2. UNREACHABLE CONTENT. The page used to set `scroll-snap-type: y mandatory`, overriding the
 *    shared chrome's `y proximity` (wicked-web tokens.css). Mandatory snapping pulls the viewport
 *    to the next snap point before you can scroll through a section that is taller than the
 *    viewport, so the overflow of any tall section is simply unreachable.
 *
 * These assert behaviour, not pixel values, so ordinary copy edits do not trip them.
 */

const LAPTOP = { width: 1440, height: 700 };

test.describe('scroll-snap layout', () => {
  test('every section on the page has a snap point', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/');

    const noSnap = await page.$$eval('section', (sections) =>
      sections
        .filter((s) => getComputedStyle(s).scrollSnapAlign.split(' ')[0] === 'none')
        .map((s) => s.className.split(' ')[0] || s.tagName),
    );

    expect(
      noSnap,
      `These sections have no snap point, so mandatory/proximity scrolling passes over them. ` +
        `Add them to the section selector list in src/styles/studio.css.`,
    ).toEqual([]);
  });

  test('snapping is proximity, so tall sections stay scrollable', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/');

    // The hero embeds a live console and is legitimately taller than a laptop viewport. Under
    // `mandatory` its lower half cannot be reached; under `proximity` it can.
    const snapType = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollSnapType,
    );
    expect(snapType).not.toContain('mandatory');
  });

  test('scrolling top to bottom reaches every section', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/');
    await page.waitForTimeout(300);

    const all = await page.$$eval('section', (ns) => ns.map((n) => n.className.split(' ')[0]));
    const seen = new Set<string>();

    const sweep = async () => {
      const vis = await page.evaluate((vh) => {
        const out: string[] = [];
        document.querySelectorAll('section').forEach((s) => {
          const r = s.getBoundingClientRect();
          const shown = Math.min(r.bottom, vh) - Math.max(r.top, 0);
          if (shown / Math.min(r.height, vh) >= 0.6) out.push(s.className.split(' ')[0]);
        });
        return out;
      }, LAPTOP.height);
      vis.forEach((v) => seen.add(v));
    };

    for (let i = 0; i < 40; i++) {
      await sweep();
      const atEnd = await page.evaluate((step) => {
        window.scrollBy(0, step);
        return window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
      }, Math.round(LAPTOP.height * 0.85));
      await page.waitForTimeout(100);
      if (atEnd) break;
    }
    await sweep();

    expect(all.filter((n) => !seen.has(n)), 'sections never became substantially visible').toEqual(
      [],
    );
  });

  test('wheel scrolling can come to rest on every section', async ({ page }) => {
    // The strongest reproduction of the reported symptom -- "I can't stop on the section at all".
    // scrollBy() moves the scroll position without producing a wheel event, so it walks the page
    // even when snapping is actively fighting the user. Real wheel events do not: against the
    // deployed build this sequence settled on hero -> board -> proj and could not rest anywhere
    // past it, because .work had no snap point and `mandatory` had nowhere to put the viewport.
    await page.setViewportSize(LAPTOP);
    await page.goto('/');
    await page.waitForTimeout(500);

    const restedOn: string[] = [];
    for (let i = 0; i < 45; i++) {
      await page.mouse.wheel(0, 320);
      await page.waitForTimeout(240); // let the snap settle before sampling
      const top = await page.evaluate((vh) => {
        let best = '';
        let cover = 0;
        document.querySelectorAll('section').forEach((s) => {
          const r = s.getBoundingClientRect();
          const shown = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
          if (shown > cover) {
            cover = shown;
            best = s.className.split(' ')[0];
          }
        });
        return best;
      }, LAPTOP.height);
      if (restedOn[restedOn.length - 1] !== top) restedOn.push(top);
      const atEnd = await page.evaluate(
        () => window.scrollY + window.innerHeight >= document.body.scrollHeight - 2,
      );
      if (atEnd) break;
    }

    for (const section of ['work', 'ctx']) {
      expect(
        restedOn,
        `wheel scrolling never came to rest on .${section} — it was scrolled past`,
      ).toContain(section);
    }
  });

  test('the page never scrolls sideways', async ({ page }) => {
    for (const vp of [LAPTOP, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      await page.goto('/');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${vp.width}x${vp.height}`).toBeLessThanOrEqual(1);
    }
  });
});
