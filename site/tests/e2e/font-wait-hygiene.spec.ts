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

/**
 * Blank out comments and string/template literals, preserving length and newlines so byte
 * offsets still map to the right line. Without this the scan reports prose: a line inside a
 * block comment quoting the bad form, or a string constant containing the phrase, both read as
 * code to a bare regex. Copilot flagged exactly that on this file.
 */
function codeOnly(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      blank(i, end === -1 ? src.length : end + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const quote = src[i];
      let k = i + 1;
      while (k < src.length && src[k] !== quote) k += src[k] === '\\' ? 2 : 1;
      blank(i, k + 1);
      i = k + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/**
 * An evaluate callback that hands `document.fonts.ready` back to the runner: either an
 * expression-bodied arrow (`=> document.fonts.ready`) or an explicit `return`. The fixed form,
 * `async () => { await document.fonts.ready; }`, matches neither — the `await` sits between.
 *
 * Applied to the WHOLE file rather than line by line, because the line-based version missed the
 * multi-line spelling entirely:
 *
 *     await page.evaluate(() =>
 *       document.fonts.ready
 *     );
 *
 * which is the same defect in a plausible reformatting of a long line.
 */
const RETURNS_FONT_SET = /(?:=>|\breturn\b)\s*document\s*\.\s*fonts\s*\.\s*ready/g;

test('no spec returns document.fonts.ready out of page.evaluate', () => {
  const files = readdirSync(HERE)
    .filter((f) => f.endsWith('.ts') && f !== SELF)
    .sort();
  // A scan that silently found nothing to read would pass forever. Prove it read something —
  // but do not couple to today's suite size, or trimming the suite reds CI for no reason.
  expect(files.length, 'the font-wait scan found no spec files to read').toBeGreaterThan(0);

  const offenders: string[] = [];
  for (const name of files) {
    const raw = readFileSync(join(HERE, name), 'utf8');
    const scanned = codeOnly(raw);
    for (const m of scanned.matchAll(RETURNS_FONT_SET)) {
      const line = scanned.slice(0, m.index).split('\n').length;
      offenders.push(`${name}:${line}: ${raw.split('\n')[line - 1].trim()}`);
    }
  }

  expect(
    offenders,
    'these return a FontFaceSet across the CDP boundary — await it inside the page instead:\n' +
      '  await page.evaluate(async () => { await document.fonts.ready; });\n' +
      offenders.map((o) => `  ${o}`).join('\n'),
  ).toEqual([]);
});

test('the scan reads code, not prose, and catches the multi-line spelling', () => {
  // Both directions, on synthetic input, so the guard's own accuracy is pinned rather than
  // assumed. These are the three cases review found it got wrong.
  const scan = (src: string) => [...codeOnly(src).matchAll(RETURNS_FONT_SET)].length;

  // FALSE POSITIVES it used to produce — all prose, none are code.
  expect(scan('/* await page.evaluate(() => document.fonts.ready); */'), 'block comment').toBe(0);
  expect(scan('const s = "() => document.fonts.ready";'), 'string literal').toBe(0);
  expect(scan('foo(); // () => document.fonts.ready'), 'trailing comment').toBe(0);

  // FALSE NEGATIVE it used to miss — real code, split across lines.
  expect(scan('await page.evaluate(() =>\n  document.fonts.ready\n);'), 'multi-line').toBe(1);

  // Still catches the single-line forms, and still allows the corrected one.
  expect(scan('await page.evaluate(() => document.fonts.ready);'), 'arrow').toBe(1);
  expect(scan('await page.evaluate(() => { return document.fonts.ready; });'), 'return').toBe(1);
  expect(scan('await page.evaluate(async () => { await document.fonts.ready; });'), 'fixed').toBe(0);
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
