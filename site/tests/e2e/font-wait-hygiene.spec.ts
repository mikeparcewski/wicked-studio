import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

/**
 * A font wait must not hand its result back across the CDP boundary.
 *
 * WHAT WAS WRONG. Four specs in this suite waited for webfonts like this:
 *
 *     await page.evaluate(() => document.fonts.ready);
 *
 * The arrow has an expression body, so it RETURNS the promise. Playwright awaits it in the page
 * and then serializes whatever it settled to — a `FontFaceSet`, which has no serializable form.
 * Measured against this site it does not throw; it round-trips a lossy `{}` (the second test
 * below pins that). That is the bad kind of bug: nothing fails, so nothing tells you the suite
 * is leaning on serializer behaviour nobody promised. These are the specs that guard the hero
 * fitting a laptop viewport, and a font wait that throws or returns early takes out the guard
 * rather than the thing it guards.
 *
 * The correct form awaits INSIDE the page and returns undefined:
 *
 *     await page.evaluate(async () => { await document.fonts.ready; });
 *
 * Reference fix: wicked-garden site/tests/e2e/band-fits.spec.ts, commit 52446c5b.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** This file quotes the anti-pattern as live code in the second test, so it cannot scan itself. */
const SELF = basename(fileURLToPath(import.meta.url));

/** An evaluate callback that hands `document.fonts.ready` back to the runner: either an
 *  expression-bodied arrow (`=> document.fonts.ready`) or an explicit `return`. The fixed form,
 *  `async () => { await document.fonts.ready; }`, matches neither. */
const RETURNS_FONT_SET = /(?:=>\s*|\breturn\s+)document\s*\.\s*fonts\s*\.\s*ready/;

test('no spec returns document.fonts.ready out of page.evaluate', () => {
  const files = readdirSync(HERE)
    .filter((f) => f.endsWith('.ts') && f !== SELF)
    .sort();
  // A scan that silently found nothing to read would pass forever. Prove it read the suite.
  expect(files.length, 'the font-wait scan found no spec files to read').toBeGreaterThan(5);

  const offenders: string[] = [];
  for (const name of files) {
    readFileSync(join(HERE, name), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return; // prose, not code
        if (RETURNS_FONT_SET.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      });
  }

  expect(
    offenders,
    'these return a FontFaceSet across the CDP boundary — await it inside the page instead:\n' +
      '  await page.evaluate(async () => { await document.fonts.ready; });\n' +
      offenders.map((o) => `  ${o}`).join('\n'),
  ).toEqual([]);
});

test('the two forms differ: one leaks a value, the corrected one returns undefined', async ({ page }) => {
  await page.goto('/');

  // The corrected form: nothing crosses the boundary.
  const clean = await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(clean, 'the corrected font wait should resolve to undefined').toBeUndefined();

  // The defective form, kept here as the executable record of what it does. It resolves to the
  // FontFaceSet, so Playwright has to serialize it; today that yields a lossy `{}` rather than
  // throwing. Either way it is not the clean `undefined` above — which is the whole point.
  let leaked: unknown;
  let threw = false;
  try {
    leaked = await page.evaluate(() => document.fonts.ready);
  } catch {
    threw = true;
  }
  expect(
    threw || leaked !== undefined,
    'returning document.fonts.ready is supposed to put a non-serializable FontFaceSet on the wire; ' +
      'if that has become a clean no-op, this guard has stopped guarding anything',
  ).toBe(true);
});
