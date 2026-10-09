import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { chroniclePath, MODES, modePath, projectPath, runTimelinePath, useRoute } from '../src/hooks/useRoute.js';

/** Render the hook against a given path — the parse reads `window.location` at mount. */
function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('useRoute — project + mode routes (DES-MERGE-001 §1.5)', () => {
  it('S16a-4f: /p/:projectId/build parses to the project\'s Sessions — no mode, no artifact', () => {
    const r = routeAt('/p/proj-1/build');
    expect(r.current).toMatchObject({ panel: 'everything', projectId: 'proj-1', mode: null, artifactId: null });
    expect(routeAt('/p/proj-1/build/new').current).toMatchObject({ panel: 'home', mode: null, showLaunch: false });
  });

  it('every artifact-bearing mode address moved (S16a-2d build, S16a-4c document / video, S16a-4e chat)', () => {
    expect(MODES.length).toBe(4);
    expect(routeAt('/p/proj-1/chat/art-7').current).toMatchObject({ panel: 'session', artifactId: 'run:art-7', mode: null });
  });

  it('maps the Build/Chat artifact onto runId so the existing run surfaces stay wired', () => {
    // S16a-2d: /p/:pid/build/:run MOVED — it parses straight to the run's session thread.
    expect(routeAt('/p/proj-1/build/run-9').current).toMatchObject({ panel: 'session', artifactId: 'run:run-9' });

    // S16a-4e: /p/:pid/chat/:run MOVED to the run's session; /p/:pid/chat starts a chat on the Desk.
    expect(routeAt('/p/proj-1/chat/run-9').current).toMatchObject({ panel: 'session', artifactId: 'run:run-9', runId: null });
    expect(routeAt('/p/proj-1/chat').current).toMatchObject({ panel: 'home' });

    // S16a-4c: document / video addresses moved — they parse to "See everything", never a runId.
    expect(routeAt('/p/proj-1/document/doc-3').current).toMatchObject({ panel: 'everything', projectId: 'proj-1', runId: null });
    expect(routeAt('/p/proj-1/video/demo-3').current).toMatchObject({ panel: 'everything', projectId: 'proj-1', runId: null });
  });

  it('leaves mode null for /p/:projectId; an unknown mode segment is a dead address (S15c, usability review #4)', () => {
    expect(routeAt('/p/proj-1').current).toMatchObject({ mode: null, projectId: 'proj-1', panel: 'everything' });

    const bogus = routeAt('/p/proj-1/bogus/x').current;
    expect(bogus.panel).toBe('not-found');
    expect(bogus.mode).toBeNull();
    expect(bogus.artifactId).toBeNull();
    expect(bogus.projectId).toBeNull();
  });

  it('decodes percent-encoded ids', () => {
    expect(routeAt('/p/proj%20one/build').current.projectId).toBe('proj one');
    // A moved build or chat-run address decodes its run id into the session id.
    expect(routeAt('/p/proj%20one/chat/c%2F9').current.artifactId).toBe('run:c/9');
    expect(routeAt('/p/proj%20one/build/run%2F9').current.artifactId).toBe('run:run/9');
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

  it('chroniclePath spells the live address; runTimelinePath is unchanged and the alias resolves', () => {
    expect(chroniclePath('proj one')).toBe('/everything?tab=sessions&project=proj+one');
    expect(runTimelinePath('run/9')).toBe('/runs/run%2F9/timeline');
    // `/runs/:id/timeline` is the §5.2 alias of `/runs/:id` — both MOVED to the run's session (S16a-2d).
    expect(routeAt('/runs/run-1/timeline').current).toMatchObject({ panel: 'session', artifactId: 'run:run-1' });
  });
});

describe('useRoute — the existing panel routes keep working', () => {
  it('still parses every legacy shape unchanged', () => {
    // `/` became the orchestrator board in slice 5; the run list moved to `/runs`.
    expect(routeAt('/').current).toMatchObject({ panel: 'home', runId: null, mode: null });
    expect(routeAt('/runs').current).toMatchObject({ panel: 'everything', runId: null }); // moved (S15c)
    expect(routeAt('/runs/run-1').current).toMatchObject({ panel: 'session', artifactId: 'run:run-1' }); // moved (S16a-2d)
    expect(routeAt('/runs/new').current).toMatchObject({ panel: 'runs', showLaunch: true });
    // S16a-4e: a chat IS its session — /chat/:id parses to /s/:id; /chat/new starts one on the Desk.
    expect(routeAt('/chat/new').current).toMatchObject({ panel: 'home' });
    expect(routeAt('/chat/abc-123').current).toMatchObject({ panel: 'session', artifactId: 'abc-123', runId: null, showLaunch: false });
    expect(routeAt('/work').current.panel).toBe('everything'); // moved (S15c)
    expect(routeAt('/repos/new').current).toMatchObject({ panel: 'repos', showRegisterRepo: true });
    expect(routeAt('/repo-detail/repo-1').current).toMatchObject({ panel: 'repo-detail', repoId: 'repo-1' });
    expect(routeAt('/repo-detail').current.panel).toBe('repos');
    expect(routeAt('/projects').current.panel).toBe('everything'); // moved (S15c)
    expect(routeAt('/projects/proj-1').current).toMatchObject({ panel: 'project-detail', projectId: 'proj-1' });
    expect(routeAt('/system').current.panel).toBe('system');
  });

  it('a legacy route carries no mode, and panelPath is unchanged', () => {
    const r = routeAt('/runs/run-1');
    expect(r.current.mode).toBeNull();
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
    const r = routeAt('/runs/run-9');
    const before = window.history.length;

    act(() => r.current.navigate('/s/run%3Arun-9', { replace: true }));

    expect(window.location.pathname).toBe('/s/run%3Arun-9');
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
