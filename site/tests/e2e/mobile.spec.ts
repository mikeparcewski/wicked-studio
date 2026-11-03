import { test, expect, devices } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * Phones (390x844): the demo is the same working demo, stacked. Jobs become a row of tabs, the
 * chat keeps its height, the side panel drops below it, and the page never scrolls sideways.
 */
// iPhone 12 geometry/UA only — the full descriptor carries
// defaultBrowserType: 'webkit', which would switch away from the cached Chromium.
const iphone12 = devices['iPhone 12'];
test.use({
  viewport: iphone12.viewport,
  userAgent: iphone12.userAgent,
  deviceScaleFactor: iphone12.deviceScaleFactor,
  isMobile: iphone12.isMobile,
  hasTouch: iphone12.hasTouch,
});

test.describe('mobile (390×844)', () => {
  test('the demo works on a phone', async ({ page }) => {
    await page.goto('/');
    const ide = page.locator('[data-ide]');
    await bringIntoView(ide);
    await expect(ide).toBeVisible();
    await ide.getByRole('button', { name: 'Approve plan' }).click({ timeout: 10_000 });
    await ide.getByRole('button', { name: 'Send back' }).click({ timeout: 10_000 });
    await expect(ide.locator('.msg--done')).toContainText('Pull request #12 is open.', { timeout: 15_000 });
    await expect(ide.locator('.ide-pane')).toBeVisible();
    await expect(ide.locator('.files .file')).toHaveCount(3);
  });

  test('no horizontal overflow anywhere on the page', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the proof sections and the four-plane map render on a phone', async ({ page }) => {
    await page.goto('/');
    for (const sel of ['.why .trio', '.desk .explorer', '.receipt', '.steer .trio', '.hits', '.new .news', '.install--primary']) {
      const loc = page.locator(sel);
      await bringIntoView(loc);
      await expect(loc).toBeVisible();
    }
    const map = page.locator('.same-garden');
    await bringIntoView(map);
    await expect(map.locator('.sg-plane')).toHaveCount(4);
    await expect(map.locator('.sg-card--here')).toBeVisible();
  });

  test('driving the demo never changes the page height (the panel has a fixed height)', async ({ page }) => {
    // The side panel used to be max-height:300px in an auto-height body, so every tap grew or shrank
    // the hero by up to 170px and pushed every section below it.
    await page.goto('/');
    const ide = page.locator('[data-ide]');
    await bringIntoView(ide);
    const heroH = () => page.locator('.hero').evaluate((el) => Math.round(el.getBoundingClientRect().height));
    await ide.getByRole('button', { name: 'Approve plan' }).waitFor({ timeout: 10_000 });
    const h0 = await heroH();
    await ide.getByRole('button', { name: 'Approve plan' }).click();
    await expect(ide.getByRole('button', { name: 'Send back' })).toBeVisible({ timeout: 10_000 });
    expect(await heroH()).toBe(h0);
    await ide.getByRole('tab', { name: 'Receipt' }).click();
    expect(await heroH()).toBe(h0);
    await ide.getByRole('tab', { name: /Changes/ }).click();
    await ide.locator('.files .file').nth(2).click();
    expect(await heroH()).toBe(h0);
    await ide.locator('[data-id="flaky"]').click();
    expect(await heroH()).toBe(h0);
  });

  test('the jobs are a three-way switcher and every demo control is a 44px target', async ({ page }) => {
    await page.goto('/');
    const ide = page.locator('[data-ide]');
    await bringIntoView(ide);
    await ide.getByRole('button', { name: 'Approve plan' }).waitFor({ timeout: 10_000 });
    const tabs = ide.locator('.ide-sess');
    await expect(tabs).toHaveCount(3);
    // the short titles are what shows; the full title and status are the tabs' names
    await expect(ide.getByRole('tab', { name: /^Fix the flaky checkout test, Waiting on you$/ })).toBeVisible();
    // the Node 22 job runs to done in the background
    await expect(ide.getByRole('tab', { name: /^Move CI to Node 22, (Done|GitHub Copilot working)$/ })).toBeVisible();
    for (let k = 0; k < 3; k++) await expect(tabs.nth(k)).toBeInViewport();
    const short = await ide.locator('button, input, [role=tab]').evaluateAll((els) =>
      els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; })
        .map((e) => (e.textContent || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().height)),
    );
    expect(short).toEqual([]);
  });

  test('a tap that pins a tour or pauses a frame never changes the page height', async ({ page }) => {
    // Pause and Play were different widths, so the heading beside the button rewrapped on a tap and
    // the tablist jumped 25px under the finger (critic, 390x844).
    await page.goto('/');
    const desk = page.locator('#desk');
    await page.locator('#ex-tab-agents').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const d0 = await desk.evaluate((el) => (el as HTMLElement).offsetHeight);
    const doc0 = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.locator('#ex-tab-agents').tap();
    await expect(page.locator('.desk [data-play-toggle]')).toHaveAttribute('aria-pressed', 'true');
    expect(await desk.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(d0);
    const why = page.locator('#why');
    const btn = why.locator('[data-play-toggle]');
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const w0 = await why.evaluate((el) => (el as HTMLElement).offsetHeight);
    await btn.tap();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(await why.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(w0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(doc0);
  });

  test('the first screen names the product; the benefits stack and read in full', async ({ page }) => {
    await page.goto('/');
    // the topbar's path names it on a phone ("labs / wicked-studio" after the mark), so the hero
    // repeats the name only under 360px, where the path cuts it short
    const name = page.locator('.topbar').getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'wicked-studio', exact: true });
    await expect(name).toBeVisible();
    await expect(name).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.hero-pkg')).toBeHidden();
    // and what it is, spelled out, as the hero's first line
    await expect(page.locator('.hero-kick')).toHaveText('Agentic development environment (ADE)');
    await expect(page.locator('.hero-kick')).toBeInViewport();
    // three cards, one under the other, each the full width of the row
    const cards = await page.locator('.why .ben').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) }; }));
    expect(cards).toHaveLength(3);
    expect(cards[0].l).toBe(cards[1].l);
    expect(cards[1].t).toBeGreaterThan(cards[0].t);
    expect(cards[2].t).toBeGreaterThan(cards[1].t);
    // the Learn schematic wraps instead of cutting words off
    const cut = await page.locator('.art-learn .al-row span').evaluateAll((ls) => ls.filter((l) => l.scrollWidth > l.clientWidth + 1).length);
    expect(cut).toBe(0);
  });

  // Every visible target, measured AND hit-tested: five points spanning its box must reach it
  // (a box that another element covers is not a 44px target). The page is swept with the topbar's
  // menu closed, then the menu is opened and its own targets are swept (open, it covers the page).
  // A link inside a sentence is held to its line instead (WCAG 2.5.8's inline exception): a 44px box
  // there covers the words above and below it (see the in-text link test).
  const tapSweep = (page: import('@playwright/test').Page, scope = 'body') => page.evaluate((scope) => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(scope.split(',').map((s) => `${s} :is(a[href], button, input, [role=tab], [role=radio], [role=switch])`).join(',')))) {
      let r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      let hidden = false;
      for (let a: HTMLElement | null = el; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden') { hidden = true; break; } }
      if (hidden || el.closest('[aria-hidden="true"]')) continue;
      const label = `${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28)}`;
      const inSentence = el.tagName === 'A' && getComputedStyle(el).display.startsWith('inline') && !!el.closest('p, li')
        && Array.from(el.parentElement!.childNodes).some((n) => n !== el && n.nodeType === 3 && /\w/.test(n.textContent || ''));
      if (!inSentence && (r.width < 43.5 || r.height < 43.5)) { out.push(`${label} ${Math.round(r.width)}x${Math.round(r.height)}`); continue; }
      if (getComputedStyle(el).position !== 'fixed' && !el.closest('.topbar, .mobile-menu')) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); r = el.getBoundingClientRect(); }
      // the centre and the four edge midpoints, 10% in (corners are outside a pill's rounded box)
      let missed = 0;
      for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.5], [0.9, 0.5], [0.5, 0.1], [0.5, 0.9]]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el === hit || el.contains(hit))) missed++;
      }
      if (missed) out.push(`${label}: ${missed}/5 points covered`);
    }
    return out;
  }, scope);

  test('every tap target on the page is at least 44 x 44 and nothing covers it, the shared chrome included', async ({ page }) => {
    // verifier (round 2): "Watch a job" 82x15, "crew’s" 42x17, "wicked-estate" 83x15, the Pi chip
    // 39 wide; the topbar buttons 36x36, the band's links 18 and the footer's 24-35 tall
    await page.goto('/');
    await page.evaluate(async () => { await document.fonts.ready; });
    expect(await tapSweep(page)).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('#mobileMenu')).toBeVisible();
    expect(await tapSweep(page, '.topbar, .mobile-menu')).toEqual([]);
  });

  // verifier (3b33923): the in-text link's 44px pad lay over "are", the period and the lines above and
  // below, so a tap on those words opened crew's site. A link inside a sentence keeps its line.
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
    test(`the in-text link covers no word around it, and keeps its sentence's line spacing @ ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const m = await page.locator('.facts li').last().evaluate((li) => {
        const a = li.querySelector('a')!; a.scrollIntoView({ block: 'center' });
        const r = a.getBoundingClientRect(); const hits: string[] = [];
        const walker = document.createTreeWalker(li.closest('ul')!, NodeFilter.SHOW_TEXT); let n: Node | null;
        while ((n = walker.nextNode())) {
          if (a.contains(n)) continue;
          let off = 0;
          for (const w of (n.textContent || '').split(/(\s+)/)) {
            if (w.trim()) {
              const rg = document.createRange(); rg.setStart(n, off); rg.setEnd(n, off + w.length);
              for (const b of Array.from(rg.getClientRects())) {
                const ix = Math.min(b.right, r.right) - Math.max(b.left, r.left), iy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
                if (ix > 1 && iy > 1) hits.push(w);
              }
            }
            off += w.length;
          }
        }
        return { hits, h: r.height, line: parseFloat(getComputedStyle(li).lineHeight), liH: li.getBoundingClientRect().height };
      });
      expect(m.hits, 'words under the link box').toEqual([]);
      expect(m.h).toBeLessThanOrEqual(m.line + 1);
      expect(m.liH, 'two lines tall, not stretched by the link').toBeLessThanOrEqual(m.line * 2 + 1);
    });
  }

  test('at 768px (the shared topbar shows its icons inline there) every target is 44 x 44 too, the path included', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.evaluate(async () => { await document.fonts.ready; });
    expect(await tapSweep(page)).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await tapSweep(page, '.topbar')).toEqual([]);
  });

  test('the header keeps the mark and "labs / wicked-studio"; the menu leads with Wicked Labs', async ({ page }) => {
    await page.goto('/');
    const path = page.locator('.topbar').getByRole('navigation', { name: 'Breadcrumb' });
    // the lockup shows only its mark on a phone (its lettering clipped); the text crumbs stay whole
    expect(await path.locator('.wordmark-lockup').evaluate((svg) => getComputedStyle(svg).clipPath)).toContain('22px');
    const mark = (await path.locator('.wordmark').boundingBox())!;
    expect(Math.min(mark.width, mark.height), 'the mark is a 44px target').toBeGreaterThanOrEqual(44);
    // its focus ring is drawn inside its box, so the window's left edge never cuts it (codex review)
    for (let k = 0; k < 4 && !(await path.locator('.wordmark').evaluate((el) => el === document.activeElement)); k++) await page.keyboard.press('Tab');
    const ring = await path.locator('.wordmark').evaluate((el) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      return { focused: el.matches(':focus-visible'), left: r.left - parseFloat(cs.outlineOffset) - parseFloat(cs.outlineWidth) };
    });
    expect(ring.focused).toBe(true);
    expect(ring.left, 'the focus ring starts off the window').toBeGreaterThanOrEqual(0);
    for (const [name, href] of [['labs', 'https://wickedlabs.ai/'], ['wicked-studio', 'https://ws.wickedagile.com']]) {
      const l = path.getByRole('link', { name, exact: true });
      await expect(l).toHaveAttribute('href', href);
      await expect(l).toBeInViewport({ ratio: 1 });
      expect(await l.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${name} is cut`).toBe(true);
    }
    await page.locator('#menuBtn').click();
    const menu = page.locator('#mobileMenu');
    await expect(menu).toBeVisible();
    const first = menu.getByRole('link').first();
    await expect(first).toContainText('Wicked Labs');
    await expect(first).toHaveAttribute('href', 'https://wickedlabs.ai/');
  });

  // codex (local review): the path cut the package name short at 641-720 (this site's 44px icons
  // beside the full lockup) and at 320; the hero no longer named it on a phone
  for (const width of [360, 390, 641, 700, 721, 768]) {
    test(`the header's path shows the whole package name @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const name = page.locator('.topbar .crumbs').getByRole('link', { name: 'wicked-studio', exact: true });
      await expect(name).toBeInViewport({ ratio: 1 });
      expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });
  }
  test('under 360px, where the path cuts the name short, the hero names the package', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await expect(page.locator('.hero-pkg')).toBeVisible();
    await expect(page.locator('.hero-pkg')).toHaveText('wicked-studio');
    await expect(page.locator('.hero-pkg')).toBeInViewport();
  });
});
