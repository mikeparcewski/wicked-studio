import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRoute } from '../src/hooks/useRoute.js';
import { makeView } from './factories.js';

/**
 * THE §5.4 MOVES (DES-STUDIO-REBUILD-001 §5.4, slice S15c; Amendment 5): the redirect table, as
 * data and as parses. "Redirects only for moves, never for typos" — every old list and dashboard
 * address lands on "See everything" with the right tab and filter; `/p/:id` lands on the project's
 * newest session; a typo stays a dead address.
 *
 * NOT moved here (deferred to S16a, with the reason pinned by the last `describe`): `/runs/:id` →
 * `/s/:id` and `/p/:id/:mode[/:artifact]` → `/s/:id[/a/:key]`. 23 of the 65 CI journeys drive those
 * addresses for behaviours the session page does not carry yet (the gate trust record, re-run from a
 * phase, the reject-note banner, seat reassignment, the demo start form), and `/s/:id/a/:key` is not
 * a route yet. When S16a moves them this last block goes red on purpose.
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
    ]);
  });

  it('is not a move: the launch form, a run, the project shell, a real page, a typo', () => {
    for (const p of ['/runs/new', '/runs/r1', '/p/kes/build', '/p/kes/build/r1', '/p/kes', '/everything', '/skills', '/nope', '/projects/kes', '/p/kes/campaigns', '/work//typo', '/p/kes/chronicle/typo']) {
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
    for (const p of ['/everything/x', '/p/kes/bogus', '/nope', '/work//typo', '/p/kes/chronicle/typo', '/p/kes//x']) {
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

describe('deferred to S16a (goes red on purpose when those rows move)', () => {
  it('/runs/:id is still the run page and /p/:id/:mode the project shell', () => {
    expect(parseRoute('/runs/r1')).toMatchObject({ panel: 'runs', runId: 'r1' });
    expect(parseRoute('/runs/new')).toMatchObject({ panel: 'runs', showLaunch: true });
    expect(parseRoute('/p/kes/build/r1')).toMatchObject({ projectId: 'kes', mode: 'build', runId: 'r1' });
    expect(parseRoute('/p/kes/document/d1')).toMatchObject({ projectId: 'kes', mode: 'document', artifactId: 'd1' });
    expect(parseRoute('/s/run:r1/a/k1').panel).toBe('not-found');
  });
});
