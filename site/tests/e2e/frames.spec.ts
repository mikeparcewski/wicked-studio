import { test, expect, type Page } from '@playwright/test';

/**
 * Every section is one frame on a desktop window: the viewport under the fixed topbar. Snapping is
 * mandatory there (snap-layout.spec.ts), which is only safe because nothing in a frame is taller
 * than the frame. This pins that: a frame that grows past the viewport, or content that overflows
 * its frame, fails here at the tightest laptop window and at a large one.
 */
const SIZES = [
  { width: 1440, height: 700 },
  { width: 1280, height: 660 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  // the edges of the mandatory-snap media (studio.css): every frame must fit right at them
  { width: 1260, height: 660 },
  { width: 941, height: 760 },
  { width: 1259, height: 760 },
];

async function frames(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.topbar') as HTMLElement | null;
    const frame = innerHeight - (bar ? Math.round(bar.getBoundingClientRect().height) : 0);
    const out = Array.from(document.querySelectorAll('section.frame, section.same-garden')).map((s) => {
      const el = s as HTMLElement;
      return { name: el.id || el.className.split(' ')[0], h: Math.round(el.getBoundingClientRect().height), sh: el.scrollHeight, ch: el.clientHeight };
    });
    return { frame, out };
  });
}

for (const vp of SIZES) {
  test(`every frame fits the window at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    await page.evaluate(async () => { await document.fonts.ready; });
    const { frame, out } = await frames(page);
    expect(out.length).toBeGreaterThanOrEqual(9);
    const headroom = await page.evaluate(() => {
      // content, not the frame: a frame is min-height 100svh, so it only grows once content overflows
      const bar = document.querySelector('.topbar') as HTMLElement;
      const f = innerHeight - bar.getBoundingClientRect().height;
      return Array.from(document.querySelectorAll('section.frame:not(.hero)')).map((s) => {
        const cs = getComputedStyle(s);
        const kids = Array.from(s.children).filter((c) => getComputedStyle(c).position !== 'absolute');
        const top = Math.min(...kids.map((c) => c.getBoundingClientRect().top));
        const bot = Math.max(...kids.map((c) => c.getBoundingClientRect().bottom));
        return { name: (s as HTMLElement).id, room: Math.round(f - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (bot - top)) };
      });
    });
    for (const r of headroom) {
      // CI's Linux runner sets these webfonts a little taller than macOS: keep room for it
      expect(r.room, `${r.name} has ${r.room}px of headroom`).toBeGreaterThanOrEqual(16);
    }
    for (const s of out) {
      expect(s.h, `${s.name} is ${s.h}px in a ${frame}px frame`).toBeLessThanOrEqual(frame + 1);
      expect(s.sh, `${s.name} overflows itself (${s.sh} > ${s.ch})`).toBeLessThanOrEqual(s.ch + 1);
    }
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
  });
}

test('the demo gets the frame: the plan card and your prompt are both in view at 1440x700', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeInViewport({ ratio: 1, timeout: 10_000 });
  await expect(ide.locator('.msg--user')).toBeInViewport({ ratio: 1 });
  const h = await ide.evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(h, 'the demo is at least 500px tall').toBeGreaterThanOrEqual(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

/**
 * Every scene, schematic and drawer reserves its largest state up front, so nothing a step, a tour or
 * a tap reveals can be cut off by its box. All states are laid out at once (they change opacity, not
 * layout), so one measurement per size covers every step: no descendant may stick out of its box.
 */
for (const vp of [
  { width: 1440, height: 700 }, { width: 1280, height: 660 }, { width: 941, height: 760 },
  { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 740 }, { width: 320, height: 640 },
]) {
  test.describe(`nothing is clipped inside its reserved box at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, contextOptions: { reducedMotion: 'reduce' } });
    test('scenes, schematics, drawers and the sandbox', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const box of document.querySelectorAll('.scene, .ex-art, .dr-slot, .dr-src-stack, .sandbox, .sb-foot, .flow li')) {
          const b = box.getBoundingClientRect();
          for (const el of box.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || el.closest('svg') && el.tagName !== 'svg') continue;
            const over = Math.max(b.top - r.top, r.bottom - b.bottom, b.left - r.left, r.right - b.right);
            if (over > 1.5) out.push(`${(box as HTMLElement).className.split(' ')[0]} > ${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]} by ${over.toFixed(1)}px`);
          }
        }
        return out;
      });
      expect(bad).toEqual([]);
    });
  });
}

