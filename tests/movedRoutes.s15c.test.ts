import { describe, expect, it } from 'vitest';
import { parseRoute } from '../src/hooks/useRoute.js';

/**
 * THE §5.4 MOVES (DES-STUDIO-REBUILD-001 §5.4, slice S15c; Amendment 5): the redirect table, as
 * data and as parses. "Redirects only for moves, never for typos" — every old list and dashboard
 * address lands on "See everything" with the right tab and filter; `/p/:id` lands on the project's
 * scoped Sessions tab; a typo stays a dead address.
 *
 * NOT moved here (deferred to S16a, with the reason pinned by the last `describe`): `/runs/:id` →
 * `/s/:id` and `/p/:id/:mode[/:artifact]` → `/s/:id[/a/:key]`. 23 of the 65 CI journeys drive those
 * addresses for behaviours the session page does not carry yet (the gate trust record, re-run from a
 * phase, the reject-note banner, seat reassignment, the demo start form), and `/s/:id/a/:key` is not
 * a route yet. When S16a moves them this last block goes red on purpose.
 */

const { movedAddress, MOVES } = await import('../src/hooks/useMovedRoutes.js');

describe('the redirect table (static moves)', () => {
  const TABLE: ReadonlyArray<[string, string, string]> = [
    ['/projects', '', '/everything'],
    ['/chats', '', '/everything?tab=sessions'],
    ['/work', '', '/everything?tab=sessions'],
    ['/work', '?filter=failed', '/everything?tab=sessions&filter=failed'],
    ['/work', '?filter=bogus', '/everything?tab=sessions'],
    ['/execute', '', '/everything?tab=sessions'],
    ['/execute', '?filter=active', '/everything?tab=sessions&filter=active'],
    ['/runs', '', '/everything?tab=sessions'],
    ['/runs', '?filter=failed', '/everything?tab=sessions&filter=failed'],
    ['/make', '', '/everything?tab=sessions'],
    ['/vibe', '', '/everything?tab=made&kind=documents'],
    ['/demo', '', '/everything?tab=made&kind=videos'],
    ['/p/kes/chronicle', '', '/everything?tab=sessions&project=kes'],
    ['/p/a%20b/chronicle', '', '/everything?tab=sessions&project=a+b'],
    ['/p/kes', '', '/everything?tab=sessions&project=kes'],
    ['/p/a%20b', '', '/everything?tab=sessions&project=a+b'],
  ];
  it.each(TABLE)('%s%s → %s', (path, search, to) => {
    expect(movedAddress(path, search)).toBe(to);
  });

  it('the table is published for the ⌘K / docs readers, one row per old address', () => {
    expect(MOVES.map((m) => m.from)).toEqual([
      '/projects', '/chats', '/work', '/execute', '/runs', '/make', '/vibe', '/demo', '/p/:id/chronicle', '/p/:id',
      // S16a-2d: the run page's addresses.
      '/runs/:id', '/runs/:id/timeline', '/p/:pid/build/:run',
      // S16a-4c: where a made thing opens.
      '/p/:pid/document', '/p/:pid/document/:doc', '/p/:pid/video', '/p/:pid/video/:run',
      // S16a-4e: a chat is its session.
      '/chat/:id', '/chat/new', '/p/:pid/chat', '/p/:pid/chat/:run',
      // S16a-4f: the shell's Build view and its project Tests view.
      '/p/:pid/build', '/p/:pid/build/new', '/p/:pid/campaigns',
    ]);
  });

  it('S16a-4f: the project Build view → its Sessions; its Tests view → Testing, scoped by ?project=', () => {
    expect(movedAddress('/p/kes/build', '')).toBe('/everything?tab=sessions&project=kes');
    expect(movedAddress('/p/kes/build/', '')).toBe('/everything?tab=sessions&project=kes');
    expect(movedAddress('/p/k%20s/build', '')).toBe('/everything?tab=sessions&project=k+s');
    expect(movedAddress('/p/kes/campaigns', '')).toBe('/testing/campaigns?project=kes');
    expect(movedAddress('/p/k%20s/campaigns', '?x=1')).toBe('/testing/campaigns?project=k+s');
    // typos stay dead, never a silent swap
    for (const p of ['/p/kes/build//x', '/p/kes/campaigns/x', '/p/kes/campaigns//x']) {
      expect(movedAddress(p, ''), p).toBeNull();
      expect(parseRoute(p).panel, p).toBe('not-found');
    }
    // each parses to where it lands (no headless tick)
    expect(parseRoute('/p/kes/build')).toMatchObject({ panel: 'everything', projectId: 'kes', mode: null });
    expect(parseRoute('/p/kes/build/new')).toMatchObject({ panel: 'home', mode: null, showLaunch: false });
    expect(parseRoute('/p/kes/campaigns')).toMatchObject({ panel: 'testing', testingPage: 'campaigns', campaignsView: false, mode: null });
  });

  it('is not a move: the launch form, a run, the project shell, a real page, a typo', () => {
    // S16a-2d: /runs/r1 and /p/kes/build/r1 are moves now (below); /runs/new stays. S16a-4f:
    // /p/kes/build and /p/kes/campaigns moved (above); /p/kes/build/new is the Desk's new-chat form.
    for (const p of ['/runs/new', '/p/kes/build/new', '/runs/r1/events', '/runs/r1/files', '/runs/r1/zzz', '/p/kes/document/d1', '/p/kes/chat/r1', '/everything', '/skills', '/nope', '/projects/kes', '/work//typo', '/work///typo', '/demo///typo', '/p/kes/chronicle//typo']) {
      expect(movedAddress(p, ''), p).toBeNull();
    }
  });
});

