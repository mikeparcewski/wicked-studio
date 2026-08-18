import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MODES, lastMode, modePath, rememberMode, useRoute } from '../src/hooks/useRoute.js';

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
  it('parses /p/:projectId/:mode', () => {
    const r = routeAt('/p/proj-1/build');
    expect(r.current.projectId).toBe('proj-1');
    expect(r.current.mode).toBe('build');
    expect(r.current.artifactId).toBeNull();
  });

  it('parses /p/:projectId/:mode/:artifactId for all four modes', () => {
    for (const mode of MODES) {
      const r = routeAt(`/p/proj-1/${mode}/art-7`);
      expect(r.current.mode).toBe(mode);
      expect(r.current.artifactId).toBe('art-7');
    }
  });

  it('maps the Build/Chat artifact onto runId so the existing run surfaces stay wired', () => {
    expect(routeAt('/p/proj-1/build/run-9').current.runId).toBe('run-9');

    const chat = routeAt('/p/proj-1/chat/run-9').current;
    expect(chat.runId).toBe('run-9');
    expect(chat.chatMode).toBe(true);

    // Document/Video artifacts are docs and demos, NOT crew runs — never a runId.
    expect(routeAt('/p/proj-1/document/doc-3').current.runId).toBeNull();
    expect(routeAt('/p/proj-1/video/demo-3').current.runId).toBeNull();
  });

  it('leaves mode null for /p/:projectId and for an unknown mode segment', () => {
    expect(routeAt('/p/proj-1').current.mode).toBeNull();

    const bogus = routeAt('/p/proj-1/bogus/x').current;
    expect(bogus.mode).toBeNull();
    expect(bogus.artifactId).toBeNull();
    expect(bogus.projectId).toBe('proj-1');
  });

  it('decodes percent-encoded ids', () => {
    const r = routeAt('/p/proj%20one/build/run%2F9');
    expect(r.current.projectId).toBe('proj one');
    expect(r.current.artifactId).toBe('run/9');
  });
});

describe('useRoute — the existing panel routes keep working', () => {
  it('still parses every legacy shape unchanged', () => {
    // `/` became the orchestrator board in slice 5; the run list moved to `/runs`.
    expect(routeAt('/').current).toMatchObject({ panel: 'home', runId: null, mode: null });
    expect(routeAt('/runs').current).toMatchObject({ panel: 'runs', runId: null });
    expect(routeAt('/runs/run-1').current).toMatchObject({ panel: 'runs', runId: 'run-1' });
    expect(routeAt('/runs/new').current).toMatchObject({ panel: 'runs', showLaunch: true });
    expect(routeAt('/chat/new').current).toMatchObject({ showLaunch: true, chatMode: true });
    expect(routeAt('/work').current.panel).toBe('work');
    expect(routeAt('/repos/new').current).toMatchObject({ panel: 'repos', showRegisterRepo: true });
    expect(routeAt('/repo-detail/repo-1').current).toMatchObject({ panel: 'repo-detail', repoId: 'repo-1' });
    expect(routeAt('/repo-detail').current.panel).toBe('repos');
    expect(routeAt('/projects').current.panel).toBe('projects');
    expect(routeAt('/projects/proj-1').current).toMatchObject({ panel: 'project-detail', projectId: 'proj-1' });
    expect(routeAt('/system').current.panel).toBe('system');
  });

  it('a legacy route carries no mode, and panelPath is unchanged', () => {
    const r = routeAt('/runs/run-1');
    expect(r.current.mode).toBeNull();
    expect(r.current.panelPath('home')).toBe('/');
    expect(r.current.panelPath('runs')).toBe('/runs');
    expect(r.current.panelPath('coverage')).toBe('/coverage');
  });
});

describe('navigate', () => {
  it('pushes a history entry by default, so Back returns to the previous mode', () => {
    const r = routeAt('/p/proj-1/chat');
    const before = window.history.length;

    act(() => r.current.navigate('/p/proj-1/build'));

    expect(window.location.pathname).toBe('/p/proj-1/build');
    expect(r.current.mode).toBe('build');
    expect(window.history.length).toBe(before + 1);
  });

  it('replaces the entry when asked, so a redirect is never a Back-button trap', () => {
    const r = routeAt('/runs/run-9');
    const before = window.history.length;

    act(() => r.current.navigate('/p/proj-1/build/run-9', { replace: true }));

    expect(window.location.pathname).toBe('/p/proj-1/build/run-9');
    expect(r.current.runId).toBe('run-9');
    expect(window.history.length).toBe(before);
  });
});

describe('modePath / last-used mode', () => {
  it('builds the single spelling of the shell path', () => {
    expect(modePath('proj-1', 'build')).toBe('/p/proj-1/build');
    expect(modePath('proj-1', 'build', 'run-9')).toBe('/p/proj-1/build/run-9');
    expect(modePath('proj one', 'chat', 'run/9')).toBe('/p/proj%20one/chat/run%2F9');
  });

  it('defaults to chat and remembers per project', () => {
    expect(lastMode('proj-1')).toBe('chat');
    rememberMode('proj-1', 'build');
    expect(lastMode('proj-1')).toBe('build');
    expect(lastMode('proj-2')).toBe('chat');
  });

  it('ignores a junk stored value rather than routing to a mode that does not exist', () => {
    window.localStorage.setItem('wk.studio.lastMode.proj-1', 'sideways');
    expect(lastMode('proj-1')).toBe('chat');
  });
});
