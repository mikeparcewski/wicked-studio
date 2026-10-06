// Document version addressing — DES-MERGE-001 §4.2 / §6.3 slice 9.
//
// The version is URL-BORNE, so what is asserted here is the derivation both ways:
// the path a selection navigates to, the version a URL resolves to, and the fact that
// a navigation updates `search` (which is what re-renders the frame at the new version).
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { routedVersion, useRoute, versionPath } from '../src/hooks/useRoute.js';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('versionPath — where a selected version lives', () => {
  it('addresses a version as ?v=N on the doc route', () => {
    expect(versionPath('proj-1', 'q3-report', 2)).toBe('/p/proj-1/document/q3-report?v=2');
  });

  it('addresses the head as the bare doc route — no ?v to go stale', () => {
    expect(versionPath('proj-1', 'q3-report', null)).toBe('/p/proj-1/document/q3-report');
  });

  it('encodes both ids so an odd project or doc still round-trips', () => {
    expect(versionPath('p 1', 'a/b', 3)).toBe('/p/p%201/document/a%2Fb?v=3');
  });
});

describe('routedVersion — what a URL resolves to', () => {
  it('reads a positive integer ?v', () => {
    expect(routedVersion('?v=7')).toBe(7);
    expect(routedVersion('?other=x&v=1')).toBe(1);
  });

  it('resolves to the head (null) with no ?v at all', () => {
    expect(routedVersion('')).toBeNull();
    expect(routedVersion('?tab=notes')).toBeNull();
  });

  it('resolves a mangled ?v to the head rather than erroring on the URL', () => {
    for (const bad of ['?v=0', '?v=-2', '?v=abc', '?v=', '?v=1.5', '?v=NaN']) {
      expect(routedVersion(bad)).toBeNull();
    }
  });
});

describe('useRoute — a version selection is a real navigation', () => {
  // S16a: /s/:sessionId/a/:key is not a live route; the version lens sits on the session path.
  // versionPath generates /p/:id/document/:key (a redirect address kept for back-compat) and
  // the version query ?v= is read from `search` regardless of the path.
  it('exposes the query on mount and updates it on navigate', () => {
    window.history.replaceState(null, '', '/s/sess-1?v=2');
    const { result } = renderHook(() => useRoute());
    expect(routedVersion(result.current.search)).toBe(2);
    expect(result.current.artifactId).toBe('sess-1');

    act(() => result.current.navigate('/s/sess-1?v=1'));
    expect(routedVersion(result.current.search)).toBe(1);
    // The route itself is unchanged — the version is a lens on the same session.
    expect(result.current.artifactId).toBe('sess-1');
  });

  it('back-button-correct: popstate re-reads the version from the URL', () => {
    window.history.replaceState(null, '', '/s/sess-1');
    const { result } = renderHook(() => useRoute());
    act(() => result.current.navigate('/s/sess-1?v=1'));
    expect(routedVersion(result.current.search)).toBe(1);

    act(() => {
      window.history.replaceState(null, '', '/s/sess-1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(routedVersion(result.current.search)).toBeNull();
  });
});
