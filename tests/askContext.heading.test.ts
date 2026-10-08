import { describe, it, expect } from 'vitest';
import { headingForPath } from '../src/components/askContext.js';

/**
 * The route→heading map (§3.2), moved with `headingForPath` from the classic rail into
 * `askContext.ts` (S18c) — the Ask pack's "where am I" reads it.
 */

describe('the route→heading map (§3.2)', () => {
  it('maps every territory to its heading, and / and /runs* to none', () => {
    expect(headingForPath('/projects')).toBe('projects');
    expect(headingForPath('/p/abc/build')).toBe('projects');
    expect(headingForPath('/p/abc')).toBe('projects');
    // Execute / Vibe / Demo (nav-reorg); the retired /make maps to Execute for the
    // pre-redirect tick.
    expect(headingForPath('/execute')).toBe('execute');
    expect(headingForPath('/make')).toBe('execute');
    expect(headingForPath('/vibe')).toBe('vibe');
    expect(headingForPath('/demo')).toBe('demo');
    expect(headingForPath('/chats')).toBe('chat');
    expect(headingForPath('/chat/new')).toBe('chat');
    expect(headingForPath('/repos')).toBe('repos');
    expect(headingForPath('/repos/new')).toBe('repos');
    expect(headingForPath('/repo-detail/r1')).toBe('repos');
    // /coverage and /domain are RETIRED (they redirect to /system) but stay mapped so the
    // rail never flashes headless on the pre-redirect tick.
    for (const p of ['/system', '/theme', '/coverage', '/domain', '/workflows']) {
      expect(headingForPath(p)).toBe('settings');
    }
    // Steering owns its sub-sections AND the retired /wiki + /rules + /policies panels AND the
    // retired standalone /proposals queue. The seven types are a `?type=` filter under
    // /steering/policies now, so a legacy /steering/:type still maps here too.
    for (const p of ['/steering', '/steering/policies', '/steering/memories', '/steering/security', '/wiki', '/rules', '/policies', '/proposals']) {
      expect(headingForPath(p)).toBe('steering');
    }
    // The /testing surface splits: Test owns campaigns/recon (+ the retired flat /campaigns
    // addresses) AND the page-less addresses — bare /testing and the retired harness — which
    // `useTestingRedirect` lands on the Test landing (F-075 / F-7R2-009); Evals (key stays
    // `testing`) owns only the eval runner.
    for (const p of ['/testing/campaigns', '/testing/campaigns/c-1', '/campaigns', '/campaigns/c-1', '/testing', '/testing/harness']) {
      expect(headingForPath(p)).toBe('test');
    }
    expect(headingForPath('/testing/evals')).toBe('testing');
    // Skills owns `/skills` and any sub-address (the file manager is one flat page; a skill's
    // drawer rides `?skill=`), and it is its OWN heading — never Steering's.
    for (const p of ['/skills', '/skills/', '/skills/wicked-garden-repo-learn']) {
      expect(headingForPath(p)).toBe('skills');
    }
    for (const p of ['/mcp', '/mcp/']) expect(headingForPath(p)).toBe('mcp');
    expect(headingForPath('/')).toBeNull();
    expect(headingForPath('/runs')).toBeNull();
    expect(headingForPath('/runs/r-1')).toBeNull();
  });
});
