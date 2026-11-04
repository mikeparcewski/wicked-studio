import { expect, type Page } from '@playwright/test';

/* The offscreen kit: every interactive stops when nobody can see it and never moves the page.
 *
 * For one interactive (its root selector and the length of one of its cycles):
 * - place(): put the root on screen, off screen, or peeking in at an edge under the quarter that
 *   makes it live;
 * - watch(): from now on, count every DOM change in the root (a MutationObserver over its subtree;
 *   an attribute written back with the value it already had is not a change),
 *   and remember the page's scrollY and the focused element;
 * - read(): what changed since watch(), plus the root's running animations (CSS, SVG and Web
 *   Animations, pseudo-elements included).
 */

export const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
];

export type Where = 'on' | 'off' | 'edge';

/** Scroll the page (instantly, without waiting) so the root is on screen, well clear of it, or showing
 *  at most a tenth of the window at one edge. */
export async function scrollFor(page: Page, sel: string, where: Where): Promise<void> {
  await page.evaluate(({ sel, where }) => {
    // an animation the page lands on its end on purpose (finish(), when it holds) is told apart from one that ran
    const A = Animation.prototype as unknown as { finish: () => void; __offHooked?: boolean };
    if (!A.__offHooked) {
      const finish = A.finish;
      A.finish = function (this: Animation & { __offSettled?: boolean }) { this.__offSettled = true; return finish.call(this); };
      A.__offHooked = true;
    }
    const el = document.querySelector(sel) as HTMLElement;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const top = r.top + window.scrollY, bottom = r.bottom + window.scrollY;
    const max = document.documentElement.scrollHeight - vh;
    const bar = (document.querySelector('header, .topbar') as HTMLElement | null)?.getBoundingClientRect().height ?? 64;
    let y: number;
    if (where === 'on') y = r.height + bar + 16 <= vh ? top - bar - Math.max(8, (vh - bar - r.height) / 2) : top - bar - 8;
    // off: well clear of it, so a snapping page that rounds to the nearest frame cannot bring it back
    else if (where === 'off') y = bottom + vh * 0.6 <= max ? bottom + vh * 0.6 : top - vh * 1.6;
    // peek: a tenth of the window (or 15% of a root shorter than two thirds of it), at the bottom edge
    // when there is room above the root, else at the top
    else { const peek = Math.min(vh * 0.1, r.height * 0.15); y = top >= vh - peek ? top - vh + peek : bottom - peek; }
    window.scrollTo({ top: Math.max(0, Math.min(max, Math.round(y))), behavior: 'instant' as ScrollBehavior });
  }, { sel, where });
}

/** Wait until scrollY holds for 200ms, up to 3s: a snapping page lands a moment after a scroll (later on a
 *  loaded machine). */
export async function settleScroll(page: Page): Promise<void> {
  for (let t = 0, y = await page.evaluate(() => window.scrollY); t < 3000; t += 200) {
    await page.waitForTimeout(200);
    const y2 = await page.evaluate(() => window.scrollY);
    if (y2 === y) break;
    y = y2;
  }
}

/** The share of the root on screen: of the root, or of the window for a root taller than it. */
export async function shareOf(page: Page, sel: string): Promise<number> {
  return page.evaluate((sel) => {
    const r = (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
    const seen = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return Math.max(seen / Math.max(1, r.height), seen / innerHeight);
  }, sel);
}

/** scrollFor, then let the observers report and the page come to rest. Returns the root's share. */
export async function place(page: Page, sel: string, where: Where): Promise<number> {
  await scrollFor(page, sel, where);
  await page.waitForTimeout(450);
  await settleScroll(page);
  return shareOf(page, sel);
}

/** Wait `n` rendering frames: the observers report on the frame after a scroll. */
export async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate((n) => new Promise<void>((done) => { const f = (k: number) => (k ? requestAnimationFrame(() => f(k - 1)) : done()); f(n); }), n);
}

/** Every animation in the root now, and where it is: one that moves on afterwards ran (unless the page
 *  finished it on purpose), even if it has finished by the end of the window. */
export async function snapAnimations(page: Page, sel: string): Promise<void> {
  await page.evaluate((sel) => {
    const w = window as unknown as Record<string, unknown>;
    w.__offAn = (document.querySelector(sel) as HTMLElement).getAnimations({ subtree: true }).map((a) => [a, a.currentTime]);
  }, sel);
}

export async function watch(page: Page, sel: string, anims = true): Promise<void> {
  if (anims) await snapAnimations(page, sel);
  await page.evaluate((sel) => {
    const w = window as unknown as Record<string, unknown>;
    (w.__offMo as MutationObserver | undefined)?.disconnect();
    w.__offN = 0;
    w.__offY = window.scrollY;
    w.__offFocus = document.activeElement;
    w.__offYs = [] as number[];
    clearInterval(w.__offIv as number);
    w.__offIv = setInterval(() => (w.__offYs as number[]).push(window.scrollY), 50);
    // a change is a node added or removed, or a value that ends a batch different from how it began (a
    // framework re-render that writes an attribute back to the value it had, or sets and removes it, changes
    // nothing on screen)
    const count = (rs: MutationRecord[]) => {
      let n = 0;
      const began = new Map<Node, Map<string, string | null>>();
      for (const r of rs) {
        if (r.type === 'childList') { n++; continue; }
        const per = began.get(r.target) ?? new Map<string, string | null>();
        began.set(r.target, per);
        const key = r.attributeName ?? '#text';
        if (!per.has(key)) per.set(key, r.oldValue);
      }
      began.forEach((per, node) => per.forEach((was, key) => {
        const now = key === '#text' ? node.nodeValue : (node as Element).getAttribute(key);
        if (now !== was) n++;
      }));
      return n;
    };
    const mo = new MutationObserver((rs) => { w.__offN = (w.__offN as number) + count(rs); });
    mo.observe(document.querySelector(sel) as Node, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
    w.__offMo = mo;
  }, sel);
}

/** Restart the page-movement baseline (after a snapping page has come to rest). */
export async function markScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__offY = window.scrollY;
    w.__offYs = [] as number[];
  });
}

