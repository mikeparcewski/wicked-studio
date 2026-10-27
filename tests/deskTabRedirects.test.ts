import { describe, expect, it, vi } from 'vitest';

// These suites exercise Desk addresses; chart rendering is outside their scope.
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
import { deskTabPath } from '../src/components/desk/DeskV2.js';
import { DESK_VIEW_PATH, legacyDeskTarget, navCurrent } from '../src/board/navModel.js';
import { legacySteeringTarget } from '../src/hooks/useLegacyRedirect.js';
import { parseRoute } from '../src/hooks/useRoute.js';

/**
 * The sidebar regroup (ui-v2, 2026-10-26): the Desk's tabs are pages of their own, and every old
 * global `/?tab=…[&at=…]` address lands on its page. A project's page keeps its `?tab=` tabs.
 */
describe('old Desk tab addresses land on their pages', () => {
  it.each([
    ['?tab=work', '/'],
    ['?tab=inbox', '/needs'],
    ['?tab=runs', '/jobs'],
    ['?tab=report', '/report'],
    ['?tab=report&focus=spend', '/report?focus=spend'],
    ['?tab=understand', '/understand'],
    ['?tab=repositories', '/repos'],
    [`?tab=repositories&at=${encodeURIComponent('/repos/new?project=p1')}`, '/repos/new?project=p1'],
    ['?tab=steer', '/rules'],
    [`?tab=steer&at=${encodeURIComponent('/rules/R1')}`, '/rules/R1'],
    [`?tab=steer&at=${encodeURIComponent('/steering/policies?view=table')}`, '/steering/policies?view=table'],
    ['?tab=memory', '/memory'],
    [`?tab=memory&at=${encodeURIComponent('/memory?view=proposals')}`, '/memory?view=proposals'],
    ['?tab=agents', '/agents'],
    [`?tab=agents&at=${encodeURIComponent('/agents?fix=claude')}`, '/agents?fix=claude'],
    ['?tab=evaluate', '/testing/evals'],
    ['?tab=nonsense', '/'],
  ])('/%s → %s', (search, to) => {
    expect(legacyDeskTarget(search)).toBe(to);
  });

  it('an address with no tab is Home itself (no redirect)', () => {
    expect(legacyDeskTarget('')).toBeNull();
    expect(legacyDeskTarget('?focus=spend')).toBeNull();
  });

  it.each(['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'rules'])('an `at` that is not a path on this site (%s) lands on the page home', (at) => {
    expect(legacyDeskTarget(`?tab=steer&at=${encodeURIComponent(at)}`)).toBe('/rules');
  });

  it('every page a redirect lands on is a real page, and the sidebar marks it current', () => {
    for (const path of Object.values(DESK_VIEW_PATH)) {
      expect(parseRoute(path).panel).not.toBe('not-found');
      expect(navCurrent(path)).not.toBeNull();
    }
  });
});

describe('the Desk view addresses studio builds', () => {
  it('a global view is its page; a hosted page is its own address', () => {
    expect(deskTabPath('work')).toBe('/');
    expect(deskTabPath('runs')).toBe('/jobs');
    expect(deskTabPath('report')).toBe('/report');
    expect(deskTabPath('understand')).toBe('/understand');
    expect(deskTabPath('agents', '/agents?setup=1')).toBe('/agents?setup=1');
    expect(deskTabPath('memory')).toBe('/memory');
    expect(deskTabPath('repositories', '/repos/new')).toBe('/repos/new');
  });

  it('a project keeps its tabs at `?tab=`', () => {
    // A project's address with no `?tab=` is its home; its Work view is a tab of its own.
    expect(deskTabPath('work', undefined, '/projects/p1')).toBe('/projects/p1?tab=work');
    expect(deskTabPath('runs', undefined, '/projects/p1')).toBe('/projects/p1?tab=runs');
    expect(deskTabPath('memory', '/memory?view=proposals', '/projects/p1')).toBe(`/projects/p1?tab=memory&at=${encodeURIComponent('/memory?view=proposals')}`);
  });

  it.each([['/jobs', 'jobs'], ['/report', 'report'], ['/understand', 'understand'], ['/build', 'build']])('%s parses to its page; deeper spellings are dead', (path, panel) => {
    expect(parseRoute(path).panel).toBe(panel);
    expect(parseRoute(`${path}/x`).panel).toBe('not-found');
  });

  it('repository addresses are the Repositories page; repository details stay their own page', () => {
    expect(parseRoute('/repos').panel).toBe('repos');
    expect(parseRoute('/repos/new')).toMatchObject({ panel: 'repos', showRegisterRepo: true });
    expect(parseRoute('/repo-detail/r1')).toMatchObject({ panel: 'repo-detail', repoId: 'r1' });
  });

  it('retired steering addresses land on the Steering and Memory pages (no loop back onto themselves)', () => {
    expect(legacySteeringTarget('/steering', '')).toBe('/rules');
    expect(legacySteeringTarget('/steering/memories', '')).toBe('/memory');
    expect(legacySteeringTarget('/proposals', '?type=memory')).toBe('/memory?view=proposals');
    for (const [p, q] of [['/steering', ''], ['/steering/memories', ''], ['/steering/dashboard', ''], ['/wiki', ''], ['/policies', ''], ['/proposals', '']] as const) {
      expect(legacySteeringTarget(p, q)).not.toBe(p + q);
    }
  });
});
