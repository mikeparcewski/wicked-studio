/**
 * studio#921: with a custom accent close to the theme's ground, the calm pages' row hover and link words fell under the
 * bar the rail and the tiles meet (measured: wicked-light + accent h0 s0 l88, row hover dE_OK 0.062 and link 3.6:1 on
 * it; wicked-dark + accent h210 s25 l8, row hover 0.079). The bar: rest -> hover dE_OK >= 0.08, link words >= 4.5:1 at
 * rest and on the hover, in both wicked themes, for those accents and the presets (whose look must not change).
 *
 * This resolves calm.css's own tokens with a small CSS colour evaluator (color-mix in oklab, var(), hex, hsl,
 * transparent, relative oklch), composites a translucent fill over the page ground, and measures the result.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');

type Lab = [number, number, number];
interface Col { lab: Lab; a: number }
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgbToLab([r, g, b]: number[]): Lab {
  const [R, G, B] = [lin(r!), lin(g!), lin(b!)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labToRgb([L, A, B]: Lab): number[] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((c) => Math.min(1, Math.max(0, gam(c))));
}
function hsl(h: number, s: number, l: number): number[] {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
}

/** Split a function's arguments at top-level commas. */
function args(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1; else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}
function inner(expr: string, name: string): string { return expr.slice(name.length + 1, expr.lastIndexOf(')')); }

/** Evaluate one CSS colour expression against custom properties `vars` (already token strings). */
function color(expr: string, vars: Record<string, string>): Col {
  const e = expr.trim();
  const v = /^var\((--[\w-]+)\)$/u.exec(e);
  if (v !== null) { const t = vars[v[1]!]; if (t === undefined) throw new Error(`no ${v[1]}`); return color(t, vars); }
  if (e === 'transparent') return { lab: [0, 0, 0], a: 0 };
  if (/^#[0-9a-f]{6}$/iu.test(e)) return { lab: rgbToLab([1, 3, 5].map((i) => Number.parseInt(e.slice(i, i + 2), 16) / 255)), a: 1 };
  if (e.startsWith('hsl(')) {
    const [h, s, l] = inner(e, 'hsl').trim().split(/\s+/u).map((x) => Number.parseFloat(x));
    return { lab: rgbToLab(hsl(h!, s! / 100, l! / 100)), a: 1 };
  }
  if (e.startsWith('color-mix(')) {
    const [space, a, b] = args(inner(e, 'color-mix'));
    expect(space).toBe('in oklab');
    const part = (s: string): [Col, number | null] => {
      const m = /^(.*?)\s+(\d+(?:\.\d+)?)%$/u.exec(s);
      return m !== null ? [color(m[1]!, vars), Number(m[2]) / 100] : [color(s, vars), null];
    };
    const [[ca, pa], [cb, pb]] = [part(a!), part(b!)];
    const p = pa ?? (pb !== null ? 1 - pb : 0.5); const q = pb ?? 1 - p;
    const alpha = ca.a * p + cb.a * q;
    if (alpha === 0) return { lab: [0, 0, 0], a: 0 };
    const lab = [0, 1, 2].map((i) => (ca.lab[i]! * ca.a * p + cb.lab[i]! * cb.a * q) / alpha) as Lab;
    return { lab, a: alpha };
  }
  const rel = /^oklch\(from (.*) (min|max)\(l, ([\d.]+)\) c h\)$/u.exec(e);
  if (rel !== null) {
    const base = color(rel[1]!, vars);
    const L = rel[2] === 'min' ? Math.min(base.lab[0], Number(rel[3])) : Math.max(base.lab[0], Number(rel[3]));
    return { lab: [L, base.lab[1], base.lab[2]], a: base.a };
  }
  throw new Error(`cannot evaluate ${e}`);
}
/** A translucent fill over an opaque ground, composited in sRGB as a browser paints it. */
function over(top: Col, ground: Col): Lab {
  const [t, g] = [labToRgb(top.lab), labToRgb(ground.lab)];
  return rgbToLab(t.map((c, i) => c * top.a + g[i]! * (1 - top.a)));
}
const dE = (x: Lab, y: Lab): number => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
const Y = (lab: Lab): number => { const [r, g, b] = labToRgb(lab).map(lin); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
const contrast = (x: Lab, y: Lab): number => { const [a, b] = [Y(x), Y(y)]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

/** The custom properties a block declares (`--name: value;`). */
function props(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)].map((m) => [m[1]!, m[2]!.trim()]));
}
/** Every innermost rule's selector list and body (a rule inside an @supports block is read as its own rule). */
const rules = (css: string): Array<{ sel: string[]; body: string }> =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((m) => ({ sel: m[1]!.split(',').map((s) => s.trim()), body: m[2]! }));

