/**
 * Ambient (operator 2026-11-01; program design/mockups/ambient.html): the mood the work sets, its reduced-motion path,
 * and contrast for every state on both grounds (primary >= 4.5:1; secondary >= 4.5:1 dark, >= 5:1 light).
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { ambientMood, DELIVERED_WINDOW_MS, FAILED_WINDOW_MS } from '../src/board/ambient.js';
import { sanitizeAppearance } from '../src/theming/appearance.js';

const NOW = 1_800_000_000_000;
const run = (status: string, over: Record<string, unknown> = {}): SessionView => ({ session: { id: Math.random().toString(36), status, ...over }, units: [] }) as unknown as SessionView;

describe('the mood: failed > needs you > running > delivered > idle', () => {
  it('idle when nothing is going on', () => {
    expect(ambientMood({ runs: [run('completed', { finished_at: NOW - 3_600_000, delivery: 'pr' })], needs: 0, now: NOW })).toEqual({ mood: 'idle', until: null });
  });
  it('running while a job runs; needs you over running; failed over both', () => {
    expect(ambientMood({ runs: [run('executing')], needs: 0, now: NOW }).mood).toBe('running');
    expect(ambientMood({ runs: [run('executing')], needs: 2, now: NOW }).mood).toBe('needs');
    const failed = ambientMood({ runs: [run('executing'), run('failed', { finished_at: NOW - 60_000 })], needs: 2, now: NOW });
    expect(failed).toEqual({ mood: 'failed', until: NOW - 60_000 + FAILED_WINDOW_MS });
  });
  it('a failure colours the room for half an hour, then it ages out', () => {
    expect(ambientMood({ runs: [run('failed', { ended_at: (NOW - FAILED_WINDOW_MS - 1000) / 1000 })], needs: 0, now: NOW }).mood).toBe('idle');
  });
  it('delivered settles for 10 s, below everything else; a completion with no delivery is not one', () => {
    const d = ambientMood({ runs: [run('completed', { finished_at: NOW - 2000, delivery: 'pr' })], needs: 0, now: NOW });
    expect(d).toEqual({ mood: 'delivered', until: NOW - 2000 + DELIVERED_WINDOW_MS });
    expect(ambientMood({ runs: [run('completed', { finished_at: NOW - 2000, delivery: 'pr' }), run('executing')], needs: 0, now: NOW }).mood).toBe('running');
    expect(ambientMood({ runs: [run('completed', { finished_at: NOW - 2000, delivery: 'none' })], needs: 0, now: NOW }).mood).toBe('idle');
    expect(ambientMood({ runs: [run('completed', { finished_at: NOW - DELIVERED_WINDOW_MS - 1, delivery: 'pr' })], needs: 0, now: NOW }).mood).toBe('idle');
  });
});

const css = (p: string): string => readFileSync(fileURLToPath(new URL(`../src/styles/${p}`, import.meta.url)), 'utf8');

describe('reduced motion', () => {
  it('the setting and prefers-reduced-motion both stop the breathing and the settle; the states stay', () => {
    const a = css('sections/ambient.css');
    expect(a).toMatch(/\[data-ambient-still="on"\] \[data-shell="desk"\]::before,\s*html\[data-ambient="on"\]\[data-ambient-still="on"\] #main \{ animation: none !important; \}/u);
    expect(a).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-ambient="on"\] \[data-shell="desk"\]::before, html\[data-ambient="on"\] #main \{ animation: none !important; \}/u);
    expect(sanitizeAppearance({ theme: 'wicked-dark', ambient: true, ambient_still: true })).toMatchObject({ ambient: true, ambient_still: true });
    expect('ambient' in sanitizeAppearance({ theme: 'wicked-dark' })).toBe(false);
  });
  it('the wash is at most 7% (9% at the delivered peak); text, buttons and cards are never in the mood rules', () => {
    const a = css('sections/ambient.css');
    const washes = [...a.matchAll(/--mood-wash: (\d+)%/gu)].map((m) => Number(m[1]));
    expect(Math.max(...washes)).toBe(7);
    expect([...a.matchAll(/var\(--mood\) (\d+)%, transparent/gu)].map((m) => Number(m[1])).every((n) => n <= 9)).toBe(true);
    // The mood reaches four things only: the hairline, the main column's wash, the Nerve Center tile and its light, the
    // active nav marker.
    const sels = [...a.matchAll(/([^{}]+)\{[^}]*var\(--mood\)/gu)].map((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//gu, '').trim())
      .filter((x) => !x.startsWith('@keyframes') && !/^(0|25|100)%$/u.test(x) && !x.startsWith('html[data-ambient="on"][data-mood="'));
    for (const sel of sels) expect(sel, sel).toMatch(/(\[data-shell="desk"\]::before|#main|\.wk-nc-tile|\.wk-nc-light|\[aria-current="page"\])$/u);
  });
});

// sRGB relative luminance, WCAG 2.x.
const hex = (h: string): number[] => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c: number[]): number => { const f = (v: number): number => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
const ratio = (a: number[], b: number[]): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
const mix = (fg: number[], bg: number[], a: number): number[] => fg.map((v, i) => Math.round(v * a + bg[i]! * (1 - a)));

describe('contrast on every state and ground', () => {
  for (const ground of ['light', 'dark'] as const) {
    const theme = css(`themes/wicked-${ground}.css`);
    const tok = (name: string): number[] => { const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'u').exec(theme); if (m === null) throw new Error(`no --${name}`); return hex(m[1]!); };
    const base = tok('surface-base');
    const hues = { running: tok('mood-run'), needs: tok('status-warn'), failed: tok('status-fail'), delivered: tok('status-ok') };
    const washes = { running: 0.05, needs: 0.06, failed: 0.06, delivered: 0.09 };
    for (const state of ['idle', 'running', 'needs', 'failed', 'delivered'] as const) {
      it(`${ground} · ${state}`, () => {
        const bg = state === 'idle' ? base : mix(hues[state], base, washes[state]);
        expect(ratio(tok('ink-high'), bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(tok('ink-muted'), bg)).toBeGreaterThanOrEqual(ground === 'light' ? 5 : 4.5);
      });
    }
  }
});
