import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { chroniclePath, modePath, projectPath, runTimelinePath, useRoute } from '../src/hooks/useRoute.js';

/** Render the hook against a given path — the parse reads `window.location` at mount. */
function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('useRoute — project + mode routes (S16a: valid modes → everything pre-redirect)', () => {
  it('parses /p/:projectId/:mode to everything with mode null (S16a: pre-redirect tick)', () => {
    const r = routeAt('/p/proj-1/build');
    expect(r.current.projectId).toBe('proj-1');
    expect(r.current.panel).toBe('everything');
    expect(r.current.mode).toBeNull();
    expect(r.current.artifactId).toBeNull();
  });

  it('parses /p/:projectId/:mode/:artifactId to everything for all four modes (pre-redirect tick)', () => {
    for (const mode of ['chat', 'build', 'document', 'video'] as const) {
      const r = routeAt(`/p/proj-1/${mode}/art-7`);
      expect(r.current.panel).toBe('everything');
      expect(r.current.mode).toBeNull();
      expect(r.current.artifactId).toBeNull();
    }
  });

  it('leaves mode null for /p/:projectId; an unknown mode segment is a dead address (S15c, usability review #4)', () => {
    expect(routeAt('/p/proj-1').current).toMatchObject({ mode: null, projectId: 'proj-1', panel: 'everything' });

    const bogus = routeAt('/p/proj-1/bogus/x').current;
    expect(bogus.panel).toBe('not-found');
    expect(bogus.mode).toBeNull();
    expect(bogus.artifactId).toBeNull();
    expect(bogus.projectId).toBeNull();
  });

  it('/s/:sessionId/a/:key is not a live route in S16a — it parses to not-found', () => {
    const r = routeAt('/s/run:s1/a/k1');
    expect(r.current.panel).toBe('not-found');
  });

  it('decodes percent-encoded ids', () => {
    const r = routeAt('/p/proj%20one/build');
    expect(r.current.projectId).toBe('proj one');
  });
});

describe('useRoute — the chronicle moved onto "See everything" (S15c)', () => {
  it('/p/:id/chronicle parses to everything, scoped to the project — no mode, no artifact', () => {
    const r = routeAt('/p/proj-1/chronicle').current;
    expect(r.panel).toBe('everything');
    expect(r.projectId).toBe('proj-1');
    expect(r.mode).toBeNull();
    expect(r.artifactId).toBeNull();
    expect(r.runId).toBeNull();
  });

  it('chroniclePath spells the live address; runTimelinePath is unchanged; the alias now redirects (S16a)', () => {
    expect(chroniclePath('proj one')).toBe('/everything?tab=sessions&project=proj+one');
    expect(runTimelinePath('run/9')).toBe('/runs/run%2F9/timeline');
    // S16a: `/runs/:id/timeline` is the §5.2 alias — it now parses to the session panel
    // (same as `/runs/:id`) and useMovedRoutes replaces the address with /s/run:<id>.
    expect(routeAt('/runs/run-1/timeline').current).toMatchObject({ panel: 'session', artifactId: 'run:run-1' });
  });
});

describe('useRoute — the existing panel routes keep working', () => {
  it('still parses every legacy shape unchanged', () => {
    // `/` became the orchestrator board in slice 5; the run list moved to `/runs`.
    expect(routeAt('/').current).toMatchObject({ panel: 'home', runId: null, mode: null });
    expect(routeAt('/runs').current).toMatchObject({ panel: 'everything', runId: null }); // moved (S15c)
    // S16a: `/runs/:id` now parses to session and redirects to /s/run:<id> via useMovedRoutes.
    expect(routeAt('/runs/run-1').current).toMatchObject({ panel: 'session', artifactId: 'run:run-1' });
    expect(routeAt('/runs/new').current).toMatchObject({ panel: 'runs', showLaunch: true });
    expect(routeAt('/chat/new').current).toMatchObject({ showLaunch: true, chatMode: true });
    // J4/C6: /chat/:id is a live SESSION's address — chat surface, never the
    // launch form, and never a runId (a chat is not a run).
    expect(routeAt('/chat/abc-123').current).toMatchObject({
      panel: 'runs', chatMode: true, artifactId: 'abc-123', runId: null, showLaunch: false,
    });
    expect(routeAt('/work').current.panel).toBe('everything'); // moved (S15c)
    expect(routeAt('/repos/new').current).toMatchObject({ panel: 'repos', showRegisterRepo: true });
    expect(routeAt('/repo-detail/repo-1').current).toMatchObject({ panel: 'repo-detail', repoId: 'repo-1' });
    expect(routeAt('/repo-detail').current.panel).toBe('repos');
    expect(routeAt('/projects').current.panel).toBe('everything'); // moved (S15c)
    expect(routeAt('/projects/proj-1').current).toMatchObject({ panel: 'project-detail', projectId: 'proj-1' });
    expect(routeAt('/system').current.panel).toBe('system');
  });

  it('a route carries no mode, and panelPath is unchanged', () => {
    const r = routeAt('/system');
    expect(r.current.mode).toBeNull();
    expect(r.current.panelPath('home')).toBe('/');
    expect(r.current.panelPath('runs')).toBe('/runs');
    expect(r.current.panelPath('watch')).toBe('/watch');
  });
});

describe('navigate', () => {
  it('pushes a history entry by default', () => {
    const r = routeAt('/');
    const before = window.history.length;

    act(() => r.current.navigate('/watch'));

    expect(window.location.pathname).toBe('/watch');
    expect(r.current.panel).toBe('watch');
    expect(window.history.length).toBe(before + 1);
  });

  it('replaces the entry when asked, so a redirect is never a Back-button trap', () => {
    const r = routeAt('/runs/run-9');
    const before = window.history.length;

    // S16a: /runs/:id redirects to /s/run:<id> — here we test the navigate mechanism directly.
    act(() => r.current.navigate('/s/run%3Arun-9', { replace: true }));

    expect(window.location.pathname).toBe('/s/run%3Arun-9');
    expect(r.current.panel).toBe('session');
    expect(r.current.artifactId).toBe('run:run-9');
    expect(window.history.length).toBe(before);
  });
});

describe('modePath / projectPath', () => {
  it('builds the single spelling of the shell path', () => {
    expect(modePath('proj-1', 'build')).toBe('/p/proj-1/build');
    expect(modePath('proj-1', 'build', 'run-9')).toBe('/p/proj-1/build/run-9');
    expect(modePath('proj one', 'chat', 'run/9')).toBe('/p/proj%20one/chat/run%2F9');
  });

  it('builds the dashboard path — the no-mode project landing (DES-FEEDBACK-001 §4.1)', () => {
    expect(projectPath('proj-1')).toBe('/p/proj-1');
    expect(projectPath('proj one')).toBe('/p/proj%20one');
  });
});
