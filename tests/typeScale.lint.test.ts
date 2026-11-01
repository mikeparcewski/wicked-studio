/**
 * THE TYPE SCALE, enforced (operator 2026-11-01, round 6: "the fonts look a little all over the map"). Six sizes
 * (caption 12, body 14, lead 16, section 20, title 28, code 13), two weights (400, 600), one tracking value (page
 * titles). Every font-size, font-weight and letter-spacing in studio's CSS and TSX is one of the tokens in
 * styles/tokens.css; this test fails on anything else.
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const walk = (dir: string, ext: RegExp): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return e.name === 'vendor' ? [] : walk(p, ext);
  return ext.test(e.name) ? [p] : [];
});
const rel = (p: string): string => p.slice(ROOT.length + 1);
const TOKEN = /^(var\(--(text|weight|tracking)-[a-z0-9-]+\)|inherit|unset|initial)(\s*!important)?$/u;

describe('the type scale tokens', () => {
  it('six sizes, two weights, one tracking value', () => {
    const t = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8');
    const px = (name: string): number => Number(new RegExp(`--text-${name}:\\s*(\\d+)px`, 'u').exec(t)?.[1]);
    expect(['caption', 'body', 'lead', 'section', 'title', 'code'].map(px)).toEqual([12, 14, 16, 20, 28, 13]);
    expect(/--weight-regular:\s*400;/u.test(t) && /--weight-strong:\s*600;/u.test(t)).toBe(true);
    expect([...t.matchAll(/--tracking-[a-z-]+:/gu)].length).toBe(1);
    // Every other size or weight token is an alias onto the scale, never a number of its own.
    for (const m of t.matchAll(/--(text-(?:2xs|xs|sm|md|base|lg|xl|2xl)|weight-(?:normal|medium|semi|bold)):\s*([^;]+);/gu)) {
      expect(m[2], m[1]).toMatch(/^var\(--(text|weight)-(caption|body|lead|section|title|regular|strong)\)$/u);
    }
  });
});

describe('studio CSS uses the scale only', () => {
  const files = walk(join(ROOT, 'src/styles'), /\.css$/u).filter((f) => !/[/\\]themes[/\\]/u.test(f) && !f.endsWith('tokens.css'));
  it('no raw font-size, font-weight or letter-spacing; no uppercase transform', () => {
    const bad: string[] = [];
    for (const f of files) {
      const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/@font-face\s*\{[^}]*\}/gu, '');
      for (const m of css.matchAll(/(font-size|font-weight|letter-spacing):\s*([^;}]+)/gu)) {
        if (!TOKEN.test(m[2]!.trim())) bad.push(`${rel(f)}: ${m[1]}: ${m[2]!.trim()}`);
      }
      for (const m of css.matchAll(/(?<![-\w])font:\s*([^;}]+)/gu)) {
        if (m[1]!.trim() !== 'inherit' && !/var\(--text-[a-z]+\)/u.test(m[1]!)) bad.push(`${rel(f)}: font: ${m[1]!.trim()}`);
      }
      if (/text-transform:\s*uppercase/u.test(css)) bad.push(`${rel(f)}: text-transform: uppercase`);
    }
    expect(bad).toEqual([]);
  });
});

describe('studio TSX uses the scale only', () => {
  const files = walk(join(ROOT, 'src'), /\.(tsx|ts)$/u);
  it('no arbitrary text-[Npx], tracking-* or uppercase classes; inline type styles are tokens', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/gu)) bad.push(`${rel(f)}: ${m[0]}`);
      for (const m of src.matchAll(/(?<=[\s"'`])(tracking-[a-z[\]0-9.-]+|uppercase)(?=[\s"'`])/gu)) bad.push(`${rel(f)}: ${m[0]}`);
      for (const m of src.matchAll(/\b(fontSize|fontWeight|letterSpacing):\s*([^,}\n]+)/gu)) {
        const v = m[2]!.trim().replace(/\s+as\s+.*$/u, ''); // a type cast is not a value
        // Every literal in the value is a token (a ternary between tokens, a cast onto a token).
        const literals = [...v.matchAll(/'[^']*'|"[^"]*"|\b\d+(?:\.\d+)?(?:px)?\b/gu)].map((x) => x[0]);
        if (literals.length > 0 && literals.every((x) => /^['"]var\(--(text|weight|tracking)-[a-z0-9-]+\)['"]$/u.test(x))) continue;
        if (m[1] === 'fontSize' && /resolveToken\('--text-code'\)/u.test(v)) continue; // xterm needs a number
        bad.push(`${rel(f)}: ${m[1]}: ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
