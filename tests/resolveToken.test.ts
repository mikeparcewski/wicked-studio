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

import { resolveTokenPx } from '../src/styles/resolveToken.js';

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
