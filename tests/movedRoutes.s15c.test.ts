import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRoute } from '../src/hooks/useRoute.js';
import { sessionPath } from '../src/board/sessionModel.js';
import { makeView } from './factories.js';

/**
 * THE §5.4 MOVES (DES-STUDIO-REBUILD-001 §5.4, slice S15c; Amendment 5): the redirect table, as
 * data and as parses. "Redirects only for moves, never for typos" — every old list and dashboard
 * address lands on "See everything" with the right tab and filter; `/p/:id` lands on the project's
 * newest session; a typo stays a dead address.
 *
 * S16a (DES-STUDIO-REBUILD-001 §5.4 slice): the deferred moves are now active. `/runs/:id` →
 * `/s/run:<id>` (static), `/p/:id/build/:runId` → `sessionPath('run:<id>')` (static), `/p/:id/chat/:chatId` →
 * `/chat/:chatId` (static), `/p/:id/build/new` → `/runs/new` (static). The dynamic arm still
 * covers `/p/:id/:mode` → newest session and `/p/:id/document|video/:key` → newest session
 * (artifact key discarded — `/s/:id/a/:key` is deferred to a later slice). 22 of the 65 CI
 * journeys that drove those addresses have been moved or retired; see CHANGELOG.md.
 */

const listProjectMembers = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: { listProjectMembers: (...a: unknown[]) => listProjectMembers(...a) },
  apiFetch: () => Promise.resolve({}),
}));

const { movedAddress, resolveProjectNewestSession, MOVES } = await import('../src/hooks/useMovedRoutes.js');

