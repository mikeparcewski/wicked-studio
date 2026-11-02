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
  await expect(receipt.getByRole('row', { name: /Reviewed by/ })).toHaveAccessibleName(/nobody yet: no second agent/);
  await expect(receipt.locator('.relay-stop')).toContainText('Held.');
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
  await mem.getByRole('button', { name: 'Edit' }).click();
  await input.fill('W'.repeat(200));
  await expect(input).toHaveValue('W'.repeat(80));
  await input.press('Enter');
  expect(await box(trio)).toEqual(h0);
  // the box keeps its size; a value taller than it scrolls, and the scroller takes keyboard focus
  const saved = mem.locator('[data-mem-text]');
  const m = await saved.evaluate((el) => ({ over: el.scrollHeight > el.clientHeight + 1, tab: (el as HTMLElement).tabIndex }));
  if (m.over) expect(m.tab).toBe(0);
  await expect(saved).toHaveText('W'.repeat(80));
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
  // the whole source line is readable inside the box: it wraps, nothing is cut
  const cut = await know.locator('.dr-src .dl').evaluateAll((ls) => ls.filter((l) => l.scrollWidth > l.clientWidth + 1).length);
  expect(cut).toBe(0);

  // the reveal stays open while the pointer travels from the chip onto the source
  await chip.blur();
  await page.mouse.move(5, 5);
  await expect(know.locator('.dr-src')).toBeHidden();
  await chip.hover();
  await expect(know.locator('.dr-src')).toBeVisible();
  // slowly, through the gap: pointer speed never closes it
  const cb = (await chip.boundingBox())!;
  const sb = (await know.locator('.dr-src').boundingBox())!;
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height + 4);
  await page.waitForTimeout(400);
  await expect(know.locator('.dr-src')).toBeVisible();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 12 });
  await page.waitForTimeout(400);
  await expect(know.locator('.dr-src')).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(know.locator('.dr-src')).toBeHidden();

  // none of it moved the cards
  expect(await box(trio)).toEqual(h0);
});

