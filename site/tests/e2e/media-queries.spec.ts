import { test, expect } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Safari before 16.4 ignores media-query range syntax (`(width <= 760px)`), so on those iPhones the page keeps its
 * desktop layout. The build's CSS minifier rewrites max-width and min-width into that syntax unless the CSS targets
 * name an older Safari (astro.config.mjs, vite.build.cssTarget; wicked-web#63). This reads what ships: every
 * dist/**\/*.css and every inline <style> in dist/**\/*.html (run `npm run build` first).
 */
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
// A media query's prelude is the text between @media and its `{`, comments dropped (a commented-out rule is no rule, and
// a comment can hold a `{`). Range syntax is the only way a `<` or `>` gets there.
const preludes = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@media([^{]*)\{/gi)].map((m) => m[1].trim());
const ranged = (css: string) => preludes(css).filter((p) => /[<>]/.test(p));
const shippedCss = (file: string) => {
  const text = readFileSync(file, 'utf8');
  return file.endsWith('.html') ? [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') : text;
};

test('the range check catches each form the minifier writes, and passes min-width and max-width', () => {
  for (const css of ['@media (width<=760px){a{b:c}}', '@media (width >= 40rem) {', '@media (400px<=width<=800px){',
    '@media screen and (width>600px){', '@media (height<640px){', '@media (min-width:0),(width<1px){',
    '@media /* { */ (width <= 760px){body{color:red}}'])
    expect(ranged(css), css).toHaveLength(1);
  for (const css of ['@media (max-width:760px){', '@media (min-width: 40rem) and (max-width: 60rem) {',
    '@media (prefers-reduced-motion:no-preference){', '@media screen and (max-height:640px){',
    '/* @media (width > 760px) { } */ a{b:c}'])
    expect(ranged(css), css).toEqual([]);
});

test('the built CSS uses min-width and max-width, never range syntax Safari before 16.4 ignores (wicked-web#63)', () => {
  expect(existsSync(DIST), 'dist exists (run npm run build first)').toBe(true);
  const files = walk(DIST).filter((f) => /\.(css|html)$/.test(f));
  expect(files.some((f) => f.endsWith('.css')), 'the build ships a stylesheet').toBe(true);
  let read = 0;
  const bad: string[] = [];
  for (const f of files) {
    const css = shippedCss(f);
    read += preludes(css).length;
    for (const q of ranged(css)) bad.push(`${relative(DIST, f)}: @media ${q}`);
  }
  expect(read, 'the scan read media queries (or it checks nothing)').toBeGreaterThan(0);
  expect(bad).toEqual([]);
});
