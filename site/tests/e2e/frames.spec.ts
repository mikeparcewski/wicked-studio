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