test('agents: picking one puts it in the sandbox; the search example counts its hits', async ({ page }) => {
  await page.goto('/');
  const reach = page.locator('.reach');
  await bringIntoView(reach);
  // let the first query finish counting, then stop the alternation so its counts stay put
  await expect(reach.locator('.reach-card[data-search]')).toHaveClass(/is-counted/, { timeout: 10_000 });
  await frozen(page, '.reach');
  const group = reach.getByRole('radiogroup', { name: 'Pick an agent to see its sandbox' });
  // Codex is the default pick (Claude Code is the one with a token exception)
  await expect(group.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');
  const sbx = reach.locator('.sandbox');
  const s0 = await box(sbx);
  await group.getByRole('radio', { name: 'Claude Code' }).click();
  await expect(sbx.locator('.sbx-s2')).toBeVisible();
  await expect(sbx.locator('.sbx-s2')).toHaveText('sees placeholders, except a subscription’s sign-in token');
  await expect(sbx.locator('.sbx-s1')).toBeHidden();
  expect(await box(sbx)).toEqual(s0);
  await group.getByRole('radio', { name: 'Codex' }).click();
  await expect(sbx.locator('.sbx-s1')).toBeVisible();
  await expect(group.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');
  await expect(reach.locator('[data-agent-name]')).toHaveText('Codex');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'GitHub Copilot' })).toBeFocused();
  await expect(reach.locator('[data-agent-name]')).toHaveText('GitHub Copilot');
  // radios take all four arrows
  await page.keyboard.press('ArrowDown');
  await expect(group.getByRole('radio', { name: 'OpenCode' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(group.getByRole('radio', { name: 'GitHub Copilot' })).toBeFocused();
  await expect(reach.locator('.hits [data-n="4"]')).toHaveText('4', { timeout: 6000 });
  await expect(reach.locator('.hits [data-n="3"]')).toHaveText('3');
  await expect(reach.locator('.hits caption')).toContainText('8 hits');
});

// The example search on a fake clock (timers and animation frames), so every step is placed exactly
// and a loaded host cannot skip one. Its summary is shown unless the card is typing (is-pre) or
// counting (is-done without is-counted); while it is shown or painted, the rows must read 4,3,1.
async function searchSteps(page: Page) {
  const card = page.locator('[data-search]');
  const state = () => card.evaluate((el) => {
    const rows = Array.from(el.querySelectorAll('[data-n]')).map((c) => c.textContent).join(',');
    const has = (c: string) => el.classList.contains(c);
    // shown by its classes (a flip the fade has not painted yet) or by what is painted (a CSS rule lost)
    const painted = parseFloat(getComputedStyle(el.querySelector('.hits caption')!).opacity) > 0.01;
    return { rows, pre: has('is-pre'), done: has('is-done'), counted: has('is-counted'), shown: painted || (!has('is-pre') && !(has('is-done') && !has('is-counted'))) };
  });
  const bad: string[] = [];
  // advance in 35ms steps until `until` holds, checking the invariant at every step
  const run = async (until: (s: Awaited<ReturnType<typeof state>>) => boolean, label: string) => {
    let st = await state();
    // a real-time bound, not a step count: the observer that starts a play runs on real time
    for (const deadline = Date.now() + 20_000; Date.now() < deadline;) {
      st = await state();
      if (st.shown && st.rows !== '4,3,1') bad.push(`${label}:${st.rows}`);
      if (until(st)) return st;
      await page.clock.runFor(35);
    }
    throw new Error(`the search never finished its ${label}: ${JSON.stringify(st)}`);
  };
  return { state, run, bad };
}

test('the example search never shows its total while its rows still count up', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const { run, bad } = await searchSteps(page);
  await page.locator('.reach').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await run((st) => st.done, 'typing');
  // done when counted, or when the rows have read 4,3,1 for 10 steps without it (then the assert fails)
  let settled = 0;
  const end = await run((st) => st.done && (st.counted || (st.rows === '4,3,1' && ++settled > 10)), 'climb');
  expect(bad).toEqual([]);
  expect(end.counted).toBe(true);
  await expect(page.locator('.reach .hits caption')).toHaveCSS('opacity', '1');
});

test('leaving the example search mid-count and coming straight back never shows a stale total', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const { state, run, bad } = await searchSteps(page);
  const reach = page.locator('.reach');
  await reach.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await run((st) => st.done, 'typing');
  await page.clock.runFor(280); // 40% into the 700ms climb: its next frame is still pending
  const mid = await state();
  expect(mid.counted).toBe(false);
  expect(mid.rows).not.toBe('0,0,0');
  expect(mid.rows).not.toBe('4,3,1');
  // leave (the observer is real, so the reset runs without the clock), then come straight back
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(async () => (await state()).pre).toBe(true);
  await reach.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  // the replay types again, during which the old play's pending frames come due, then counts
  await run((st) => st.done, 'replay typing');
  // done when counted, or when the rows have read 4,3,1 for 10 steps without it (then the assert fails)
  let settled = 0;
  const end = await run((st) => st.done && (st.counted || (st.rows === '4,3,1' && ++settled > 10)), 'replay climb');
  expect(bad).toEqual([]);
  expect(end.counted).toBe(true);
  await expect(page.locator('.reach .hits caption')).toHaveCSS('opacity', '1');
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
  const PROMPT = 'Add rate limiting to the public API: 100 requests a minute per API key.';
  // start a typing run on purpose, and catch it part-way
  await page.getByRole('link', { name: /Watch a job/ }).click();
  await expect(ide).toHaveClass(/is-typing/);
  await expect.poll(async () => { const v = await input.inputValue(); return v.length > 0 && v.length < PROMPT.length; }).toBe(true);
  await ide.locator('[data-id="flaky"]').click();
  await expect(ide).not.toHaveClass(/is-typing/);
  await expect(input).toHaveValue('');
  await page.waitForTimeout(2500);
  await expect(input).toHaveValue('');
  await ide.locator('[data-id="rate"]').click();
  await expect(ide.locator('.empty')).toBeVisible();
  await expect(input).toHaveValue(PROMPT);
});

