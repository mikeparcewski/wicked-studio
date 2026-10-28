import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Rail interaction states (operator 2026-10-26: "give all of them hover effects"): every rail item has
 * a hover, a pressed state and a keyboard focus ring; the pressed and current looks are not the hover
 * look; transitions are 120–160 ms; under reduced motion nothing moves. The rules live in one block at
 * the end of sections/rail.css. These are rule checks only: whether a person can SEE the hover is
 * measured in a real browser, every item in all four themes (e2e/desk_rail_hover_test.py).
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
    const currents = all.filter((r) => r.selector.includes('[aria-current="page"]') && !/:(hover|active|focus-visible)/u.test(r.selector) && r.body.includes('background:'));
    expect(currents.length).toBeGreaterThan(0);
    // The accent wash; the sidebar's page items (ui-v2 nav) fill a stronger accent share than their hover.
    // The wordmark (the link Home, operator 2026-10-27) stays quiet when current: no fill at rest.
    expect(currents.every((r) => r.body.includes('var(--accent-wash)') || r.selector.includes('.wk-rail-nav-item')
      || (r.selector.includes('.wk-rail-wordmark') && /background:\s*none/u.test(r.body)))).toBe(true);
    const current = all.find((r) => r.selector === '.wk-rail .wk-rail-nav-item[aria-current="page"]')?.body ?? '';
    const hoverToken = /--rail-hover-bg:\s*color-mix\(in oklab, var\(--accent\) (\d+)%/u.exec(css)?.[1];
    expect(all.find((r) => r.selector === '.wk-rail .wk-rail-nav-item:hover')?.body).toContain('var(--rail-hover-bg)');
    expect(Number(/var\(--accent\) (\d+)%/u.exec(current)?.[1])).toBeGreaterThan(Number(hoverToken));
    expect(currents.some((r) => r.body.includes('var(--rail-hover-bg'))).toBe(false);
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
    // `text-transform` (a label's case) is not movement.
    for (const r of rules(block)) if (/(^|[;{\s])transform\s*:/u.test(r.body)) expect(r.media).toMatch(/prefers-reduced-motion:\s*no-preference/u);
    const reduce = rules(block).filter((r) => r.media !== null && /prefers-reduced-motion:\s*reduce/u.test(r.media));
    expect(reduce.length).toBeGreaterThan(0);
    expect(reduce.every((r) => /transition-property:/u.test(r.body) && !r.body.includes('transform'))).toBe(true);
  });
});

/**
 * The Nerve Center tile keeps its state colour: hover and pressed swap its fill for the tone's own
 * --nc-<tone>-hover / -press token (each AA for the tile's words: tests/nerveCenterContrast.test.ts),
 * and no filter repaints it (a brightness() filter would move the words with the fill).
 */
describe('the Nerve Center tile hovers and presses through its own state tokens', () => {
  const nerve = rules(readFileSync(join(__dirname, '..', 'src', 'styles', 'sections', 'nerve.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, ''));
  const body = (rs: Rule[], sel: string): string => rs.filter((r) => expand(r.selector).includes(sel)).map((r) => r.body).join(';');
  it('every tone maps --nc-hover and --nc-press to its own tokens', () => {
    expect(body(nerve, '.wk-nc-tile')).toMatch(/--nc-hover:\s*var\(--nc-warn-hover\);\s*--nc-press:\s*var\(--nc-warn-press\)/u);
    expect(body(nerve, '.wk-nc-tile[data-tone="green"]')).toMatch(/--nc-hover:\s*var\(--nc-ok-hover\);\s*--nc-press:\s*var\(--nc-ok-press\)/u);
    expect(body(nerve, '.wk-nc-tile[data-tone="red"]')).toMatch(/--nc-hover:\s*var\(--nc-fail-hover\);\s*--nc-press:\s*var\(--nc-fail-press\)/u);
  });
  it('the rail paints them on hover and press, with no filter anywhere', () => {
    expect(body(all, '.wk-rail .wk-nc-tile:hover')).toMatch(/background:\s*var\(--nc-hover\)/u);
    expect(body(all, '.wk-rail .wk-nc-tile:active')).toMatch(/background:\s*var\(--nc-press\)/u);
    for (const r of [...all, ...nerve]) if (expand(r.selector).some((sel) => sel.includes('.wk-nc-tile'))) expect(r.body).not.toMatch(/(^|;)\s*filter:/u);
  });
});
