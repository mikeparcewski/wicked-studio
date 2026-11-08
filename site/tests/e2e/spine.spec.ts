import { test, expect, type Page } from '@playwright/test';

/**
 * The page's spine, the same as wicked-crew's (ported, site/src/scripts/beats.js): a thread under the
 * topbar with one segment per beat (1024px wide and up) and the beat track in the right gutter (1400px
 * and up, where the gutter holds it), both in studio's plane hue (experience). And What's new: its tab
 * row is one line at every width.
 */
const BEATS: [string, string][] = [
  ['top', 'The ADE'],
  ['why', 'For you'],
  ['desk', 'Desk'],
  ['review', 'Review'],
  ['steer', 'Rules'],
  ['reach', 'Agents'],
];
const HUE = '--plane-experience';

async function goTo(page: Page, id: string) {
  await page.evaluate((id) => document.getElementById(id)!.scrollIntoView({ block: 'start', behavior: 'instant' }), id);
}
/** the computed colour of a token, as the browser resolves it */
async function tokenColour(page: Page, token: string) {
  return page.evaluate((t) => {
    const el = document.createElement('i');
    el.style.color = `var(${t})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, token);
}

test.describe('the thread and the beat track', () => {
  test('1440x700: a segment per beat, the track names the beat in view, in the plane hue', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto('/');
    const thread = page.locator('[data-beat-thread]');
    const track = page.getByRole('navigation', { name: 'The job, beat by beat' });
    await expect(thread.locator('[data-beat-thread-seg]')).toHaveCount(BEATS.length);
    await expect(track.getByRole('link')).toHaveCount(BEATS.length);
    for (const [id, name] of BEATS) {
      await goTo(page, id);
      await expect(track.locator('[aria-current="step"] .beats-l')).toHaveText(name);
      await expect(track).toBeVisible();
      await expect(thread).toHaveClass(/is-on/);
    }
    const hue = await tokenColour(page, HUE);
    await expect(track.locator('[aria-current="step"] .beats-dot')).toHaveCSS('background-color', hue);
    await expect(track.locator('[aria-current="step"] .beats-l')).toHaveCSS('color', hue);
    await expect(thread.locator('[data-beat-thread-seg] b').first()).toHaveCSS('background-color', hue);
    // at the last beat every segment before it is full, and a full segment renders full width
    const fill = () => thread.locator('[data-beat-thread-seg] b').evaluateAll((bs) => bs.map((b) => parseFloat((b as HTMLElement).style.getPropertyValue('--f') || '0')));
    expect((await fill()).slice(0, -1).every((x) => x > 0.99)).toBe(true);
    await expect(thread.locator('[data-beat-thread-seg] b').first()).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await expect(thread).toHaveCSS('opacity', '1');
    // back at the top only the first beat has filled; the later ones are empty and render empty
    await goTo(page, BEATS[0][0]);
    await expect.poll(async () => (await fill()).slice(2).every((x) => x === 0)).toBe(true);
    expect((await fill())[0]).toBeGreaterThan(0.99);
    await expect(thread.locator('[data-beat-thread-seg] b').last()).toHaveCSS('transform', 'matrix(0, 0, 0, 1, 0, 0)');
    // half way to the second beat (snapping off, read before anything settles) its segment is part filled
    const mid = await page.evaluate(async (id) => {
      const st = document.createElement('style');
      st.textContent = 'html, html.snap-lock { scroll-snap-type: none !important; scroll-behavior: auto !important; }';
      document.head.appendChild(st);
      const s = document.getElementById(id)!;
      window.scrollTo({ top: s.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2, behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const f = parseFloat((document.querySelectorAll('[data-beat-thread-seg] b')[1] as HTMLElement).style.getPropertyValue('--f') || '0');
      st.remove();
      return f;
    }, BEATS[1][0]);
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.95);
    // the thread lines up with the topbar's row, under it
    const [tb, row, th] = await page.evaluate(() => [
      document.querySelector('.topbar')!.getBoundingClientRect().bottom,
      (() => { const r = document.querySelector('.topbar__inner')!.getBoundingClientRect(); return [r.left, r.right]; })(),
      (() => { const r = document.querySelector('[data-beat-thread]')!.getBoundingClientRect(); return [r.left, r.right, r.top, r.height]; })(),
    ] as const);
    expect(Math.abs(th[0] - row[0])).toBeLessThan(1.5);
    expect(Math.abs(th[1] - row[1])).toBeLessThan(1.5);
    expect(Math.abs(th[2] - tb)).toBeLessThan(1.5);
    expect(th[3]).toBe(3);
  });

  test('1920x1080: the thread widens to 1400px like crew\'s, and the track shows', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await goTo(page, 'desk');
    // centred like the topbar (both are fixed to the same box; a classic scrollbar takes its width off the window)
    const [l, r, bl, br] = await page.evaluate(() => {
      const t = document.querySelector('[data-beat-thread]')!.getBoundingClientRect(), b = document.querySelector('.topbar')!.getBoundingClientRect();
      return [t.left, t.right, b.left, b.right];
    });
    expect(r - l).toBe(1400);
    expect(Math.abs((l + r) / 2 - (bl + br) / 2)).toBeLessThan(1);
    await expect(page.locator('[data-beats]')).toBeVisible();
  });

  test('each beat is named from its own frame: the name is in that frame\'s kicker or heading', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const names = await page.locator('[data-beats] .beats-l').evaluateAll((ls) => ls.map((l) => l.textContent || ''));
    const firsts = BEATS.filter(([id, n], i) => BEATS.findIndex(([, m]) => m === n) === i);
    expect(names).toEqual(firsts.map(([, n]) => n));
    for (const [id, name] of firsts) {
      const head = await page.evaluate((id) => {
        const s = document.getElementById(id)!;
        const sh = s.querySelector('.scene-head');
        if (sh) return sh.textContent || '';
        const k = s.querySelector('.kicker, [class*="kicker"]'), h = s.querySelector('h1, h2');
        return [k, h].filter(Boolean).map((e) => (e as HTMLElement).textContent).join(' ');
      }, id);
      expect(head.toLowerCase(), `#${id}'s own kicker or heading names "${name}"`).toContain(name.replace(/^the /i, '').toLowerCase());
    }
  });

  test('a beat on the track is a link to its frame; hover and keyboard focus show its name', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto('/');
    await goTo(page, 'why');
    const track = page.getByRole('navigation', { name: 'The job, beat by beat' });
    const review = track.getByRole('link', { name: /^Review\b.*beat 4 of 6/ });
    await expect(review.locator('.beats-l')).toHaveCSS('opacity', '0');
    await review.hover();
    await expect(review.locator('.beats-l')).toHaveCSS('opacity', '1');
    await page.mouse.move(10, 400);
    await expect(review.locator('.beats-l')).toHaveCSS('opacity', '0');
    // keyboard: Tab from the beat before it focuses it and shows its name
    await track.getByRole('link', { name: /^Desk\b/ }).focus();
    await page.keyboard.press('Tab');
    await expect(review).toBeFocused();
    await expect(review.locator('.beats-l')).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#review$/);
    await expect(track.locator('[aria-current="step"] .beats-l')).toHaveText('Review');
    const top = await page.evaluate(() => document.getElementById('review')!.getBoundingClientRect().top);
    expect(Math.abs(top - 64)).toBeLessThan(2);
  });

  test('1440x900 shows the track (the frames stay in the family grid, as on crew); below 1400 / 1024 it and the thread hide', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await goTo(page, 'desk');
    await expect(page.locator('[data-beat-thread]')).toHaveClass(/is-on/);
    await expect(page.locator('[data-beats]')).toBeVisible();
    // the frame's content keeps crew's box: the lockup and the content's left edge at x=128
    const [lock, wrapL] = await page.evaluate(() => [
      Math.round(document.querySelector('.topbar__inner')!.getBoundingClientRect().left + 28),
      Math.round((() => { const w = document.querySelector('#desk > .wrap')!; const r = w.getBoundingClientRect(); return r.left + parseFloat(getComputedStyle(w).paddingLeft) * (r.width / (w as HTMLElement).offsetWidth); })()),
    ]);
    expect([lock, wrapL]).toEqual([128, 128]);
    await page.setViewportSize({ width: 1366, height: 768 });
    await goTo(page, 'desk');
    await expect(page.locator('[data-beat-thread]')).toBeVisible();
    await expect(page.locator('[data-beats]')).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
    // past the last beat the thread fades out
    await goTo(page, 'new');
    await expect(page.locator('[data-beat-thread]')).toHaveCSS('opacity', '0');
    await page.setViewportSize({ width: 1024, height: 768 });
    await goTo(page, 'desk');
    await expect(page.locator('[data-beat-thread]')).toBeVisible();
    await expect(page.locator('[data-beats]')).toBeHidden();
    await page.setViewportSize({ width: 768, height: 1024 });
    await goTo(page, 'desk');
    await expect(page.locator('[data-beat-thread]')).toBeHidden();
    await expect(page.locator('[data-beats]')).toBeHidden();
  });
});

