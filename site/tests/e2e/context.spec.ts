import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * A project is a context [.ctx] — the multi-repo code graph (crew 0.7.0).
 *
 * The claim the section exists to make is NOT "we federate your repos". It is the pair: one query
 * reaches every member repo, AND edges do not resolve across them. A site that shipped only the
 * first half would be selling a cross-repo dependency trace, which this is not — so the limit is
 * asserted here as hard as the capability, and it is asserted as VISIBLE TEXT rather than as
 * markup that happens to exist.
 */
test.describe('a project is a context [.ctx]', () => {
  test('states the capability and names the repos a single query reaches', async ({ page }) => {
    await page.goto('/');
    const sec = page.locator('section.ctx');
    await bringIntoView(sec);
    await expect(sec).toBeVisible();

    await expect(sec.locator('h2')).toContainText('context');
    // The concrete result, not an adjective: one query, three repos, attributed.
    const cards = sec.locator('.ctx-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('wicked-core');
    await expect(cards.first()).toContainText('wicked-crew');
    await expect(cards.first()).toContainText('wicked-studio');
    await expect(cards.first()).toContainText('Rust and TypeScript');
  });

  test('ships the LIMIT as prominently as the capability — co-located is not linked', async ({ page }) => {
    await page.goto('/');
    const limit = page.locator('.ctx-card--limit');
    await bringIntoView(limit);
    await expect(limit).toBeVisible();

    // The exact sentence a reader must leave with, and the wire field that proves it is not
    // marketing: a consumer can check `linkage` at runtime.
    await expect(limit).toContainText('Co-located is not linked');
    await expect(limit).toContainText('do');
    await expect(limit).toContainText('not');
    await expect(limit).toContainText('linkage');
    await expect(limit).toContainText('co-located');
  });

  test('does not oversell: the refresh cost and the version floor are both stated', async ({ page }) => {
    await page.goto('/');
    const foot = page.locator('.ctx-foot');
    await bringIntoView(foot);
    // Ten minutes PER MEMBER is why a refresh is never implicit — omitting it would make the
    // feature sound free, and the first person to run it on a large project would find out
    // otherwise at the worst moment.
    await expect(foot).toContainText('ten minutes');
    await expect(foot).toContainText('wicked-estate ≥ 0.14.6');
  });
});

test.describe('mobile (390×844) · the context section', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('renders on a phone with all three cards and no sideways scroll', async ({ page }) => {
    await page.goto('/');
    const sec = page.locator('section.ctx');
    await bringIntoView(sec);
    await expect(sec).toBeVisible();
    await expect(sec.locator('.ctx-card')).toHaveCount(3);

    // The grid is auto-fit; on a 390px viewport it must stack rather than overflow. The page-wide
    // overflow test covers the document — this pins the SECTION, so a later change here cannot
    // widen the page and be blamed on something else.
    const overflow = await sec.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
