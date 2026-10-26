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
