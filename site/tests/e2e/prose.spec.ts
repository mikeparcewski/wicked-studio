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
    'launch it with reduced assurance, labelled everywhere',
    'need QE acceptance before they ship',
    'Studio is a pure client of crew’s /api/v1 and /ws',
    'the published contract, wicked-crew-api-types',
    'kept by wicked-estate',
  ];

  for (const phrase of mustRead) {
    expect(body, `"${phrase}" lost the space before its inline span`).toContain(phrase);
  }

  // And the fused forms must never appear.
  for (const fused of ['withreduced', 'needQE', 'crew’s/api', 'contract,wicked', 'bywicked']) {
    expect(body, `found the fused form "${fused}"`).not.toContain(fused);
  }
});
