import { test, expect, type Page } from '@playwright/test';

/**
 * The hero, demo included, has to fit a laptop screen.
 *
 * The hero's argument is the working demo, so the decision buttons must be on screen on load at
 * 1440x700 (900 is taller than a real laptop window once browser chrome is counted; at 900 an
 * earlier version of this page measured "fits" while its gate buttons sat 300px below the fold).
 * These assert against the viewport, not fixed pixel counts, so copy edits do not trip them.
 */

const LAPTOP = { width: 1440, height: 700 };
const LAPTOP_TALL = { width: 1440, height: 760 };

const barHeight = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.topbar, header[class*="topbar"]');
    return bar ? Math.round(bar.getBoundingClientRect().height) : 0;
  });

for (const vp of [LAPTOP, LAPTOP_TALL]) {
  test.describe(`hero at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('the hero content fits with slack', async ({ page }) => {
      // The hero is exactly one frame and the demo flexes to fill it, so measure the part that does
      // not flex: the copy column must end with slack above the frame's bottom (CI's Linux runner
      // renders this page's webfonts ~24px taller than macOS), and nothing may overflow the hero.
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const m = await page.evaluate(() => {
        const hero = document.querySelector('.hero') as HTMLElement;
        const copy = document.querySelector('.hero-copy') as HTMLElement;
        const hr = hero.getBoundingClientRect(), cr = copy.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(hero).paddingBottom);
        return { slack: Math.round(hr.bottom - pad - cr.bottom), sh: hero.scrollHeight, ch: hero.clientHeight, h: Math.round(hr.height) };
      });
      const usable = vp.height - (await barHeight(page));
      expect(m.h, `.hero is ${m.h}px in ${usable}px`).toBeLessThanOrEqual(usable);
      expect(m.sh, 'the hero overflows itself').toBeLessThanOrEqual(m.ch + 1);
      expect(m.slack, `the copy column ends ${m.slack}px above the frame's bottom`).toBeGreaterThanOrEqual(20);
    });

    test('the plan and the gate decisions are on screen without scrolling', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const ide = page.locator('[data-ide]');
      const approvePlan = ide.getByRole('button', { name: 'Approve plan' });
      await expect(approvePlan).toBeVisible({ timeout: 10_000 });
      await expect(approvePlan).toBeInViewport({ ratio: 1 });

      await approvePlan.click();
      for (const name of ['Approve', 'Approve with a note for the next step', 'Send back']) {
        const btn = ide.getByRole('button', { name, exact: true });
        await expect(btn).toBeVisible({ timeout: 10_000 });
        // The thread scrolls inside the demo; the page itself never moves.
        await expect(btn, `"${name}" is below the fold`).toBeInViewport({ ratio: 1 });
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test('the platform band fits the viewport', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const h = await page.evaluate(() =>
        Math.round(document.querySelector('.same-garden')!.getBoundingClientRect().height),
      );
      const usable = vp.height - (await barHeight(page));
      expect(h, `.same-garden is ${h}px in ${usable}px of usable height`).toBeLessThanOrEqual(usable);
    });
  });
}

/**
 * The demo at 85% (operator, 2026-11-02: "we need whitespace"): the window is 85% of its column's
 * width and height, centred in the column, sized rather than scaled (no transform, no zoom of its
 * own), and no text in it is under 12px at a laptop size, in any state the visitor drives it to.
 */
