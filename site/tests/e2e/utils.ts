import type { Locator } from '@playwright/test';

/**
 * Instant JS scroll that skips Playwright's "stable bounding box" wait.
 *
 * The page runs independent autoplay intervals (the console feed 0.7s/step,
 * the run-board cycle 3s) that keep shifting layout, so
 * `scrollIntoViewIfNeeded()` can starve on its stability check. Scrolling is
 * only needed to trigger the IntersectionObserver-armed widgets; subsequent
 * clicks/assertions perform their own actionability checks.
 */
export async function bringIntoView(loc: Locator): Promise<void> {
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
}
