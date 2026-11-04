import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The install copy buttons + the page's honest-boundary copy.
 * Clipboard permissions granted; 127.0.0.1 is a secure context.
 */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('install copy buttons', () => {
  test('bundled serve copy button copies the command and shows feedback', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByRole('button', { name: 'Copy the bundled serve command' });
    await bringIntoView(btn);
    await btn.click();

    await expect(btn).toHaveText('Copied');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('npx wicked-crew serve');

    // Feedback resets after ~1.4s.
    await expect(btn).toHaveText('Copy');
  });

  test('standalone copy button copies both commands', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByRole('button', { name: 'Copy the standalone build commands' });
    await bringIntoView(btn);
    await btn.click();

    await expect(btn).toHaveText('Copied');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('VITE_API_HOST=127.0.0.1:7701 npm run build\nnpx serve dist');

    await expect(btn).toHaveText('Copy');
  });
});

test.describe('honest boundaries', () => {
  test('studio is a pure client and grades nothing', async ({ page }) => {
    await page.goto('/');

    const get = page.locator('.get');
    await bringIntoView(get);
    await expect(get).toContainText('pure client');
    await expect(get).toContainText('wicked-crew-api-types');

    // Review is crew's: the skin surfaces it, never grades it.
    const review = page.locator('.review');
    await bringIntoView(review);
    await expect(review).toContainText('never grades anything');
    await expect(review.getByRole('link', { name: 'crew’s' })).toHaveAttribute('href', 'https://wc.wickedagile.com');
    await expect(review).toContainText('reduced assurance');

    // Knowledge is estate's.
    await expect(page.locator('.steer').getByRole('link', { name: 'wicked-estate' })).toHaveAttribute(
      'href',
      'https://we.wickedagile.com',
    );
  });

  test('the demo says it is a demo', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-demo-note]')).toContainText('scripted demo');
  });
});