// Outside the media where the hero is one fixed frame, it grows with its content: never into the next frame.
for (const vp of [{ width: 941, height: 600 }, { width: 941, height: 700 }, { width: 1200, height: 640 }, { width: 1280, height: 600 }]) {
  test(`the hero never runs into the next frame at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    await page.evaluate(async () => { await document.fonts.ready; });
    const m = await page.evaluate(() => {
      const hero = document.querySelector('.hero')!.getBoundingClientRect();
      const ide = document.querySelector('[data-ide]')!.getBoundingClientRect();
      const copy = document.querySelector('.hero-copy')!.getBoundingClientRect();
      const why = document.querySelector('#why')!.getBoundingClientRect();
      return { heroBottom: hero.bottom, ideBottom: ide.bottom, copyBottom: copy.bottom, whyTop: why.top };
    });
    expect(m.ideBottom).toBeLessThanOrEqual(m.heroBottom + 1);
    expect(m.copyBottom).toBeLessThanOrEqual(m.heroBottom + 1);
    expect(m.whyTop).toBeGreaterThanOrEqual(m.heroBottom - 1);
  });
}

// Windows too short for the one-frame hero: the hero grows, but driving the demo never moves the page.
for (const vp of [{ width: 941, height: 600 }, { width: 1280, height: 600 }]) {
  test(`the demo keeps its height through a whole job at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    const ide = page.locator('[data-ide]');
    const heroH = () => page.locator('.hero').evaluate((el) => Math.round(el.getBoundingClientRect().height));
    await ide.getByRole('button', { name: 'Approve plan' }).waitFor({ timeout: 10_000 });
    const h0 = await heroH();
    await ide.getByRole('button', { name: 'Approve plan' }).click();
    await ide.getByRole('button', { name: 'Send back' }).click({ timeout: 10_000 });
    await expect(ide.locator('.msg--done')).toContainText('Pull request #12 is open.', { timeout: 15_000 });
    expect(await heroH()).toBe(h0);
    await ide.locator('[data-id="node"]').click();
    expect(await heroH()).toBe(h0);
  });
}

test('enlarged text in the hero turns snapping off and the hero grows around it', async ({ page }) => {
  // text zoom confined to the hero: the fixed-height frame must give way instead of spilling
  await page.setViewportSize({ width: 1280, height: 660 });
  await page.goto('/');
  await page.addStyleTag({ content: '.hero-copy, .hero-copy * { font-size: 26px !important; line-height: 1.4 !important; }' });
  await expect(page.locator('html')).toHaveClass(/frames-overflow/);
  const m = await page.evaluate(() => {
    const hero = document.querySelector('.hero')!.getBoundingClientRect();
    const copy = document.querySelector('.hero-copy')!.getBoundingClientRect();
    const why = document.querySelector('#why')!.getBoundingClientRect();
    return { heroTop: hero.top, heroBottom: hero.bottom, copyTop: copy.top, copyBottom: copy.bottom, whyTop: why.top, snap: getComputedStyle(document.documentElement).scrollSnapType };
  });
  expect(m.snap).not.toContain('mandatory');
  expect(m.copyTop).toBeGreaterThanOrEqual(m.heroTop);
  expect(m.copyBottom).toBeLessThanOrEqual(m.heroBottom + 1);
  expect(m.whyTop).toBeGreaterThanOrEqual(m.heroBottom - 1);
});

test('enlarged text in a drawer pushes its actions down instead of covering the rule', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 660 });
  await page.goto('/');
  await page.addStyleTag({ content: '[data-drawer="rule"] * { font-size: 24px !important; }' });
  const m = await page.locator('[data-drawer="rule"]').evaluate((el) => ({
    rule: el.querySelector('.dr-rule')!.getBoundingClientRect().bottom,
    acts: el.querySelector('.dr-stack')!.getBoundingClientRect().top,
  }));
  expect(m.rule).toBeLessThanOrEqual(m.acts);
});