test.describe('the hero demo at 85%', () => {
  for (const vp of [{ width: 1440, height: 700 }, { width: 1280, height: 660 }, { width: 1200, height: 700 }, { width: 1440, height: 640 }, { width: 1200, height: 640 }, { width: 1920, height: 1080 }]) {
    test(`85% of its column, centred, and no text under 12px @ ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const box = await page.evaluate(() => {
        const ide = document.querySelector<HTMLElement>('.hero .ide')!; const grid = ide.parentElement!;
        const g = grid.getBoundingClientRect(), r = ide.getBoundingClientRect(), cs = getComputedStyle(grid);
        const [c1, c2] = cs.gridTemplateColumns.split(' ').map(parseFloat);
        const zoom = parseFloat(getComputedStyle(grid.closest('.wrap')!).zoom) || 1;
        const colL = g.left + (c1 + parseFloat(cs.columnGap)) * zoom, colW = c2 * zoom;
        // 85% of the row, at least 440px where the row allows (a short window), at most 612px; when a
        // frame overflows its window (html.frames-overflow: text zoom, wider fonts) the hero is no
        // longer one frame and the demo keeps the fallback's fixed 520px
        const want = document.documentElement.classList.contains('frames-overflow') ? 520 * zoom
          : Math.min(612 * zoom, Math.max(0.85 * g.height, Math.min(g.height, 440 * zoom)));
        return { w: r.width / colW, hpx: r.height, want, left: r.left - colL, right: colL + colW - r.right, top: r.top - g.top, bottom: g.bottom - r.bottom, tf: getComputedStyle(ide).transform, zoom: getComputedStyle(ide).zoom };
      });
      expect(box.tf).toBe('none');
      expect(box.zoom).toBe('1');
      expect(box.w).toBeGreaterThan(0.84); expect(box.w).toBeLessThan(0.86);
      expect(Math.abs(box.hpx - box.want), `${box.hpx}px tall, want ${box.want}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(box.left - box.right), `left ${box.left} vs right ${box.right}`).toBeLessThanOrEqual(1);
      expect(Math.abs(box.top - box.bottom), `top ${box.top} vs bottom ${box.bottom}`).toBeLessThanOrEqual(1);
      expect(box.left).toBeGreaterThan(20);

      const small = () => page.evaluate(() => {
        const ide = document.querySelector<HTMLElement>('.hero .ide')!; const out: string[] = [];
        const zoom = parseFloat(getComputedStyle(ide.closest('.wrap')!).zoom) || 1;
        const w = document.createTreeWalker(ide, NodeFilter.SHOW_TEXT); let n: Node | null;
        while ((n = w.nextNode())) {
          const el = n.parentElement!; if (!(n.textContent || '').trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(n); const b = rg.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (!b.width || !b.height || cs.visibility === 'hidden') continue;
          const px = parseFloat(cs.fontSize) * zoom;
          if (px < 11.99) out.push(`"${(n.textContent || '').trim().slice(0, 24)}" ${px}px`);
        }
        return out;
      });
      // and nothing in it is cut off with an ellipsis (a file name in the narrower side pane)
      const cut = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.hero .ide *'))
        .filter((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 1)
        .map((el) => (el.textContent || '').trim()));
      // codex (local review): at 1200px the step row ran under the side pane, and in short windows the
      // review card was taller than its thread (the reviewer's name scrolled away). Whole, or it fails.
      const whole = () => page.evaluate(() => {
        const out: string[] = [];
        const inside = (el: Element, box: Element, what: string) => {
          const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
          if (r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) out.push(`${what}: [${[r.left, r.top, r.right, r.bottom].map(Math.round)}] outside [${[b.left, b.top, b.right, b.bottom].map(Math.round)}]`);
        };
        const head = document.querySelector('.hero .ide-head')!; const hs = getComputedStyle(head);
        const h = head.getBoundingClientRect();
        const content = { getBoundingClientRect: () => new DOMRect(h.left + parseFloat(hs.paddingLeft), h.top, h.width - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight), h.height) } as Element;
        inside(document.querySelector('.hero .ide-steps')!, content, 'the step row');
        const live = document.querySelector('.hero .msg.is-live');
        if (live) inside(live, document.querySelector('.hero [data-thread]')!, 'the decision card');
        return out;
      });
      const ide = page.locator('[data-ide]');
      expect(await small(), 'on load').toEqual([]);
      await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(600);
      expect(await whole(), 'at the plan').toEqual([]);
      await ide.getByRole('button', { name: 'Approve plan' }).click();
      await expect(ide.getByRole('button', { name: 'Send back', exact: true })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(600);
      expect(await small(), 'at the gate').toEqual([]);
      expect(await cut(), 'at the gate').toEqual([]);
      expect(await whole(), 'at the gate').toEqual([]);
      await ide.locator('[data-pane-tab="receipt"]').click();
      expect(await small(), 'the receipt').toEqual([]);
      expect(await cut(), 'the receipt').toEqual([]);
    });
  }
});
