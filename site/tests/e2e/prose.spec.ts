import { test, expect } from '@playwright/test';

/**
 * Guard against words fusing to the bold/code span that follows them.
 *
 * Astro's `compressHTML` (on by default) does not collapse the whitespace between a text node and
 * a following inline element — it deletes it. Prose on this page wraps for readability, so any
 * sentence that happened to break right before a <b> or <code> shipped as a single mashed word:
 * "returns8 hits", "arebound to it", "spanningRust", "donot resolve", "studio'sdedicated".
 *
 * It is invisible in source review and invisible to any layout measurement — the section heights
 * are identical either way. Only reading the rendered page catches it, so it is pinned here.
 *
 * These assert on rendered text, so they fail for ANY cause (compressHTML re-enabled, a minifier
 * added to the pipeline, a hand-edit that drops the space), not just the one found.
 */
test('prose does not fuse words into the following bold or code span', async ({ page }) => {
  await page.goto('/');

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

  const mustRead = [
    'returns 8 hits',
    'project are bound to it',
    'spanning Rust and TypeScript',
    'edges do not resolve',
    'bounded at ten minutes each',
    'The studio’s dedicated project browser',
  ];

  for (const phrase of mustRead) {
    expect(body, `"${phrase}" lost the space before its inline span`).toContain(phrase);
  }

  // And the specific fused forms must never appear.
  for (const fused of ['returns8', 'arebound', 'spanningRust', 'donot', 'minuteseach']) {
    expect(body, `found the fused form "${fused}"`).not.toContain(fused);
  }
});
