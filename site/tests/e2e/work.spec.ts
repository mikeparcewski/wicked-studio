import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * Four kinds of product work [.work] — the orchestrator-IDE repositioning.
 *
 * The load-bearing claim is NOT "we do four things". It is the SCOPE BOUNDARY: three of the four
 * share the project, and only one carries the gate. A messaging panel of five audiences converged
 * on that specifically because any sentence fusing "four kinds of work" with "nothing approves
 * itself" silently extends governance to decks and demos — which is false. Verified in the tree:
 * DocumentCanvas, DocPanel and DemoWizard have zero gate references and call no gate API.
 *
 * So these tests guard the boundary as hard as the breadth. A page that lost the qualifier would
 * still look correct and would be selling something it does not do.
 */
test.describe('four kinds of work [.work]', () => {
  test('shows all four, each with its real surface count', async ({ page }) => {
    await page.goto('/');
    const sec = page.locator('section.work');
    await bringIntoView(sec);
    await expect(sec.locator('.work-card')).toHaveCount(4);
    // Weighting is stated QUALITATIVELY. The first draft published "17/7/4/2 surfaces"; an
    // adversarial pass pointed out src/components holds 109 .tsx files, so those numbers read as
    // an inventory and fail the first `ls` anyone runs. A number that loses a thirty-second check
    // costs more than the precision it bought.
    await expect(sec).toContainText('deepest surface here');
    await expect(sec).toContainText('thinnest surface here');
    await expect(sec).not.toContainText('17 surfaces');
  });

  test('exactly ONE card is marked gated, and it is the software one', async ({ page }) => {
    await page.goto('/');
    const gated = page.locator('.work-card--gated');
    await bringIntoView(gated);
    await expect(gated).toHaveCount(1);
    await expect(gated).toContainText('Code that clears twice');
    await expect(gated.locator('.work-k')).toContainText('gated');
  });

  test('states the boundary in words, not only in styling', async ({ page }) => {
    await page.goto('/');
    // Two feet by design: the scope boundary, then the dependency note. Target the boundary
    // one explicitly rather than `.first()`, so adding a third paragraph cannot silently re-point it.
    const foot = page.locator('.work-foot:not(.work-foot--deps)');
    await bringIntoView(foot);
    // An accent border is not a claim. The sentence is.
    await expect(foot).toContainText('covers code, and only code');
    // NOT "documents have no gates" — DocumentThread carries 39 gate references; an agent asks in
    // the thread and you answer there. What documents lack is the TWO-SIDED check, and saying it
    // the sloppy way would have put a false claim about the product on its own product page.
    await expect(foot).toContainText('Documents do have human gates');
    await expect(foot).toContainText('share the project');
  });

  test('the hero scopes the mechanism to code rather than to everything', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('wrote the code');
    await expect(page.locator('.lede')).toContainText('not that check');
  });
});

test.describe('mobile (390×844) · four kinds of work', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the grid stacks rather than widening the page', async ({ page }) => {
    await page.goto('/');
    const sec = page.locator('section.work');
    await bringIntoView(sec);
    await expect(sec.locator('.work-card')).toHaveCount(4);
    const overflow = await sec.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('claims the adversarial pass required', () => {
  test('attributes the work to the daemon and the service, not to studio', async ({ page }) => {
    await page.goto('/');
    // studio is a pure HTTP/WS client: exportWire.ts says "nothing in this module renders
    // anything", and the demo wizard posts an event rather than driving a browser. Copy that says
    // "studio exports" or "studio drives Playwright" claims capability that lives elsewhere.
    await expect(page.locator('.lede')).toContainText('daemon behind it drives');
    await expect(page.locator('section.work')).toContainText('the document service does the rendering');
    await expect(page.locator('section.work')).not.toContainText('drives Playwright');
  });

  test('names the dependency that gates three of the four modes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.work-foot--deps')).toContainText('require wicked-garden present');
  });
});