test.describe('the reviewed messaging', () => {
  test('the headline names studio an ADE and spells it out on first use (messaging N2)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero h1')).toHaveText('The ADE for running a team of coding agents.');
    await expect(page.locator('.hero h1 abbr')).toHaveAttribute('title', 'agentic development environment');
    // the spelled-out form reads before the abbreviation, on the first screen
    const kick = page.locator('.hero .hero-kick');
    await expect(kick).toBeVisible();
    await expect(kick).toHaveText('Agentic development environment (ADE)');
    const order = await page.evaluate(() => {
      const k = document.querySelector('.hero .hero-kick')!;
      const h = document.querySelector('.hero h1')!;
      return k.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order, 'the kicker comes before the headline').toBeTruthy();
    await expect(page).toHaveTitle('wicked-studio — the ADE for running a team of coding agents');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^The agentic development environment \(ADE\) for running a team of coding agents\./);
    // the old word is gone from the page, the title and the description. The platform band is
    // wicked-web's shared family copy (family.js), which moves to ADE in its own change.
    const text = [
      await page.evaluate(() => {
        const b = document.body.cloneNode(true) as HTMLElement;
        b.querySelectorAll('.same-garden').forEach((n) => n.remove());
        return b.textContent || '';
      }),
      await page.title(),
      (await page.locator('meta[name="description"]').getAttribute('content')) ?? '',
    ].join(' ');
    expect(text).not.toMatch(/\bIDE\b/);
    // the pattern itself catches the old headline, or this asserts nothing
    expect('The IDE for running a team of coding agents.').toMatch(/\bIDE\b/);
  });

  test('rules reach every repository or one project, never one repo', async ({ page }) => {
    await page.goto('/');
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    // There is no per-repo rule target: rules apply everywhere or to one project, and can
    // target a language, layer or framework (core crates/wicked-governance/src/conformance.rs).
    expect(body).not.toMatch(/\b(?:one|single)\s+repo(?:sitory)?\b|\bper[- ]repo\b/i);
    // the pattern itself must catch the old copy, or this test asserts nothing
    expect('everywhere, one project or one repo').toMatch(/\b(?:one|single)\s+repo(?:sitory)?\b|\bper[- ]repo\b/i);
    await expect(page.locator('.steer')).toContainText('a language, a layer or a framework');
  });

  test('the first screen: the default-review small print, the agents and the one command; then three benefits, what is new, what is coming', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero .hero-fine')).toContainText('By default a different agent reviews the work.');
    await expect(page.locator('.hero .hero-fine')).toContainText('reduced assurance');
    await expect(page.locator('.hero .agent-row li')).toHaveText(['Claude Code', 'Codex', 'GitHub Copilot', 'OpenCode', 'Pi']);
    // the first screen says what studio is and where it runs (critic: "IDE" read as a desktop app)
    await expect(page.locator('.hero .cta-alt')).toContainText('One command on your machine starts the wicked-crew daemon');
    await expect(page.locator('.hero .cta-alt')).toContainText('serves studio in your browser');
    await expect(page.locator('.hero .cta-copy')).toContainText('npx wicked-crew serve');
    const why = page.locator('.why');
    // the benefits frame has a visible heading now (it was sr-only)
    await expect(why.getByRole('heading', { level: 2, name: 'What studio does for you' })).toBeVisible();
    await expect(why.locator('.trio-card')).toHaveCount(3);
    const news = page.locator('.new');
    await expect(news.getByRole('tab')).toHaveCount(8);
    await expect(news.getByRole('tabpanel', { includeHidden: true })).toHaveCount(8);
    await expect(news.getByRole('heading', { level: 2 })).toHaveText('What’s new in 0.15');
    const soon = news.locator('.soon');
    await expect(soon).toContainText('Coming soon:');
    await expect(soon).toContainText('GitLab and Azure DevOps trackers');
    // what shipped in 0.15 (Apps, New job's catalog) is never "coming soon"; nor is a design that is not built
    await expect(soon).not.toContainText(/\bApps\b|catalog/i);
    await expect(soon).not.toContainText(/20\d\d|Q[1-4]/);
  });

  test('acceptance testing names its five kinds of job', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.review .facts')).toContainText(
      'a feature, bug fix, migration, MCP server or editor plugin need acceptance testing (QE)',
    );
  });

  test('the example receipt matches the example job: a chat build requires no QE acceptance', async ({ page }) => {
    await page.goto('/');
    const receipt = page.locator('.review .receipt');
    await expect(receipt.getByRole('row', { name: /Required/ })).not.toContainText('QE');
    await expect(receipt.getByRole('row', { name: /Ran/ })).not.toContainText('QE');
  });

  test('one agent signed in: the build runs and the job holds at review; nothing is skipped', async ({ page }) => {
    await page.goto('/');
    const rv = (k: number) => page.locator('.review .receipt tbody tr').nth(k).locator('.rv-one');
    await expect(rv(1)).toHaveText('the build; then the job held at review');
    await expect(rv(3)).toHaveText('nobody yet: no second agent');
    await expect(rv(4)).toHaveText('nothing: the job waits');
    const stop = page.locator('.review .relay-stop');
    await expect(stop).toContainText('Held.');
    await expect(stop).toContainText('Sign in a second agent, or launch it again as reduced assurance');
    expect(await page.locator('.review .receipt').innerText()).not.toMatch(/Skipped\s*review|stopped before review/i);
  });

  test('rules are suggested by Learn, never by an agent; the Agents box is explained before it is named', async ({ page }) => {
    await page.goto('/');
    const from = page.locator('.steer [data-drawer="rule"] .dr-from');
    await expect(from).toHaveCount(3);
    for (const t of await from.allTextContents()) expect(t).toMatch(/^Suggested by Learn, from your /);
    // DECISIONS N3: the benefit first, then the on-screen name
    const access = page.getByRole('tabpanel', { name: 'What agents can read', includeHidden: true });
    await expect(access.locator('p').first()).toHaveText(
      'Decide what agents may read from each database: its structure, its rows, and for which projects. Jobs and chats read it only in the projects you tick, or everywhere once you choose “Every project”.',
    );
    // the switches are a SQL source's (studio's Agents box), with their defaults; rows are Postgres-only in
    // this release and go to the agent's model provider; Ask's rows are the person's only
    const box = access.locator('p').nth(1);
    await expect(box).toContainText('The Agents box on a SQL source');
    await expect(box).toContainText('see the structure (on)');
    await expect(box).toContainText('query the rows (off; Postgres only');
    await expect(box).toContainText('rows go to the agent’s model provider');
    await expect(box).toContainText('the projects (none until you tick one)');
    const ask = page.locator('.new').getByRole('tabpanel', { name: 'Data sources', includeHidden: true });
    // Ask is the person's own act, and it hands one agent the structure (whatever the Agents box says)
    await expect(ask).toContainText('Ask a question of this data hands one agent the structure alone');
    await expect(ask).toContainText('The rows are shown to you only.');
  });
});

