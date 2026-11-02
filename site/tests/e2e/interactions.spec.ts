import { test, expect, type Page, type Locator } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * Each frame carries one thing to watch or drive. These drive them the way a visitor does and assert
 * what each control changes, plus the layout rule every one of them follows: no hover, focus, tap or
 * step moves anything outside the component's own box.
 */
test.use({ viewport: { width: 1440, height: 700 }, permissions: ['clipboard-read', 'clipboard-write'] });

const box = (l: Locator) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; });

async function frozen(page: Page, sel: string) {
  // stop the autoplay so a step cannot race the assertion
  await page.locator(sel).locator('[data-play-toggle]').click();
}

test('the sidebar explorer: click, arrows and End pick a page; the box never changes size', async ({ page }) => {
  await page.goto('/');
  const ex = page.locator('.explorer');
  await bringIntoView(ex);
  await frozen(page, '.desk');
  const before = await box(ex);
  await ex.getByRole('tab', { name: 'Memory' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Memory' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Memory' })).toContainText('What happened, what you said, what jobs learned.');
  await page.keyboard.press('ArrowDown');
  await expect(ex.getByRole('tab', { name: 'Agents' })).toBeFocused();
  await expect(ex.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(ex.getByRole('tab', { name: /Learn/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(ex.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true');
  // one visible panel at a time, every panel stacked in one cell
  await expect(ex.locator('.ex-panel.is-on')).toHaveCount(1);
  expect(await box(ex)).toEqual(before);
});

test('the explorer tours on its own and Pause stops it', async ({ page }) => {
  await page.goto('/');
  const ex = page.locator('.explorer');
  await bringIntoView(ex);
  await page.mouse.move(5, 690);
  await expect(ex.getByRole('tab', { name: 'Projects' })).toHaveAttribute('aria-selected', 'true', { timeout: 7000 });
  const btn = page.locator('.desk [data-play-toggle]');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  const on = await ex.locator('[role=tab][aria-selected=true]').textContent();
  await page.waitForTimeout(4800);
  expect(await ex.locator('[role=tab][aria-selected=true]').textContent()).toBe(on);
});

test('review: the relay fills the receipt; one agent signed in stops the job with the reduced-assurance line', async ({ page }) => {
  await page.goto('/');
  const sec = page.locator('.review');
  await bringIntoView(sec.locator('.relay'));
  const receipt = sec.locator('.receipt');
  await expect(receipt.locator('tr.is-filled')).toHaveCount(5, { timeout: 10_000 });
  await expect(sec.locator('.relay')).toHaveAttribute('data-tok', 'y');
  const h0 = await box(receipt);
  const sw = sec.getByRole('switch', { name: 'Two agents signed in' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(sw).toHaveAccessibleName('Two agents signed in');
  await expect(receipt.locator('.rv-one').first()).toBeHidden();
  await expect(receipt.locator('.relay-stop')).toBeHidden();
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(receipt).toHaveClass(/is-stopped/, { timeout: 6000 });
  // only the state on screen is exposed: the other layer keeps its space but is hidden
  await expect(receipt.locator('.relay-stop')).toBeVisible();
  await expect(receipt.locator('.relay-stop')).toContainText('reduced assurance');
  await expect(receipt.locator('.receipt-foot')).toBeHidden();
  await expect(receipt.locator('.rv-one').nth(3)).toBeVisible();
  await expect(receipt.locator('.rv-two').nth(3)).toBeHidden();
  await expect(receipt.getByRole('row', { name: /Reviewed by/ })).toHaveAccessibleName(/nobody: no second agent/);
  // both states have the same rows and the same height
  expect(await box(receipt)).toEqual(h0);
  await sw.click();
  await expect(receipt).not.toHaveClass(/is-stopped/);
});

test('rules / memory / knowledge: approve a rule, edit and erase a memory, reveal a source', async ({ page }) => {
  await page.goto('/');
  const steer = page.locator('.steer');
  await bringIntoView(steer);
  const trio = steer.locator('.trio');
  const h0 = await box(trio);

  const rule = steer.locator('[data-drawer="rule"]');
  await rule.getByRole('button', { name: 'Approve' }).click();
  await expect(rule).toHaveAttribute('data-state', 'ok');
  await expect(rule.locator('.dr-s-ok')).toBeVisible();
  await expect(rule.getByRole('button', { name: 'Reset' }).first()).toBeFocused();

  const mem = steer.locator('[data-drawer="memory"]');
  await mem.getByRole('button', { name: 'Edit' }).click();
  const input = mem.getByRole('textbox', { name: 'Edit the memory' });
  await expect(input).toBeFocused();
  await input.fill('Track per-key limits in issue 41.');
  await input.press('Enter');
  await expect(mem.locator('[data-mem-text]')).toHaveText('Track per-key limits in issue 41.');
  // a memory as long as the field allows stays inside its box
  const longest = 'x'.repeat(200);
  await mem.getByRole('button', { name: 'Edit' }).click();
  await input.fill(longest);
  await expect(input).toHaveValue('x'.repeat(80));
  await input.press('Enter');
  expect(await box(trio)).toEqual(h0);
  await mem.getByRole('button', { name: 'Erase' }).click();
  await expect(mem).toHaveAttribute('data-state', 'gone');
  await expect(mem.locator('.dr-gone')).toBeVisible();
  await expect(mem.locator('[data-mem-text]')).toBeHidden();
  await expect(mem.getByRole('button', { name: 'Undo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(mem).toHaveAttribute('data-state', 'in');

  const know = steer.locator('[data-drawer="know"]');
  const chip = know.getByRole('button', { name: 'src/http/router.ts:2' });
  await expect(know.locator('.dr-src')).toBeHidden();
  await chip.focus();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await expect(know.locator('.dr-src')).toBeVisible();
  await expect(know.locator('.dr-src')).toHaveCSS('opacity', '1');
  await expect(know.locator('.dr-src')).toContainText("rateLimit({ perMinute: 100 })");

  // none of it moved the cards
  expect(await box(trio)).toEqual(h0);
});

test('agents: picking one puts it in the sandbox; the search example counts its hits', async ({ page }) => {
  await page.goto('/');
  const reach = page.locator('.reach');
  await bringIntoView(reach);
  const group = reach.getByRole('radiogroup', { name: 'Pick an agent to see its sandbox' });
  await group.getByRole('radio', { name: 'Codex' }).click();
  await expect(group.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');
  await expect(reach.locator('[data-agent-name]')).toHaveText('Codex');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Copilot' })).toBeFocused();
  await expect(reach.locator('[data-agent-name]')).toHaveText('Copilot');
  await expect(reach.locator('.hits [data-n="4"]')).toHaveText('4', { timeout: 6000 });
  await expect(reach.locator('.hits [data-n="3"]')).toHaveText('3');
  await expect(reach.locator('.hits caption')).toContainText('8 hits');
});

test('what is new: eight items, arrows move, one stacked panel', async ({ page }) => {
  await page.goto('/');
  const news = page.locator('.news');
  await bringIntoView(news);
  await frozen(page, '.new');
  const stage = news.locator('.news-stage');
  const h0 = await box(stage);
  await news.getByRole('tab', { name: 'Voice' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(news.getByRole('tab', { name: 'Guided asks' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Guided asks' })).toContainText('share one guided card');
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel', { name: 'Plugins as cards' })).toBeVisible();
  expect(await box(stage)).toEqual(h0);
});

test('the hero: the one command copies, and "Watch a job" replays the job to its plan', async ({ page }) => {
  await page.goto('/');
  const chip = page.getByRole('button', { name: 'Copy npx wicked-crew serve' });
  await chip.click();
  await expect(chip).toContainText('Copied');
  // the confirmation is announced too (the visible label is aria-hidden)
  await expect(page.getByRole('status')).toHaveText('Copied: npx wicked-crew serve');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('npx wicked-crew serve');
  const ide = page.locator('[data-ide]');
  await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeVisible({ timeout: 10_000 });
  await ide.getByRole('button', { name: 'Approve plan' }).click();
  await page.getByRole('link', { name: /Watch a job/ }).click();
  await expect(ide.locator('.empty')).toBeVisible();
  await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeVisible({ timeout: 10_000 });
  await expect(ide.locator('.msg--user')).toContainText('100 requests a minute per API key');
});

test('keyboard: a decision hands focus to the next card instead of dropping it to the page', async ({ page }) => {
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  const ok = ide.getByRole('button', { name: 'Approve plan' });
  await expect(ok).toBeVisible({ timeout: 10_000 });
  await ok.focus();
  await page.keyboard.press('Enter');
  // focus never falls to <body> while the job runs, and lands on the gate's first choice
  await expect(ide.getByRole('button', { name: 'Approve', exact: true })).toBeFocused({ timeout: 10_000 });
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  // the composer shows a ring when it has keyboard focus
  await ide.getByRole('textbox', { name: 'Message your agents' }).focus();
  expect(await ide.getByRole('textbox', { name: 'Message your agents' }).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
});

test('the platform map hover glow stays inside the band', async ({ page }) => {
  // SameGarden's own plane glow (0 24px 56px -30px) reached 46px into Get it; the site overrides it.
  await page.goto('/');
  const band = page.locator('.same-garden');
  await bringIntoView(band);
  const plane = band.locator('.sg-plane--foundation');
  await plane.hover();
  const m = await plane.evaluate((el) => {
    const s = getComputedStyle(el).boxShadow;
    let reach = 0;
    for (const part of s.split(/,(?![^(]*\))/)) {
      const nums = (part.replace(/(rgba?|color-mix|oklab|oklch|color)\([^)]*\)/g, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
      const [, oy = 0, blur = 0, spread = 0] = nums;
      reach = Math.max(reach, oy + blur + spread);
    }
    const r = el.getBoundingClientRect(), b = el.closest('.same-garden')!.getBoundingClientRect();
    return { glowBottom: r.bottom + reach, bandBottom: b.bottom };
  });
  expect(m.glowBottom).toBeLessThanOrEqual(m.bandBottom);
});

test('topbar tooltips open below the bar, inside the window', async ({ page }) => {
  await page.goto('/');
  const tip = page.locator('.topbar [data-tip]').first();
  await tip.hover();
  const top = await tip.evaluate((el) => {
    const cs = getComputedStyle(el, '::after');
    return el.getBoundingClientRect().top + (cs.top === 'auto' ? -1 : parseFloat(cs.top));
  });
  expect(top).toBeGreaterThanOrEqual(0);
});

test('switching jobs while the prompt types stops the typing and nothing posts by itself', async ({ page }) => {
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  const input = ide.getByRole('textbox', { name: 'Message your agents' });
  // catch it mid-typing, then switch away
  await expect.poll(() => input.inputValue(), { timeout: 6000 }).toMatch(/^Add rate/);
  await ide.locator('[data-id="flaky"]').click();
  await expect(input).toHaveValue('');
  await page.waitForTimeout(2500);
  await expect(input).toHaveValue('');
  await ide.locator('[data-id="rate"]').click();
  await expect(ide.locator('.empty')).toBeVisible();
  await expect(input).toHaveValue('Add rate limiting to the public API: 100 requests a minute per API key.');
});

test('a re-render keeps focus on the diff, and the side panel never drops focus to the page', async ({ page }) => {
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  await ide.getByRole('button', { name: 'Approve plan' }).click({ timeout: 10_000 });
  await ide.getByRole('button', { name: 'Send back' }).click({ timeout: 10_000 });
  const diff = ide.locator('.diff');
  await diff.focus();
  // the rebuild re-renders the pane
  await expect(ide.locator('.diff')).toContainText('x-api-key', { timeout: 10_000 });
  await expect(ide.locator('.diff')).toBeFocused();
});

test('the wheel over the demo chat scrolls the chat, not the page', async ({ page }) => {
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  await ide.getByRole('button', { name: 'Approve plan' }).click({ timeout: 10_000 });
  await expect(ide.getByRole('button', { name: 'Send back' })).toBeVisible({ timeout: 10_000 });
  const thread = ide.locator('[data-thread]');
  const scrolls = await thread.evaluate((el) => { el.style.scrollBehavior = 'auto'; el.scrollTop = 0; return el.scrollHeight > el.clientHeight + 20; });
  expect(scrolls, 'the chat overflows at the gate').toBe(true);
  const b = (await thread.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(600);
  expect(await thread.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('Tab into the next frame lands on a frame with the focused control in view', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ide-pane-tabs [aria-selected="true"]').focus();
  for (let k = 0; k < 6; k++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => !!document.activeElement?.closest('#why'))) break;
  }
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const r = document.activeElement!.getBoundingClientRect();
    const why = document.querySelector('#why')!.getBoundingClientRect();
    return { inWhy: !!document.activeElement!.closest('#why'), top: r.top, bottom: r.bottom, whyTop: Math.round(why.top), vh: innerHeight };
  });
  expect(m.inWhy).toBe(true);
  expect(m.top).toBeGreaterThanOrEqual(64);
  expect(m.bottom).toBeLessThanOrEqual(m.vh);
  expect(m.whyTop, 'the frame is snapped under the topbar').toBe(64);
});
