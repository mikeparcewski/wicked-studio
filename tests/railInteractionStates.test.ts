import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Rail interaction states (operator 2026-10-26: "give all of them hover effects"): every rail item has
 * a hover, a pressed state and a keyboard focus ring; the pressed and current looks are not the hover
 * look; transitions are 120–160 ms; under reduced motion nothing moves. The rules live in one block at
 * the end of sections/rail.css. The look itself is checked in the browser (PR screenshots).
 */

const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'sections', 'rail.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule { selector: string; body: string; media: string | null }

/** Flat rules with the @media they sit in (one level of nesting is all rail.css uses). */
function rules(text: string, media: string | null = null): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith('@media')) out.push(...rules(body, head));
    else out.push({ selector: head, body, media });
    i = j;
  }
  return out;
}

/** The selectors a rule names, its `:is(...)` list expanded (one level), whitespace normalised. */
function expand(selector: string): string[] {
  return selector.split(/,(?![^(]*\))/u).flatMap((sel) => {
    const m = /:is\(([^)]*)\)/u.exec(sel);
    if (m === null) return [sel.trim()];
    return m[1]!.split(',').map((alt) => sel.replace(m[0], alt.trim()).trim());
  }).map((s) => s.replace(/\s+/gu, ' '));
}

const all = rules(css);
const items = ['.wk-rail-home', '.wk-rail-action', '.wk-rail-group-toggle', '.wk-rail-icon-btn', '.wk-rail-session', '.wk-rail-showmore', '.wk-rail-link', '.wk-nc-tile'];
const has = (item: string, state: string, media: string | null = null): Rule[] =>
  all.filter((r) => r.media === media && expand(r.selector).some((s) => s.startsWith('.wk-rail ') && s.includes(item) && s.endsWith(state)));

describe('every rail item has hover, pressed and focus-visible states', () => {
  for (const item of items) {
    it(`${item}: :hover changes the fill or brightness, :active differs from it, :focus-visible draws a ring`, () => {
      const hover = has(item, ':hover');
      expect(hover.length).toBeGreaterThan(0);
      expect(hover.some((r) => /background:|filter:/u.test(r.body))).toBe(true);
      const active = has(item, ':active');
      expect(active.length).toBeGreaterThan(0);
      // Pressed is never the hover look: its fill/filter is a different value.
      const fillOf = (rs: Rule[]): string[] => rs.flatMap((r) => [...r.body.matchAll(/(?:background|filter):\s*([^;]+);/gu)].map((m) => m[1]!.trim()));
      expect(fillOf(active).some((v) => !fillOf(hover).includes(v))).toBe(true);
      const focus = has(item, ':focus-visible');
      expect(focus.length).toBeGreaterThan(0);
      expect(focus.some((r) => /outline:\s*2px solid transparent/u.test(r.body) && /box-shadow:[^;]*(--focus-ring|--accent)/u.test(r.body))).toBe(true);
    });
  }

  it('the current page is not the hover look (the accent wash, not the hover tint)', () => {
    const current = all.filter((r) => r.selector.includes('[aria-current="page"]') && !/:(hover|active|focus-visible)/u.test(r.selector) && r.body.includes('background:'));
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((r) => r.body.includes('var(--accent-wash)'))).toBe(true);
  });
});