afterEach(() => vi.clearAllMocks());

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
  ];
  it.each(TABLE)('%s%s → %s', (path, search, to) => {
    expect(movedAddress(path, search)).toBe(to);
  });

  it('the table is published for the ⌘K / docs readers, one row per old address', () => {
    expect(MOVES.map((m) => m.from)).toEqual([
      '/projects', '/chats', '/work', '/execute', '/runs', '/make', '/vibe', '/demo', '/p/:id/chronicle', '/p/:id',
      '/runs/:id', '/p/:id/build/new', '/p/:id/build/:runId', '/p/:id/chat/:chatId',
      '/p/:id/:mode', '/p/:id/document/:doc', '/p/:id/video/:demo',
    ]);
  });

  it('is not a move: the launch form, a real page, a typo', () => {
    // movedAddress returns null for dynamic-move paths (/p/:id/:mode, /p/:id) because they require
    // async resolution — the hook fires from useMovedRoutes, not movedAddress.
    // /p/kes/build/r1 and /p/kes/chat/c1 are now STATIC moves handled by movedAddress.
    for (const p of ['/runs/new', '/p/kes', '/p/kes/build', '/p/kes/document/d1', '/everything', '/skills', '/nope', '/projects/kes', '/p/kes/campaigns', '/work//typo', '/work///typo', '/demo///typo', '/p/kes/chronicle//typo']) {
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

describe('/p/:id → the project\'s newest session', () => {
  const runs = [
    makeView({ id: 'old', problem: 'first', status: 'completed', created_at: 100 } as never),
    makeView({ id: 'new', problem: 'second', status: 'executing', created_at: 200 } as never),
    makeView({ id: 'other', problem: 'elsewhere', status: 'executing', created_at: 300 } as never),
  ];
  it('picks the last launched of the project\'s runs (DTO project_id or membership), as its session', async () => {
    listProjectMembers.mockResolvedValue({ members: [{ member_kind: 'crew.run', member_ref: 'old' }, { member_kind: 'crew.run', member_ref: 'new' }] });
    expect(await resolveProjectNewestSession('kes', runs, false)).toBe('run:new');
    expect(listProjectMembers).toHaveBeenCalledWith('kes');
  });
  it('the DTO\'s project_id wins over membership: a stale membership row never claims another project\'s run', async () => {
    listProjectMembers.mockResolvedValue({ members: [{ member_kind: 'crew.run', member_ref: 'other' }, { member_kind: 'crew.run', member_ref: 'mine' }] });
    const mixed = [
      makeView({ id: 'mine', problem: 'x', status: 'completed', created_at: 10, project_id: 'kes' } as never),
      makeView({ id: 'other', problem: 'y', status: 'executing', created_at: 999, project_id: 'another' } as never),
      makeView({ id: 'unfiled', problem: 'z', status: 'executing', created_at: 500 } as never),
    ];
    // `other` is newer but the DTO files it elsewhere; `unfiled` names no project and is not a member.
    expect(await resolveProjectNewestSession('kes', mixed, false)).toBe('run:mine');
  });

  it('a failed members read still files runs by the DTO\'s project_id; nothing started → null', async () => {
    listProjectMembers.mockRejectedValue(new Error('down'));
    const filed = [makeView({ id: 'mine', problem: 'x', status: 'executing', created_at: 5, project_id: 'kes' } as never)];
    expect(await resolveProjectNewestSession('kes', filed, false)).toBe('run:mine');
    expect(await resolveProjectNewestSession('kes', [], false)).toBeNull();
  });
});

describe('S16a moves (§5.4 deferred rows now active)', () => {
  it('/runs/:id parses to the session panel and movedAddress redirects it', () => {
    expect(parseRoute('/runs/r1')).toMatchObject({ panel: 'session', artifactId: 'run:r1' });
    expect(parseRoute('/runs/new')).toMatchObject({ panel: 'runs', showLaunch: true });
    expect(parseRoute('/runs/r1')).not.toMatchObject({ panel: 'runs' });
  });
  it('movedAddress redirects /runs/:id (bare or /timeline) and rejects bogus extra segments', () => {
    expect(movedAddress('/runs/r1', '')).toBe(sessionPath('run:r1'));
    expect(movedAddress('/runs/r1/timeline', '')).toBe(sessionPath('run:r1')); // timeline allowed
    expect(movedAddress('/runs/r1/bogus', '')).toBeNull();  // extra segment → not a move
    expect(movedAddress('/runs/new', '')).toBeNull();        // launch form stays
    expect(movedAddress('/runs/r1/events', '')).toBeNull(); // raw view stays
    expect(movedAddress('/runs/r1/files', '')).toBeNull();  // raw view stays
  });
  it('movedAddress redirects /p/:id/build/:runId and /p/:id/chat/:chatId statically', () => {
    expect(movedAddress('/p/kes/build/r1', '')).toBe(sessionPath('run:r1'));
    expect(movedAddress('/p/kes/build/new', '')).toBe('/runs/new');
    expect(movedAddress('/p/kes/chat/c1', '')).toBe('/chat/c1');
    expect(movedAddress('/p/kes/build/r1/extra', '')).toBeNull(); // extra segment → not a move
    expect(movedAddress('/p/kes/document/d1', '')).toBeNull();    // still dynamic (needs newest session)
  });
  it('/p/:id/:mode parses to everything (pre-redirect tick), mode is null', () => {
    expect(parseRoute('/p/kes/build/r1')).toMatchObject({ panel: 'everything', projectId: 'kes', mode: null });
    expect(parseRoute('/p/kes/document/d1')).toMatchObject({ panel: 'everything', projectId: 'kes', mode: null });
  });
  it('/p/kes/bogus stays not-found — redirect only for moves, never typos', () => {
    expect(parseRoute('/p/kes/bogus').panel).toBe('not-found');
  });
  it('/s/:sessionId/a/:key is not a live route in S16a — artifact key deferred to a later slice', () => {
    // The /s/:id/a/:key arm was removed: extra segments under /s/:id stay not-found.
    expect(parseRoute('/s/run:r1/a/k1').panel).toBe('not-found');
    expect(parseRoute('/s/run:r1').panel).toBe('session');
  });
});