export interface Seen { mutations: number; running: number; advanced: number; moved: number; focusMoved: boolean; scrollY: number }

export async function read(page: Page, sel: string, animSel = sel): Promise<Seen> {
  return page.evaluate(({ sel, animSel }) => {
    const w = window as unknown as Record<string, unknown>;
    const el = document.querySelector(animSel) as HTMLElement;
    const ys = (w.__offYs as number[]).concat([window.scrollY]);
    const y0 = w.__offY as number;
    const t = (v: CSSNumberish | null) => (typeof v === 'number' ? v : v === null ? null : Number(v));
    const before = (w.__offAn as [Animation, CSSNumberish | null][]) ?? [];
    const known = new Set(before.map(([a]) => a));
    const ran = (a: Animation) => !(a as Animation & { __offSettled?: boolean }).__offSettled;
    const advanced = before.filter(([a, at]) => { const was = t(at), now = t(a.currentTime); return ran(a) && was !== null && now !== null && now > was + 1; }).length +
      el.getAnimations({ subtree: true }).filter((a) => !known.has(a) && a.playState === 'running' && (t(a.currentTime) ?? 0) > 1).length;
    return {
      mutations: w.__offN as number,
      running: el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
      advanced,
      moved: Math.max(...ys.map((y) => Math.abs(y - y0))),
      focusMoved: document.activeElement !== w.__offFocus,
      scrollY: window.scrollY,
    };
  }, { sel, animSel });
}

/** Wait until the root changes, up to `ms`. A root whose only motion is CSS loops (`css`) counts its
 *  running animations instead. */
export async function waitForMotion(page: Page, sel: string, ms: number, css = false): Promise<Seen> {
  await watch(page, sel);
  const t0 = Date.now();
  let s = await read(page, sel);
  while ((css ? s.running : s.mutations) === 0 && Date.now() - t0 < ms) {
    await page.waitForTimeout(100);
    s = await read(page, sel);
  }
  return s;
}

/** Wait until the hold has written its marks: the root has been quiet for 200 ms (at most 2 s; a framework
 *  commits later on a loaded machine). */
export async function quiet(page: Page, sel: string): Promise<void> {
  await watch(page, sel, false);
  const t0 = Date.now();
  let n = -1;
  while (Date.now() - t0 < 2000) {
    await page.waitForTimeout(200);
    const m = (await read(page, sel)).mutations;
    if (m === n) break;
    n = m;
  }
}

/** Off screen (or under the quarter at an edge) for at least two cycles: nothing changes in the
 *  root, nothing in it animates, the page does not move and focus stays where it was. `sel` is what
 *  is placed; `root` (by default the same) is what is watched, e.g. the whole island around a stage;
 *  `animRoot` (by default `root`) is where animations are watched, when the DOM is watched more widely
 *  (an island whose page-entrance wrappers are not the block). */
export async function expectStill(page: Page, sel: string, cycle: number, where: Where, label: string, root = sel, animRoot = root): Promise<void> {
  await scrollFor(page, sel, where);
  // animations, from the hold boundary (the observers' delivery, two frames after the scroll): nothing may
  // move on from here unless the page lands it on purpose
  await frames(page, 2);
  await snapAnimations(page, animRoot);
  // the DOM, once the hold itself has written its marks (a framework re-render included)
  await quiet(page, root);
  await watch(page, root, false);
  await settleScroll(page);
  const share = await shareOf(page, sel);
  expect(share, `${label}: ${where} placement shows ${share.toFixed(2)} of it`).toBeLessThan(0.2);
  await markScroll(page);
  await page.waitForTimeout(Math.max(2 * cycle + 300, 2000));
  const s = await read(page, root, animRoot);
  expect(s.moved, `${label}: the page moved by itself while it was ${where} screen`).toBeLessThanOrEqual(1);
  expect(s.focusMoved, `${label}: focus moved while it was ${where} screen`).toBe(false);
  expect(s.mutations, `${label}: DOM changes while it was ${where} screen`).toBe(0);
  expect(s.running, `${label}: animations running while it was ${where} screen`).toBe(0);
  expect(s.advanced, `${label}: animations that moved on while it was ${where} screen`).toBe(0);
}

/** True when the page snaps every scroll to a frame (CSS mandatory snapping): a root cannot be left
 *  peeking in at an edge there, so the edge case does not apply. */
export async function snaps(page: Page): Promise<boolean> {
  return page.evaluate(() => /mandatory/.test(getComputedStyle(document.documentElement).scrollSnapType));
}

/** Fake a hidden (or visible again) tab: the page sees document.hidden and a visibilitychange. */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  // let a framework re-render settle (the hold itself lands at once)
  await page.waitForTimeout(300);
}
