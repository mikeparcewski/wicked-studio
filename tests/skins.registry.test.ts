// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKIN_ID, SKINS, SKIN_SURFACES, isSkinId, skinById, skinTokenKeys,
} from '../src/theming/skins.js';

/**
 * The skin contract (studio skins): a skin is a manifest over ONE behaviour layer —
 * token overrides (the SAME semantic-token names tokens.css declares), a shell layout
 * choice, and a component variant per behaviour surface. These cases pin the registry
 * and every manifest in it; the rendered swap is pinned in skinVariants.test.tsx and
 * e2e/skin_contract_test.py.
 */

const TOKENS_CSS = readFileSync(join(__dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8');
/** Every SEMANTIC token tokens.css declares (primitives carry the `--_` prefix). */
const SEMANTIC = new Set(
  [...TOKENS_CSS.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1]),
);
/** The same raw-colour grammar the ESLint + PostCSS guards enforce (DES-VISION-001 §2.11). */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*[\d.]/;
/** Colour-bearing token families — a skin shapes layout and density, never colour. */
const COLOUR_FAMILY = /^--(surface|ink|accent|status|section|scrim|shadow)/;

describe('the skin registry', () => {
  it('ships the current look as `studio` (the default) and the proof skin `compact-rail`', () => {
    expect(DEFAULT_SKIN_ID).toBe('studio');
    expect(SKINS.map((s) => s.id)).toEqual(['studio', 'compact-rail']);
  });

  it('ids are unique and resolve; an unknown id falls back to the default skin', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    for (const s of SKINS) expect(skinById(s.id)).toBe(s);
    expect(skinById('nope').id).toBe('studio');
    expect(skinById(undefined).id).toBe('studio');
    expect(isSkinId('compact-rail')).toBe(true);
    expect(isSkinId('Compact-Rail')).toBe(false);
    expect(isSkinId(42)).toBe(false);
  });

  it('`studio` IS the current look: no token overrides, the classic shell, every default variant', () => {
    const studio = skinById('studio');
    expect(studio.tokens).toEqual({});
    expect(studio.shell).toBe('classic');
    expect(studio.variants).toEqual({
      needsQueue: 'inline', liveRuns: 'sheet', handover: 'banner',
      peek: 'card', undoToasts: 'stack', navRail: 'full',
    });
  });

  it('every manifest names a variant for EVERY behaviour surface — no more, no fewer', () => {
    expect([...SKIN_SURFACES].sort()).toEqual(
      ['handover', 'liveRuns', 'navRail', 'needsQueue', 'peek', 'undoToasts'],
    );
    for (const s of SKINS) expect(Object.keys(s.variants).sort()).toEqual([...SKIN_SURFACES].sort());
  });

  it('a rail-docked queue requires the right-rail shell (the manifest is self-consistent)', () => {
    for (const s of SKINS) {
      if (s.variants.needsQueue === 'rail') expect(s.shell).toBe('right-rail');
      if (s.shell === 'right-rail') expect(s.variants.needsQueue).toBe('rail');
    }
  });
});

describe('manifest token overrides', () => {
  it('override ONLY semantic tokens tokens.css already declares — never a primitive', () => {
    for (const s of SKINS) {
      for (const name of Object.keys(s.tokens)) {
        expect(name.startsWith('--_'), `${s.id}: ${name} is a primitive`).toBe(false);
        expect(SEMANTIC.has(name), `${s.id}: ${name} is not declared in tokens.css`).toBe(true);
      }
    }
  });

  it('carry no raw colour and touch no colour family — tokens only', () => {
    for (const s of SKINS) {
      for (const [name, value] of Object.entries(s.tokens)) {
        expect(RAW_COLOR.test(String(value)), `${s.id}: ${name}: ${value}`).toBe(false);
        expect(COLOUR_FAMILY.test(name), `${s.id}: ${name} is a colour token`).toBe(false);
      }
    }
  });

  it('skinTokenKeys is the union of every skin’s overrides (what a swap must clear)', () => {
    const union = new Set(SKINS.flatMap((s) => Object.keys(s.tokens)));
    expect(new Set(skinTokenKeys())).toEqual(union);
  });
});

describe('the proof skin `compact-rail` is STRUCTURALLY different', () => {
  const rail = skinById('compact-rail');

  it('moves the Needs-you queue into a persistent right rail', () => {
    expect(rail.shell).toBe('right-rail');
    expect(rail.variants.needsQueue).toBe('rail');
  });

  it('collapses the left nav to icons', () => {
    expect(rail.variants.navRail).toBe('icons');
  });

  it('uses a denser type and spacing scale — every step smaller than studio’s', () => {
    const px = (v: string | undefined): number => Number(String(v).replace('px', ''));
    const base = (name: string): number => {
      const m = TOKENS_CSS.match(new RegExp(`${name}:\\s*([0-9.]+)px`));
      if (m === null) throw new Error(`${name} not in tokens.css`);
      return Number(m[1]);
    };
    const type = ['--text-2xs', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl'];
    const space = ['--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8'];
    for (const t of [...type, ...space]) {
      const override = (rail.tokens as Record<string, string>)[t];
      expect(override, `${t} is not overridden`).toBeDefined();
      expect(px(override), t).toBeLessThan(base(t));
    }
  });
});
