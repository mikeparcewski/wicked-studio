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