test('switching jobs in the gap between the typed prompt and its post cancels the post', async ({ page }) => {
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  // the moment typing ends (the 260 ms before the prompt posts), switch jobs from inside the page
  await page.evaluate(() => {
    const root = document.querySelector('[data-ide]')!;
    let seen = false;
    new MutationObserver(() => {
      if (root.classList.contains('is-typing')) seen = true;
      else if (seen) { seen = false; (root.querySelector('[data-id="flaky"]') as HTMLElement).click(); }
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
  });
  await page.getByRole('link', { name: /Watch a job/ }).click();
  await expect(ide.locator('[data-title]')).toHaveText('Fix the flaky checkout test', { timeout: 6000 });
  await page.waitForTimeout(1500);
  await ide.locator('[data-id="rate"]').click();
  await expect(ide.locator('.empty')).toBeVisible();
  await expect(ide.locator('.msg--user')).toHaveCount(0);
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

test('the side panel is a named tabpanel for the selected tab', async ({ page }) => {
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  await expect(ide.getByRole('tabpanel', { name: /Changes/ })).toBeVisible();
  await ide.getByRole('tab', { name: 'Receipt' }).click();
  await expect(ide.getByRole('tabpanel', { name: 'Receipt' })).toBeVisible();
  await expect(ide.getByRole('tab', { name: 'Receipt' })).toHaveAttribute('aria-controls', 'ide-pane-body');
});

// Fake time, stopped: nothing runs unless a test advances it (the observers stay real).
async function stoppedClock(page: Page) {
  const t0 = new Date('2026-11-02T10:00:00Z').getTime();
  await page.clock.install({ time: t0 });
  await page.clock.pauseAt(t0 + 1000);
}
// advance the fake clock in small steps until `check` holds (a real-time bound, for a loaded runner)
async function until(page: Page, check: () => Promise<boolean>, what: string, step = 50) {
  for (const end = Date.now() + 25_000; Date.now() < end;) {
    if (await check()) return;
    await page.clock.runFor(step);
  }
  throw new Error(`never happened: ${what}`);
}

test('the demo’s Pause stills its pulses, its own prompt and its background job; Play resumes them (WCAG 2.2.2)', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  const node = ide.locator('[data-id="node"]');
  await expect(node).toHaveAttribute('aria-label', 'Move CI to Node 22, GitHub Copilot working');
  // the pulses run on their own (CSS animations keep real time)
  const running = () => ide.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length);
  await expect.poll(running).toBeGreaterThan(0);
  const pause = ide.locator('[data-demo-pause]');
  await expect(pause).toHaveAccessibleName("Pause the demo's motion");
  const w0 = await box(pause);
  await pause.click();
  await expect(pause).toHaveAccessibleName("Play the demo's motion");
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await expect(ide).toHaveClass(/is-still/);
  await expect.poll(running).toBe(0);
  expect((await box(pause)).w, 'Pause and Play are one width').toBe(w0.w);
  // twenty seconds later nothing has moved: the job is where it was, the prompt was never typed
  await page.clock.runFor(20_000);
  await expect(node).toHaveAttribute('aria-label', 'Move CI to Node 22, GitHub Copilot working');
  await expect(ide.locator('.msg--user')).toHaveCount(0);
  await expect(ide.locator('[data-input]')).toHaveValue('Add rate limiting to the public API: 100 requests a minute per API key.');
  await pause.click();
  await expect(ide).not.toHaveClass(/is-still/);
  await until(page, async () => (await node.getAttribute('aria-label')) === 'Move CI to Node 22, Done', 'the background job finishing');
  await until(page, () => ide.getByRole('button', { name: 'Approve plan' }).isVisible(), 'the plan');
});

test('pausing while the demo plans holds its plan until Play', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  await until(page, async () => (await ide.locator('[data-working]').count()) > 0 && (await ide.locator('.msg--user').count()) > 0, 'the prompt posting');
  await ide.locator('[data-demo-pause]').click();
  await page.clock.runFor(5000);
  await expect(ide.getByRole('button', { name: 'Approve plan' })).toHaveCount(0);
  await ide.locator('[data-demo-pause]').click();
  await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeVisible();
});

test('every Pause button is one width as Pause and as Play', async ({ page }) => {
  await page.goto('/');
  for (const sel of ['.why', '.desk', '.review', '.steer', '.reach', '.new']) {
    const btn = page.locator(sel).locator('[data-play-toggle]');
    await bringIntoView(btn);
    const w0 = (await box(btn)).w;
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).toHaveAccessibleName(/^Play /);
    expect((await box(btn)).w, sel).toBe(w0);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  }
});