describe('the moved addresses parse to "See everything" (no headless tick)', () => {
  it.each(['/projects', '/chats', '/work', '/execute', '/runs', '/make', '/vibe', '/demo', '/everything', '/everything?tab=made'])('%s', (p) => {
    expect(parseRoute(p.split('?')[0]!).panel).toBe('everything');
  });
  it('/p/:id and /p/:id/chronicle parse to everything, scoped to the project', () => {
    expect(parseRoute('/p/kes')).toMatchObject({ panel: 'everything', projectId: 'kes', mode: null });
    expect(parseRoute('/p/kes/chronicle')).toMatchObject({ panel: 'everything', projectId: 'kes', mode: null });
  });
  it('typos stay dead addresses: a segment under /everything, a non-mode under /p/:id, garbage', () => {
    for (const p of ['/everything/x', '/everything//typo', '/everything///typo', '/p/kes/bogus', '/nope', '/work//typo', '/work///typo', '/demo///typo', '/p/kes/chronicle/typo', '/p/kes/chronicle//typo', '/p/kes///typo', '/p/kes//x']) {
      expect(parseRoute(p).panel, p).toBe('not-found');
    }
    // `/projects/:id` is the project management page, not a move.
    expect(parseRoute('/projects/kes')).toMatchObject({ panel: 'project-detail', projectId: 'kes' });
  });
});

describe('S16a-2d: the run page moved to the run\'s session thread', () => {
  const RUN_MOVES: Array<[string, string, string, string]> = [
    ['/runs/r1', '', '', '/s/run%3Ar1'],
    ['/runs/r1/', '', '', '/s/run%3Ar1'],
    ['/runs/r1/timeline', '', '', '/s/run%3Ar1'],
    ['/runs/r1', '?jump=3:1:900', '', '/s/run%3Ar1?jump=3:1:900'],
    ['/runs/r1', '', '#gate', '/s/run%3Ar1#gate'],
    ['/runs/r1', '', '#governance', '/s/run%3Ar1#governance'],
    ['/runs/r1/timeline', '?jump=0::5', '#gate', '/s/run%3Ar1?jump=0::5#gate'],
    ['/p/kes/build/r1', '', '', '/s/run%3Ar1'],
    ['/p/kes/build/r1', '?jump=2:0:7', '#gate', '/s/run%3Ar1?jump=2:0:7#gate'],
    ['/runs/a%20b', '', '', '/s/run%3Aa%20b'],
  ];
  it.each(RUN_MOVES)('%s%s%s → %s (search and hash kept)', (path, search, hash, to) => {
    expect(movedAddress(path, search, hash)).toBe(to);
  });

  it('the moved run addresses parse straight to the session (no headless tick)', () => {
    expect(parseRoute('/runs/r1')).toMatchObject({ panel: 'session', artifactId: 'run:r1' });
    expect(parseRoute('/runs/r1/timeline')).toMatchObject({ panel: 'session', artifactId: 'run:r1' });
    expect(parseRoute('/p/kes/build/r1')).toMatchObject({ panel: 'session', artifactId: 'run:r1' });
  });

  it('not moves: the launch form, the raw views, typos (S16a-4f moved the Build view)', () => {
    expect(parseRoute('/runs/new')).toMatchObject({ panel: 'runs', showLaunch: true });
    expect(parseRoute('/runs/r1/events')).toMatchObject({ panel: 'run-events', artifactId: 'r1' });
    expect(parseRoute('/runs/r1/files')).toMatchObject({ panel: 'run-files', artifactId: 'r1' });
    expect(parseRoute('/p/kes/document/d1')).toMatchObject({ panel: 'everything', projectId: 'kes' }); // S16a-4c: moved
    expect(parseRoute('/runs/r1/zzz').panel).toBe('not-found');
    expect(parseRoute('/runs//x').panel).toBe('not-found');
    // S16a-4a: /s/:id/a/:key is the artifact's address; a deeper path is still a dead one.
    expect(parseRoute('/s/run:r1/a/k1/x').panel).toBe('not-found');
  });
});
