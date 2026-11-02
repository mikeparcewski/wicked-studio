import { test, expect } from '@playwright/test';

/**
 * Regression guard for two defects that shipped together on this page.
 *
 * 1. SKIPPED SECTIONS. `studio.css` gives snap points via a hardcoded selector list
 *    (`.hero, .desk, .review, .steer, .reach, .get`). A section added to index.astro but not
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

/**
 * Wait for scrolling to actually finish rather than sleeping a guessed interval.
 *
 * `scrollend` fires once the scroll position is final AND scroll-snap has settled, which is
 * precisely the state these tests sample. It is the deterministic signal; the timeout below is
 * only a floor for the case where the gesture produces NO scroll at all — which is exactly the
 * wedged-page failure being tested for, so it must not hang there.
 */
async function settled(page: import('@playwright/test').Page, cap = 700) {
  await page.evaluate(
    (ms) =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.removeEventListener('scrollend', finish);
          resolve();
        };
        window.addEventListener('scrollend', finish, { once: true });
        window.setTimeout(finish, ms);
      }),
    cap,
  );
}

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

  test('snapping is mandatory only where every frame fits and the shared band snaps', async ({ page }) => {
    // Mandatory snapping makes anything taller than the viewport unreachable, so studio.css turns it
    // on only in the media where every frame fits (frames.spec.ts) and the shared platform band is
    // itself a snap target (SameGarden.astro). Everywhere else the chrome's proximity applies.
    const snapAt = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      return page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType);
    };
    expect(await snapAt(1440, 700)).toContain('mandatory');
    expect(await snapAt(1280, 660)).toContain('mandatory');
    // the band stops snapping at these sizes, so the page must not be mandatory there
    expect(await snapAt(1280, 640)).not.toContain('mandatory');
    expect(await snapAt(1024, 700)).not.toContain('mandatory');
  });

  test('a touch screen never gets mandatory snapping (its 44px controls make frames taller)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).not.toContain('mandatory');
    await ctx.close();
  });

  test('one wheel notch moves exactly one frame', async ({ page }) => {
    // wicked-web scroll-wheel.js turns a notch into a jump to the next snap point; it reads
    // scroll-margin-top, which is why the frames carry the topbar offset there and not in html
    // scroll-padding-top (with the padding, a notch landed back on the frame it started from).
    await page.setViewportSize(LAPTOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.mouse.move(LAPTOP.width / 2, 40);
    const tops = await page.$$eval('section.frame', (ns) =>
      ns.slice(0, 4).map((n) => Math.round(n.getBoundingClientRect().top + window.scrollY - 64)),
    );
    for (let k = 1; k < tops.length; k++) {
      await page.mouse.wheel(0, 100);
      await settled(page, 1200);
      await page.waitForTimeout(250);
      expect(Math.round(await page.evaluate(() => window.scrollY)), `notch ${k}`).toBe(tops[k]);
    }
  });

  test('on a phone the wheel scrolls natively (the frame stepper is off)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.mouse.move(195, 300);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(700);
    expect(Math.round(await page.evaluate(() => window.scrollY))).toBe(120);
  });

  test('scrolling top to bottom reaches every section', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

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
      await settled(page);
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
    await page.waitForLoadState('networkidle');

    const restedOn: string[] = [];
    for (let i = 0; i < 45; i++) {
      await page.mouse.wheel(0, 320);
      await settled(page); // resolves on `scrollend` — the snap has finished moving
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

    for (const section of ['desk', 'review', 'steer', 'reach']) {
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

test.describe('scroll-snap under reduced motion', () => {
  // wicked-web#31: snapping moves the viewport for you, the motion the preference asks the page to
  // suppress. studio.css re-declares `scroll-snap-type` on html after the chrome's guard, so it
  // carries the guard too; assert at a desktop width, where snapping would otherwise be on.
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('no scroll snapping at desktop width', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType),
    ).toBe('none');
  });
});