test('the relay replays on its own, stops on its step under Pause, and carries on from it', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const sec = page.locator('.review');
  await sec.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 690);
  const relay = sec.locator('.relay');
  const filled = sec.locator('.receipt tr.is-filled');
  await until(page, async () => (await filled.count()) === 5, 'the first run');
  // after its pause of 5.2 s the run starts again from the empty receipt
  await page.clock.runFor(5200);
  await expect(filled).toHaveCount(0);
  await page.clock.runFor(1300);
  await expect(relay).toHaveAttribute('data-tok', 'r');
  await sec.getByRole('button', { name: 'Pause the replays' }).click();
  await page.mouse.move(5, 690);
  await page.clock.runFor(12_000);
  await expect(relay).toHaveAttribute('data-tok', 'r');
  // the step's receipt rows (Required and Built by), not one more
  await expect(filled).toHaveCount(2);
  await sec.getByRole('button', { name: 'Play the replays' }).click();
  await until(page, async () => (await filled.count()) === 5, 'the run carrying on');
});

test('the relay keeps still while the pointer is on the receipt', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const sec = page.locator('.review');
  await sec.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await sec.locator('.receipt').hover();
  await page.clock.runFor(8000);
  await expect(sec.locator('.relay')).toHaveAttribute('data-tok', '');
  await page.mouse.move(5, 690);
  await until(page, async () => (await sec.locator('.receipt tr.is-filled').count()) === 5, 'the run after the pointer leaves');
});

test('the Rules card rotates its suggestions in one cell until you decide', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const steer = page.locator('.steer');
  await steer.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 690);
  const rule = steer.locator('[data-drawer="rule"]');
  const shown = rule.locator('.dr-rule.is-on b');
  const slot = rule.locator('.dr-slot');
  const h0 = await box(slot);
  await expect(shown).toHaveText('Public routes carry a rate limit');
  await until(page, async () => (await shown.textContent()) === 'Limits key on the API key', 'the second suggestion');
  // one suggestion is exposed at a time; the others keep their space but are hidden
  await expect(rule.locator('.dr-rule:visible')).toHaveCount(1);
  expect(await box(slot)).toEqual(h0);
  await rule.getByRole('button', { name: 'Approve' }).click();
  await expect(rule).toHaveAttribute('data-state', 'ok');
  // neither the pointer nor focus holds it now: only the decision does
  await page.mouse.move(5, 690);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.clock.runFor(13_000);
  await expect(shown).toHaveText('Limits key on the API key');
  expect(await box(slot)).toEqual(h0);
});

test('the example search alternates its query while live, and Pause stops it mid-word', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const reach = page.locator('.reach');
  const card = reach.locator('.reach-card[data-search]');
  await reach.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 690);
  const cap = reach.locator('.hits caption');
  await until(page, async () => /is-counted/.test((await card.getAttribute('class')) || ''), 'the first count');
  await expect(cap).toHaveText('register across one project: 8 hits');
  await page.clock.runFor(4200);
  await expect(cap).toHaveText('rateLimit across one project: 6 hits');
  await page.clock.runFor(140);
  await expect(reach.locator('[data-q]')).toHaveText('ra');
  await reach.getByRole('button', { name: 'Pause the examples' }).click();
  await page.mouse.move(5, 690);
  await page.clock.runFor(8000);
  await expect(reach.locator('[data-q]')).toHaveText('ra');
  await expect(reach.locator('.hits-n')).toHaveText(['0', '0', '0']);
  await reach.getByRole('button', { name: 'Play the examples' }).click();
  await until(page, async () => /is-counted/.test((await card.getAttribute('class')) || ''), 'the second count');
  await expect(reach.locator('.hits-n')).toHaveText(['2', '3', '1']);
});

test('changing the motion preference while the page is open loads it again in the new mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.why [data-play-toggle]')).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.emulateMedia({ reducedMotion: 'reduce' })]);
  // the reduced page: final frames, no loops, nothing left to pause
  await expect(page.locator('[data-play-toggle]:visible')).toHaveCount(0);
  await expect(page.locator('[data-scene][data-step="4"]')).toHaveCount(3);
  await expect(page.locator('.relay')).toHaveAttribute('data-tok', 'y');
  await expect(page.locator('[data-typed]')).toHaveText('npx wicked-crew serve');
  await expect(page.locator('[data-ide] [data-id="node"]')).toHaveAttribute('aria-label', 'Move CI to Node 22, Done');
  await Promise.all([page.waitForEvent('load'), page.emulateMedia({ reducedMotion: 'no-preference' })]);
  await expect(page.locator('.why [data-play-toggle]')).toBeVisible();
});

