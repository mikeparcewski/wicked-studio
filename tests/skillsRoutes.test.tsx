import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRoute } from '../src/hooks/useRoute.js';
import { readSkillDeepLink, skillsPath } from '../src/api/skills.js';

/**
 * The Skills surface's route (the skills keystone): `/skills` is ONE flat panel — the file
 * manager over the daemon's effective plugin root.
 *  - `/skills` parses to the `skills` panel with no run/project machinery armed;
 *  - the one skill a link opens rides `?skill=<name>` in `search` (never a path segment) —
 *    `skillsPath(name)` spells it, `readSkillDeepLink(search)` reads it back;
 *  - a sub-address (`/skills/<anything>`) parses to the same panel — the generic panel arm, the
 *    same contract every flat panel (`/work/...`) has; the rail's heading map agrees.
 */

function routeAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderHook(() => useRoute()).result;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useRoute — /skills', () => {
  it('parses /skills to the skills panel with nothing else armed', () => {
    const r = routeAt('/skills').current;
    expect(r.panel).toBe('skills');
    expect(r.runId).toBeNull();
    expect(r.projectId).toBeNull();
    expect(r.showLaunch).toBe(false);
    expect(r.steeringSection).toBeNull();
    expect(r.testingPage).toBeNull();
  });

  it('carries the ?skill= deep link in `search`, not in the panel parse', () => {
    const r = routeAt('/skills?skill=wicked-garden-repo-learn').current;
    expect(r.panel).toBe('skills');
    expect(r.search).toBe('?skill=wicked-garden-repo-learn');
    expect(readSkillDeepLink(r.search)).toBe('wicked-garden-repo-learn');
  });

  it('a sub-address parses to the same flat panel (the generic panel arm)', () => {
    expect(routeAt('/skills/').current.panel).toBe('skills');
    expect(routeAt('/skills/wicked-garden-repo-learn').current.panel).toBe('skills');
  });

  it('panelPath spells the skills panel as /skills', () => {
    expect(routeAt('/').current.panelPath('skills')).toBe('/skills');
  });
});

describe('skillsPath / readSkillDeepLink — the one spelling of the drawer address', () => {
  it('bare for the catalog, ?skill=<name> (encoded) for one skill', () => {
    expect(skillsPath()).toBe('/skills');
    expect(skillsPath(null)).toBe('/skills');
    expect(skillsPath('wicked-garden-repo-learn')).toBe('/skills?skill=wicked-garden-repo-learn');
    expect(skillsPath('a b/c')).toBe('/skills?skill=a%20b%2Fc');
  });

  it('reads the name back, decoded; absent or empty is null (the bare catalog)', () => {
    expect(readSkillDeepLink('?skill=a%20b%2Fc')).toBe('a b/c');
    expect(readSkillDeepLink('')).toBeNull();
    expect(readSkillDeepLink('?skill=')).toBeNull();
    expect(readSkillDeepLink('?type=security')).toBeNull();
  });
});
