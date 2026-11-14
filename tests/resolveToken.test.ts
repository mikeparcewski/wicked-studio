/**
 * resolveTokenPx (F3). The probe must INHERIT the requested token from the cascade; it must not set
 * the token on itself (an 'initial' override makes the var() invalid and the width collapses to
 * auto/NaN, so the function returns a container width or NaN instead of the token's pixels).
 *
 * jsdom does not resolve var() (see resolveToken.ts), so getComputedStyle is stubbed to emulate the
 * cascade: a width of `var(--tok)` resolves to the probe's own inline --tok when present (that is the
 * bug path), otherwise to the :root value. With the override reinstated this test fails (NaN).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveTokenPx, resolveTokenValue } from '../src/styles/resolveToken.js';

describe('resolveTokenPx (F3)', () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the token's pixel value by inheriting it, not a container width", () => {
    const ROOT: Record<string, string> = { '--text-caption': '12px' };
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element) => {
      const node = el as HTMLElement;
      const widthExpr = node.style.width; // resolveTokenPx sets this to `var(--text-caption)`
      const m = /^var\((--[a-z-]+)\)$/.exec(widthExpr);
      let width = widthExpr === '' ? 'auto' : widthExpr;
      if (m !== null) {
        const token = m[1]!;
        const inline = node.style.getPropertyValue(token); // the buggy self-override, when present
        const resolved = inline !== '' ? (inline === 'initial' ? '' : inline) : (ROOT[token] ?? '');
        width = resolved === '' ? 'auto' : resolved;
      }
      return { width, getPropertyValue: (p: string) => (p === 'width' ? width : '') } as unknown as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle);

    expect(resolveTokenPx('--text-caption')).toBe(12);
  });
});

describe('resolveTokenPx (F4): a display:none probe reports the computed value, never a laid-out width', () => {
  afterEach(() => vi.restoreAllMocks());

  // Emulate the browser: a laid-out block reports its used (container) width; a display:none probe
  // reports the COMPUTED width — the resolved token (rem normalised against a 16px root) or `auto`.
  const ROOT: Record<string, string> = { '--text-caption': '0.75rem' }; // 0.75rem × 16 = 12px
  function stub(): void {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element) => {
      const node = el as HTMLElement;
      const expr = node.style.width;
      const m = /^var\((--[a-z-]+)\)$/.exec(expr);
      let width: string;
      if (node.style.display !== 'none') {
        width = '1280px'; // a laid-out block — the body's content width, the bug path
      } else if (m !== null) {
        let v = ROOT[m[1]!] ?? 'auto'; // an unset token has no computed length
        if (/rem$/.test(v)) v = `${Number.parseFloat(v) * 16}px`;
        width = v;
      } else {
        width = expr === '' ? 'auto' : expr;
      }
      return { width, getPropertyValue: (p: string) => (p === 'width' ? width : '') } as unknown as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle);
  }

  it('a 0.75rem token on a 16px root resolves to 12', () => {
    stub();
    expect(resolveTokenPx('--text-caption')).toBe(12);
  });

  it('an unset token resolves to NaN, not the container width', () => {
    stub();
    expect(resolveTokenPx('--unset-token')).toBeNaN();
  });
});

describe('resolveTokenValue (F4)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a set token returns its value; an unset one returns an empty string', () => {
    const ROOT: Record<string, string> = { '--font-mono': 'ui-monospace, monospace' };
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element) => {
      const node = el as HTMLElement;
      const expr = node.style.getPropertyValue('--resolve-probe'); // resolveTokenValue sets `var(--token)`
      const m = /^var\((--[a-z-]+)\)$/.exec(expr);
      // A set token resolves through the cascade; an unset one keeps the unresolved var() passthrough.
      const resolved = m !== null ? (ROOT[m[1]!] ?? expr) : expr;
      return { getPropertyValue: (p: string) => (p === '--resolve-probe' ? resolved : '') } as unknown as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle);
    expect(resolveTokenValue('--font-mono')).toBe('ui-monospace, monospace');
    expect(resolveTokenValue('--unset-token')).toBe('');
  });
});