describe('motion', () => {
  it('transitions run 120–160 ms with an ease', () => {
    const t = all.filter((r) => /(^|;)\s*transition:/u.test(r.body));
    expect(t.length).toBeGreaterThan(0);
    for (const r of t) for (const m of r.body.matchAll(/(\d+)ms (ease[a-z-]*)/gu)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(120);
      expect(Number(m[1])).toBeLessThanOrEqual(160);
    }
  });

  it('movement (transform) only under prefers-reduced-motion: no-preference; reduce drops transform from the transition', () => {
    const start = css.indexOf('.wk-rail {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start);
    for (const r of rules(block)) if (r.body.includes('transform:')) expect(r.media).toMatch(/prefers-reduced-motion:\s*no-preference/u);
    const reduce = rules(block).filter((r) => r.media !== null && /prefers-reduced-motion:\s*reduce/u.test(r.media));
    expect(reduce.length).toBeGreaterThan(0);
    expect(reduce.every((r) => /transition-property:/u.test(r.body) && !r.body.includes('transform'))).toBe(true);
  });
});

/**
 * The Nerve Center tile's hover/pressed filters keep its words at AA (4.5:1) on every tone, in dark
 * (tokens.css, also wicked-dark) and light (themes/light.css, also wicked-light). Chromium applies
 * `brightness(k)` to the whole tile as a per-channel sRGB multiply, clamped — ink and fill alike
 * (measured: #c9302a under brightness(1.08) paints rgb(217, 52, 45)).
 */
describe('the Nerve Center tile stays AA under its hover and pressed filters', () => {
  const TONES = { green: 'ok', yellow: 'warn', red: 'fail' } as const;
  const tokens = (file: string): Record<string, string> => {
    const text = readFileSync(join(__dirname, '..', 'src', 'styles', file), 'utf8');
    return Object.fromEntries([...text.matchAll(/(--nc-[a-z]+-[a-z]+):\s*(#[0-9a-fA-F]{6})\s*;/gu)].map((m) => [m[1]!, m[2]!]));
  };
  const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c: number[]): number => {
    const l = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
  };
  const ratio = (a: number[], b: number[]): number => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };
  // The filter a tone gets in a state: nerve.css's own `.wk-nc-tile:hover` / `:active` first (it still
  // applies wherever no rail rule sets a filter), then the last matching rail.css rule wins (every
  // `.wk-rail .wk-nc-tile` rule out-ranks it).
  const nerve = rules(readFileSync(join(__dirname, '..', 'src', 'styles', 'sections', 'nerve.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, ''));
  const filterFor = (tone: string, state: ':hover' | ':active'): string => {
    let out = 'none';
    for (const r of nerve) if (expand(r.selector).includes(`.wk-nc-tile${state}`)) { const f = /filter:\s*([^;]+);/u.exec(r.body); if (f !== null) out = f[1]!.trim(); }
    for (const r of all) for (const sel of expand(r.selector)) {
      if (!sel.startsWith('.wk-rail .wk-nc-tile') || !sel.endsWith(state) || sel.includes('[aria-current')) continue;
      const only = /\[data-tone="([a-z]+)"\]/u.exec(sel.replace(/:not\([^)]*\)/gu, ''));
      const not = /:not\(\[data-tone="([a-z]+)"\]\)/u.exec(sel);
      if ((only !== null && only[1] !== tone) || (not !== null && not[1] === tone)) continue;
      const f = /filter:\s*([^;]+);/u.exec(r.body);
      if (f !== null) out = f[1]!.trim();
    }
    return out;
  };
  it('the white-ink red tile does not brighten on hover (only the dark-ink tones do)', () => {
    expect(filterFor('red', ':hover')).toBe('none');
    expect(filterFor('yellow', ':hover')).toMatch(/^brightness\(1\.0\d\)$/u);
  });
  for (const [theme, file] of [['dark', 'tokens.css'], ['light', 'themes/light.css']] as const) {
    const t = tokens(file);
    for (const [tone, key] of Object.entries(TONES)) for (const state of [':hover', ':active'] as const) {
      it(`${theme} ${tone} ${state}`, () => {
        const f = filterFor(tone, state);
        // Only brightness() is modelled; any other filter function must be added here first.
        expect(f === 'none' || /^brightness\([\d.]+\)$/u.test(f)).toBe(true);
        const k = f === 'none' ? 1 : Number(/[\d.]+/u.exec(f)![0]);
        const paint = (hex: string): number[] => rgb(hex).map((v) => Math.min(255, Math.round(v * k)));
        expect(ratio(paint(t[`--nc-${key}-fg`]!), paint(t[`--nc-${key}-bg`]!))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