const THEMES = { 'wicked-light': '[data-theme="wicked-light"]', 'wicked-dark': '[data-theme="wicked-dark"]' } as const;
type Theme = keyof typeof THEMES;
/** The page's tokens under a theme and an accent (null: the theme's own preset). */
function tokens(theme: Theme, accent: [number, number, number] | null): Record<string, string> {
  const css = read(`src/styles/themes/${theme}.css`);
  const [base, custom] = css.split('[data-accent="custom"]');
  const t = props(base!);
  if (accent !== null) {
    const [h, s, l] = accent;
    // The custom block's --accent: hsl(h s l), the dark theme lifting l (calc(var(--_accent-l) + N%)).
    const formula = props(custom!.slice(custom!.indexOf('{') + 1, custom!.indexOf('}')))['--accent']!;
    const lift = /calc\(var\(--_accent-l\) \+ (\d+)%\)/u.exec(formula);
    t['--accent'] = `hsl(${h} ${s} ${l + (lift !== null ? Number(lift[1]) : 0)})`;
  }
  const calm = read('src/styles/sections/calm.css');
  for (const r of rules(calm)) {
    if (r.sel.includes('.wk-calm') || r.sel.includes(`${THEMES[theme]} .wk-calm`)) Object.assign(t, props(r.body));
  }
  return t;
}
/** The fill a calm row paints on hover (calm.css: `.wk-calm-row:hover { background: <fill> }`). */
function rowHoverFill(): string {
  const r = rules(read('src/styles/sections/calm.css')).find((x) => x.sel.includes('.wk-calm-row:hover'));
  return /background:\s*([^;]+);/u.exec(r!.body)![1]!.trim();
}

function measure(theme: Theme, accent: [number, number, number] | null) {
  const t = tokens(theme, accent);
  const ground = color('var(--surface-base)', t);
  const hover = over(color(rowHoverFill(), t), ground);
  const link = color('var(--calm-link)', t).lab;
  return { rowStep: dE(hover, ground.lab), linkOnHover: contrast(link, hover), linkOnGround: contrast(link, ground.lab), t };
}

const NEAR_GROUND: Array<[Theme, [number, number, number]]> = [['wicked-light', [0, 0, 88]], ['wicked-dark', [210, 25, 8]]];
const PRESETS: Array<[Theme, [number, number, number] | null]> = [
  ['wicked-light', null], ['wicked-dark', null], ['wicked-light', [200, 47, 25]], ['wicked-dark', [200, 47, 25]],
];

describe('calm rows and links keep their hover and contrast whatever the accent (studio#921)', () => {
  for (const [theme, accent] of [...NEAR_GROUND, ...PRESETS]) {
    const name = `${theme} + ${accent === null ? 'its preset accent' : `accent h${accent[0]} s${accent[1]} l${accent[2]}`}`;
    it(`${name}: the row hover is a visible step, link words read at AA at rest and on it`, () => {
      const m = measure(theme, accent);
      expect(m.rowStep, 'row hover dE_OK').toBeGreaterThanOrEqual(0.08);
      expect(m.linkOnHover, 'link on the row hover').toBeGreaterThanOrEqual(4.5);
      expect(m.linkOnGround, 'link at rest').toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the link floor is behind @supports (an engine without relative colour keeps the plain mix and the accent dot)', () => {
    const calm = read('src/styles/sections/calm.css');
    const at = calm.indexOf('@supports (color: oklch(from red l c h))');
    expect(at, 'the @supports block').toBeGreaterThanOrEqual(0);
    const floors = [...calm.matchAll(/--calm-link:\s*oklch\(from/gu)].map((m) => m.index!);
    expect(floors.length).toBe(2);
    const close = calm.indexOf('\n}', at);
    for (const i of floors) expect(i > at && i < close, 'every oklch(from) floor sits inside it').toBe(true);
  });
  it('inline calm links are underlined at rest, so colour is not the only cue (WCAG 1.4.1)', () => {
    const r = rules(read('src/styles/sections/calm.css')).find((x) => x.sel.includes('.wk-calm .wk-link'));
    expect(r!.body).toMatch(/text-decoration:\s*underline/u);
  });
  it("a preset's link colour is the plain mix (the floor only moves a near-ground accent's)", () => {
    for (const [theme, accent] of PRESETS) {
      const t = tokens(theme, accent);
      const plain = color('color-mix(in oklab, var(--accent) 50%, var(--ink-high))', t).lab;
      expect(dE(color('var(--calm-link)', t).lab, plain)).toBeLessThan(0.005);
    }
  });
});
