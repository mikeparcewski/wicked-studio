import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';

/** Render the hook against a given path — the parse reads `window.location` at mount. */
function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('useRoute — the existing panel routes keep working', () => {
  it('still parses every legacy shape unchanged', () => {
    // `/` became the orchestrator board in slice 5; the run list moved to `/runs`.
    expect(routeAt('/').current).toMatchObject({ panel: 'home', runId: null });
    expect(routeAt('/runs/new').current).toMatchObject({ panel: 'runs', showLaunch: true });
    expect(routeAt('/s/abc-123').current).toMatchObject({ panel: 'session', artifactId: 'abc-123', runId: null, showLaunch: false });
    expect(routeAt('/repos/new').current).toMatchObject({ panel: 'repos', showRegisterRepo: true });
    expect(routeAt('/repo-detail/repo-1').current).toMatchObject({ panel: 'repo-detail', repoId: 'repo-1' });
    expect(routeAt('/repo-detail').current.panel).toBe('repos');
    expect(routeAt('/projects/proj-1').current).toMatchObject({ panel: 'project-detail', projectId: 'proj-1' });
    expect(routeAt('/system').current.panel).toBe('system');
  });

  it('panelPath is unchanged', () => {
    const r = routeAt('/s/run%3Arun-1');
    expect(r.current.panelPath('home')).toBe('/');
    expect(r.current.panelPath('runs')).toBe('/runs');
    expect(r.current.panelPath('watch')).toBe('/watch');
  });
});

describe('navigate', () => {
  it('pushes a history entry by default, so Back returns to the previous page', () => {
    const r = routeAt('/testing/campaigns');
    const before = window.history.length;

    act(() => r.current.navigate('/everything?tab=sessions&project=proj-1'));

    expect(window.location.pathname).toBe('/everything');
    expect(r.current.projectId).toBeNull();
    expect(r.current.panel).toBe('everything');
    expect(window.history.length).toBe(before + 1);
  });

  it('replaces the entry when asked, so a redirect is never a Back-button trap', () => {
    const r = routeAt('/steering');
    const before = window.history.length;

    act(() => r.current.navigate('/s/run%3Arun-9', { replace: true }));

    expect(window.location.pathname).toBe('/s/run%3Arun-9');
    expect(r.current.artifactId).toBe('run:run-9');
    expect(window.history.length).toBe(before);
  });
});