test('the prompt the demo types by itself waits under Pause even after a click in the demo', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  await until(page, async () => /is-typing/.test((await ide.getAttribute('class')) || ''), 'the prompt typing');
  // a click on the side panel is not "Watch a job": the run is still the demo's own
  await ide.getByRole('tab', { name: 'Receipt' }).click();
  await ide.locator('[data-demo-pause]').click();
  await page.clock.runFor(6000);
  await expect(ide.locator('.msg--user')).toHaveCount(0);
  await expect(ide.getByRole('button', { name: 'Approve plan' })).toHaveCount(0);
  await ide.locator('[data-demo-pause]').click();
  await until(page, () => ide.getByRole('button', { name: 'Approve plan' }).isVisible(), 'the plan after Play');
});

test('picking an agent with the sandbox off screen does not start its hand-off', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.agent-chip[data-agent="OpenCode"]').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-agent-name]')).toHaveText('OpenCode');
  await expect(page.locator('.sandbox')).not.toHaveClass(/is-live/);
});

test('a rotating suggestion never shows on top of the one before it', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const steer = page.locator('.steer');
  await steer.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 690);
  const rule = steer.locator('[data-drawer="rule"]');
  await page.clock.runFor(800);
  await page.clock.runFor(6000); // the rotation is due: the fades below run on real time
  const both: number[] = [];
  for (const end = Date.now() + 900; Date.now() < end;) {
    const seen = await rule.evaluate((el) => Array.from(el.querySelectorAll('.dr-rule')).filter((r) => parseFloat(getComputedStyle(r).opacity) > 0.04 && getComputedStyle(r).visibility === 'visible').length);
    both.push(seen);
  }
  expect(Math.max(...both), 'two suggestions painted at once').toBeLessThanOrEqual(1);
  await expect(rule.locator('.dr-rule.is-on b')).toHaveText('Limits key on the API key');
});

test('a paused search stops its caret, and a paused tour stops its waveform', async ({ page }) => {
  await stoppedClock(page);
  await page.goto('/');
  const reach = page.locator('.reach');
  await reach.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 690);
  await page.clock.runFor(140);
  await reach.getByRole('button', { name: 'Pause the examples' }).click();
  const caret = reach.locator('.sq-caret');
  await expect.poll(() => caret.evaluate((el) => el.getAnimations().map((a) => a.playState).join(','))).toBe('paused');
  // the caret is still off screen too
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(reach.locator('.reach-card[data-search]')).toHaveClass(/is-still/);
  const news = page.locator('.new');
  await news.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.mouse.move(5, 690);
  await news.getByRole('button', { name: 'Pause the tour of what is new' }).click();
  // pick Voice again while paused: its waveform starts over, and it must be held, not running
  await news.getByRole('tab', { name: 'Guided asks' }).click();
  await news.getByRole('tab', { name: 'Voice' }).click();
  await page.mouse.move(5, 690);
  const wave = news.locator('.av-wave i').first();
  const states = await wave.evaluate((el) => el.getAnimations().map((a) => a.playState));
  expect(states.length, 'the waveform has an animation to hold').toBeGreaterThan(0);
  expect(states.every((st) => st === 'paused'), states.join(',')).toBe(true);
});

test('opening the Experiments menu with the mouse hides the button tooltip over it', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('#projectsBtn');
  await btn.hover();
  const tipOpacity = () => page.locator('.topbar .dropdown-wrap[data-tip]').evaluate((el) => getComputedStyle(el, '::after').opacity);
  await expect.poll(tipOpacity).toBe('1');
  await btn.click();
  await expect(page.locator('#projectsMenu')).toBeVisible();
  await expect.poll(tipOpacity).toBe('0');
});

test.describe('Watch a job on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('brings the demo in below the topbar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Watch a job/ }).click();
    await page.waitForTimeout(1200);
    const top = await page.locator('[data-ide]').evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(64);
    await expect(page.locator('[data-demo-note]')).toBeInViewport();
  });
});
