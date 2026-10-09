// Document version addressing — DES-MERGE-001 §4.2 / §6.3 slice 9; S16a-4b/4h: on the artifact
// address (`/s/:id/a/:key?size=full&v=N`, read with `board/artifactAddress.ts` versionOf).
//
// The version is URL-BORNE, so what is asserted here is the derivation both ways:
// the path a selection navigates to, the version a URL resolves to, and the fact that
// a navigation updates `search` (which is what re-renders the frame at the new version).
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { artifactPath, versionOf } from '../src/board/artifactAddress.js';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useRoute — a version selection is a real navigation', () => {
  it('exposes the query on mount and updates it on navigate (S16a-4b: on the artifact address)', () => {
    window.history.replaceState(null, '', `${artifactPath('run:r1', 'r1:proj-1/q3-report', 'full', 2)}`);
    const { result } = renderHook(() => useRoute());
    expect(versionOf(result.current.search)).toBe(2);
    expect(result.current.artifactKey).toBe('r1:proj-1/q3-report');

    act(() => result.current.navigate(artifactPath('run:r1', 'r1:proj-1/q3-report', 'full', 1)));
    expect(versionOf(result.current.search)).toBe(1);
    // The route itself is unchanged — the version is a lens on the same artifact.
    expect(result.current.artifactKey).toBe('r1:proj-1/q3-report');
    expect(result.current.panel).toBe('session');
  });

  it('back-button-correct: popstate re-reads the version from the URL', () => {
    window.history.replaceState(null, '', artifactPath('run:r1', 'r1:proj-1/q3-report', 'full'));
    const { result } = renderHook(() => useRoute());
    act(() => result.current.navigate(artifactPath('run:r1', 'r1:proj-1/q3-report', 'full', 1)));
    expect(versionOf(result.current.search)).toBe(1);

    act(() => {
      window.history.replaceState(null, '', artifactPath('run:r1', 'r1:proj-1/q3-report', 'full'));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(versionOf(result.current.search)).toBeNull();
  });
});