test.describe("What's new: the tab row is one line", () => {
  for (const w of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    test(`at ${w}px wide`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w <= 768 ? 844 : 800 });
      await page.goto('/');
      await goTo(page, 'new');
      const row = page.locator('.news-tabs');
      const tabs = row.getByRole('tab');
      await expect(tabs).toHaveCount(8);
      const tops = await tabs.evaluateAll((ts) => ts.map((t) => Math.round(t.getBoundingClientRect().top)));
      expect(new Set(tops).size, `tab tops ${tops.join(',')}`).toBe(1);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sideways).toBe(0);
      // where the row is wider than its column it scrolls sideways (only the row), and a fade marks the side with more
      const over = await row.evaluate((r) => r.scrollWidth - r.clientWidth);
      if (w >= 1024) expect(over, 'every tab shows on a desktop window').toBeLessThanOrEqual(1);
      const mask = () => row.evaluate((r) => { const cs = getComputedStyle(r); return cs.maskImage || cs.getPropertyValue('-webkit-mask-image'); });
      if (over <= 1) expect(await mask()).not.toContain('44px');
      if (over > 1) {
        await expect(row).toHaveAttribute('data-more-r', '');
        expect(await mask(), 'the right edge fades').toMatch(/calc\(100% - 44px\)/);
        const y = await page.evaluate(() => window.scrollY);
        await row.evaluate((r) => r.scrollTo({ left: r.scrollWidth, behavior: 'instant' }));
        await expect(row).toHaveAttribute('data-more-l', '');
        await expect(row).not.toHaveAttribute('data-more-r', '');
        expect(await mask(), 'the left edge fades').toMatch(/rgb\(0, 0, 0\) 44px/);
        expect(await page.evaluate(() => window.scrollY)).toBe(y);
      }
    });
  }

  /** the shown tab sits clear of whichever edge fades are on (44px) */
  async function clearOfFades(page: Page) {
    return page.locator('.news-tabs').evaluate((r) => {
      const t = r.querySelector('[aria-selected="true"]')!.getBoundingClientRect(), b = r.getBoundingClientRect();
      const l = r.hasAttribute('data-more-l') ? 44 : 0, rt = r.hasAttribute('data-more-r') ? 44 : 0;
      return t.left >= b.left + l - 1 && t.right <= b.right - rt + 1;
    });
  }

  test('390px: the keys walk the tabs; the shown one scrolls clear of the fades, only the row moves', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await goTo(page, 'new');
    const row = page.locator('.news-tabs');
    await row.getByRole('tab', { name: 'Documents' }).click();
    const y = await page.evaluate(() => window.scrollY);
    for (const name of ['Sources', 'Reports', 'Review', 'Publish', 'Plugins']) {
      await page.keyboard.press('ArrowRight');
      await expect(row.getByRole('tab', { name })).toBeFocused();
      await expect.poll(() => clearOfFades(page), { message: `${name} clear of the fades` }).toBe(true);
    }
    await page.keyboard.press('End');
    await expect(row.getByRole('tab', { name: 'Demo video' })).toBeFocused();
    await expect.poll(() => clearOfFades(page)).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
  });

  test('the tour advances on its own without moving the page or taking focus', async ({ page }) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await goTo(page, 'new');
    await page.mouse.move(2, 2);
    const y = await page.evaluate(() => window.scrollY);
    const before = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    const shown = () => page.locator('.news-tabs [aria-selected="true"]').innerText();
    await expect.poll(shown, { timeout: 12_000 }).toBe('Sources');
    await expect.poll(shown, { timeout: 12_000 }).toBe('Reports');
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).toBe(before);
    await expect.poll(() => clearOfFades(page)).toBe(true);
  });

  test('after a resize the shown tab is still clear of the fades, though the tour is paused', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/');
    await goTo(page, 'new');
    await page.locator('.news-tabs').getByRole('tab', { name: 'Demo video' }).click();
    await page.setViewportSize({ width: 800, height: 800 });
    await expect(page.locator('.news-tabs')).toHaveAttribute('data-more-l', '');
    await expect.poll(() => clearOfFades(page)).toBe(true);
  });
});