test.describe('the reviewed messaging, details', () => {
  test('the demo strip and the explorer list the 0.15 sidebar pages in order, Learn at the foot', async ({ page }) => {
    await page.goto('/');
    const PAGES = ['Projects', 'Jobs', 'Apps', 'Repositories', 'Data sources', 'Report', 'Understand', 'Evaluate', 'Steering', 'Memory', 'Agents', 'Learn'];
    await expect(page.locator('.ide-tabs span')).toHaveText(PAGES);
    await expect(page.locator('.explorer [role="tab"]')).toHaveText(PAGES);
    // the "Start here" mark went with Learn's move to the foot (Home does the first run)
    await expect(page.locator('.explorer')).not.toContainText('Start here');
    await expect(page.locator('.explorer [role="tab"][aria-selected="true"]')).toHaveText('Projects');
    // the Desk and Steering trio name pages, never the old tabs
    await expect(page.locator('.trio-where').first()).toHaveText('Steering page');
    await expect(page.locator('body')).not.toContainText(/\b(Steer|Memory) tab\b/);
  });

  test('the Claude subscription token exception is stated where keys are, in the approved words', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.reach')).toContainText(
      'A Claude subscription’s sign-in token is the one exception, and a guard keeps it out of the delivered work.',
    );
    // "seat" is not a public word (COPY rev 5)
    expect((await page.locator('body').innerText())).not.toMatch(/\bseats?\b/i);
  });

  test('wherever voice appears, the privacy line sits beside it (N6)', async ({ page }) => {
    await page.goto('/');
    const N6 = 'Speech is turned into text on your machine, and the audio is never stored.';
    // the hero's "or talk to them"
    await expect(page.locator('.hero .lede')).toContainText('or talk to them');
    await expect(page.locator('.hero .hero-voice')).toHaveText('Voice needs whisper.cpp. ' + N6);
    // the Voice mode chip
    await expect(page.locator('.desk .extras')).toContainText('Voice mode');
    // the Desk extras list only what the capability matrix backs (voice mode C34, the themes C41):
    // no command palette, keyboard batch triage or desktop alerts
    await expect(page.locator('.desk .extras li')).toHaveText(['Voice mode', 'Wicked Light, Wicked Dark and Ambient themes']);
    await expect(page.locator('body')).not.toContainText(/command palette|batch triage|desktop alerts/i);
    await expect(page.locator('.desk .voice-note')).toContainText(N6);
  });
});

test.describe('the Copy chips', () => {
  for (const vp of [{ width: 1440, height: 700 }, { width: 390, height: 844 }]) {
    test(`each Copy label sits in the middle of its chip @ ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const off = await page.locator('.cta-copy-l, .install__copy span').evaluateAll((ls) => ls.map((l) => {
        const chip = l.closest('.cta-copy-l') ? l : l.closest('button')!;
        const r = chip.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(l);
        const t = Array.from(range.getClientRects()).find((x) => x.height > 0)!;
        return { text: l.textContent!.trim(), dy: Math.abs((t.top + t.bottom) / 2 - (r.top + r.bottom) / 2), dx: Math.abs((t.left + t.right) / 2 - (r.left + r.right) / 2) };
      }));
      expect(off.length).toBe(3);
      for (const o of off) {
        expect(o.dy, `"${o.text}" is ${o.dy.toFixed(1)}px off its chip's middle`).toBeLessThanOrEqual(1);
        expect(o.dx).toBeLessThanOrEqual(1);
      }
    });
  }
});