// A minimum font size (a low-vision setting) makes every text larger: nothing may be cut off inside
// its box, the relay rows may not run into each other, and the scenes and counts must still start.
test.describe('with a 24px minimum font size', () => {
  test.use({ viewport: { width: 1280, height: 660 } });
  const BIG = 'body *:not(svg):not(svg *) { font-size: max(24px, 1em) !important; }';

  test('the reserved boxes grow and nothing is clipped', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.addStyleTag({ content: BIG });
    await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => setTimeout(r, 200)); });
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      for (const box of document.querySelectorAll('.scene, .ex-art, .dr-slot, .dr-src-stack, .sandbox, .flow li')) {
        const b = box.getBoundingClientRect();
        for (const el of box.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || (el.closest('svg') && el.tagName !== 'svg')) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
          const over = Math.max(b.top - r.top, r.bottom - b.bottom);
          if (over > 1.5) out.push(`${(box as HTMLElement).className.split(' ')[0]} > ${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]} by ${over.toFixed(1)}px`);
        }
      }
      // the relay rows never overlap
      const lis = Array.from(document.querySelectorAll('.flow li')).map((li) => li.getBoundingClientRect());
      for (let k = 1; k < lis.length; k++) if (lis[k].top < lis[k - 1].bottom - 1) out.push(`relay row ${k} overlaps row ${k - 1}`);
      return out;
    });
    expect(bad).toEqual([]);
    await expect(page.locator('html')).toHaveClass(/frames-overflow/);
  });

  test('scenes that cannot show 60% of themselves still start', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 320 });
    await page.goto('/');
    await page.addStyleTag({ content: BIG });
    const rule = page.locator('[data-drawer="rule"]');
    await rule.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(rule).not.toHaveClass(/is-pre/, { timeout: 5000 });
    const search = page.locator('[data-search]');
    await search.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(search.locator('[data-n="4"]')).toHaveText('4', { timeout: 6000 });
  });
});

test.describe('large text on small screens', () => {
  const BIG = 'body *:not(svg):not(svg *) { font-size: max(24px, 1em) !important; }';
  test('the phone chat stays usable in a short landscape window, and a decision taps through', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 667, height: 320 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.addStyleTag({ content: BIG });
    const thread = page.locator('[data-thread]');
    expect(await thread.evaluate((el) => el.clientHeight)).toBeGreaterThanOrEqual(150);
    const ok = page.locator('[data-ide]').getByRole('button', { name: 'Approve plan' });
    await ok.scrollIntoViewIfNeeded();
    await ok.tap();
    await expect(page.locator('[data-ide] .decided').first()).toContainText('You approved the plan.');
    await ctx.close();
  });

  test('a very large text size grows the phone chat instead of pushing the composer over the side panel', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.addStyleTag({ content: 'body *:not(svg):not(svg *) { font-size: max(32px, 1em) !important; }' });
    const send = page.locator('[data-ide] [data-send]');
    await send.scrollIntoViewIfNeeded();
    const m = await page.evaluate(() => {
      const c = document.querySelector('[data-composer]')!.getBoundingClientRect();
      const p = document.querySelector('.ide-pane')!.getBoundingClientRect();
      const t = document.querySelector('[data-thread]') as HTMLElement;
      return { composerBottom: c.bottom, paneTop: p.top, thread: t.clientHeight };
    });
    expect(m.composerBottom).toBeLessThanOrEqual(m.paneTop + 1);
    expect(m.thread).toBeGreaterThanOrEqual(150);
    await send.tap();
    await expect(page.locator('[data-ide] [data-thread]')).toContainText('Add rate limiting to the public API');
    await ctx.close();
  });

  test('the hero command chip stays inside the window', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await page.addStyleTag({ content: BIG });
    const m = await page.locator('.cta-copy').evaluate((el) => {
      const b = el.getBoundingClientRect();
      const kids = Array.from(el.children).map((c) => c.getBoundingClientRect());
      return { right: b.right, vw: document.documentElement.clientWidth, out: kids.filter((r) => r.right > b.right + 1 || r.left < b.left - 1).length };
    });
    expect(m.right).toBeLessThanOrEqual(m.vw);
    expect(m.out).toBe(0);
  });
});
