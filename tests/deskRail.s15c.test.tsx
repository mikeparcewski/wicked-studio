import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * THE DESK RAIL after the sidebar regroup (ui-v2, operator 2026-10-26; before it the IA change of
 * 2026-10-13 and S15c): top to bottom — the wordmark (the link Home, operator 2026-10-27) · New job ·
 * New project · Chat · Search · the pages in three groups (WORK: Projects, Jobs, Repositories · INSIGHT:
 * Report, Understand, Evaluate · GOVERN: Steering, Memory, Agents) · Recent · Build & settings · the Nerve
 * Center tile. The wordmark carries the needs-you badge; Projects is WORK's primary entry; Skills, MCP, Plugins, Workflows and Settings are on the Build & settings page. No
 * Notifications entry (the Desk is the notification surface), no "General settings" overview, no More.
 */

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { BUILD_ITEM, NAV_GROUPS, navGroups } = await import('../src/board/navModel.js');
const { useFirstRun, resetFirstRun } = await import('../src/store/firstRun.js');

// DES-LEARN §3.0: Learn's place depends on studio.firstRun; these cases read it as used (below Evaluate).
beforeEach(() => { resetFirstRun(); useFirstRun.setState({ read: 'ok', state: { learnUsedAt: 1 } }); });
afterEach(cleanup);

function rail(pathname = '/'): ReturnType<typeof render> {
  return render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname={pathname} />);
}

describe('the rail, top to bottom', () => {
  it('wordmark · New job · New project · the nine pages in three groups · Build & settings · Nerve Center', () => {
    rail();
    const nav = screen.getByTestId('session-rail');
    const pages = ['nav-projects', 'nav-jobs', 'nav-repos', 'nav-report', 'nav-understand', 'nav-evaluate', 'nav-learn', 'nav-steering', 'nav-memory', 'nav-agents'];
    const ids = ['desk-rail-wordmark', 'desk-rail-new-job', 'desk-rail-new-project', ...pages, 'desk-rail-build', 'desk-rail-nerve'];
    const order = [...nav.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid') ?? '').filter((id) => ids.includes(id));
    expect(order).toEqual(ids);
    // The groups, their small-caps labels and their pages, in the mockup's words.
    expect(NAV_GROUPS.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Work', ['Projects', 'Jobs', 'Repositories']], ['Insight', ['Report', 'Understand', 'Evaluate']], ['Govern', ['Steering', 'Memory', 'Agents']],
    ]);
    for (const g of navGroups('insight')) {
      const group = screen.getByRole('group', { name: g.label });
      expect(group.querySelector('.wk-rail-sec')).toHaveTextContent(g.label);
      expect([...group.querySelectorAll('a')].map((a) => a.textContent)).toEqual(g.items.map((i) => i.label));
    }
    expect(nav.querySelector('[data-nav-dest="notifications"]')).toBeNull();
    // The Workspace links moved to Build & settings; the More menu is gone.
    for (const gone of ['desk-rail-skills', 'desk-rail-mcp', 'desk-rail-plugins', 'desk-rail-workflows', 'desk-rail-general', 'desk-rail-theme', 'rail-foot-label', 'desk-tabs-more', 'desk-rail-more']) {
      expect(nav.querySelector(`[data-testid="${gone}"]`)).toBeNull();
    }
    for (const word of ['Everything else', 'General settings', 'Workspace', 'More']) expect(nav.textContent).not.toContain(word);
    // The wordmark is the link Home (no Home item under WORK), and Nerve Center sits last.
    expect(screen.getByTestId('desk-rail-wordmark').tagName).toBe('A');
    expect(screen.getByTestId('desk-rail-wordmark')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('desk-rail-wordmark')).toHaveAccessibleName('Home');
    expect(screen.getByTestId('desk-rail-wordmark')).toContainElement(screen.getByTestId('desk-rail-brand'));
    expect(screen.queryByTestId('desk-rail-home')).toBeNull();
    // Projects is the primary WORK entry: marked, and only it.
    expect(screen.getByTestId('nav-projects')).toHaveAttribute('href', '/projects');
    expect([...nav.querySelectorAll('[data-primary="true"]')].map((e) => e.getAttribute('data-testid'))).toEqual(['nav-projects']);
    expect(screen.getByTestId('nav-projects')).toHaveClass('wk-rail-nav-item--primary');
    expect(screen.getByTestId('session-rail').lastElementChild).toContainElement(screen.getByTestId('desk-rail-nerve'));
    expect(screen.getByTestId('desk-rail-build')).toHaveAttribute('href', '/build');
    expect(screen.getByTestId('desk-rail-build')).toHaveTextContent(/^Build & settings$/);
    for (const g of NAV_GROUPS) for (const i of g.items) expect(screen.getByTestId(i.testId)).toHaveAttribute('href', i.path);
  });

  it('the rail entries carry the skin contract\'s nav-dest marks', () => {
    rail();
    const dests = [...screen.getByTestId('session-rail').querySelectorAll('[data-nav-dest]')].map((e) => e.getAttribute('data-nav-dest'));
    expect(dests).toEqual(['page:home', 'page:projects', 'page:jobs', 'page:repos', 'page:report', 'page:understand', 'page:evaluate', 'page:learn', 'page:steering', 'page:memory', 'page:agents', 'page:build', 'watch']);
  });

  it.each([
    ['/', 'desk-rail-wordmark'], ['/needs', 'desk-rail-wordmark'], ['/projects', 'nav-projects'], ['/projects/p1', 'nav-projects'], ['/jobs', 'nav-jobs'], ['/repos', 'nav-repos'], ['/repo-detail/r1', 'nav-repos'], ['/report', 'nav-report'],
    ['/understand', 'nav-understand'], ['/testing/evals', 'nav-evaluate'], ['/rules/R1', 'nav-steering'], ['/steering/proposals', 'nav-steering'],
    ['/memory', 'nav-memory'], ['/agents', 'nav-agents'], ['/build', 'desk-rail-build'], ['/system', 'desk-rail-build'], ['/skills', 'desk-rail-build'],
    ['/mcp/inspect', 'desk-rail-build'], ['/plugins', 'desk-rail-build'], ['/workflows', 'desk-rail-build'],
  ])('on %s the current page is %s, and only it', (path, id) => {
    rail(path);
    const current = [...screen.getByTestId('session-rail').querySelectorAll('[aria-current="page"]')].map((e) => e.getAttribute('data-testid'));
    expect(current).toEqual([id]);
  });

  it('a page that is not in the sidebar marks none (a session; Nerve Center marks its own tile)', () => {
    rail('/s/c1');
    expect(screen.getByTestId('session-rail').querySelectorAll('.wk-rail-nav-item[aria-current="page"]')).toHaveLength(0);
  });

  it('nothing that redirects is linked: not the retired Testing landing, the /settings overview or an old Desk tab address', () => {
    const hrefs = [...NAV_GROUPS.flatMap((g) => g.items), BUILD_ITEM].map((d) => d.path);
    for (const old of ['/chats', '/work', '/execute', '/vibe', '/demo', '/testing/campaigns', '/product', '/settings']) expect(hrefs).not.toContain(old);
    expect(hrefs.some((h) => h.includes('?tab='))).toBe(false);
  });
});

describe('Learn in the rail (DES-LEARN §3.0)', () => {
  it('never used: first in Work, above Projects, marked "Start here"', () => {
    useFirstRun.setState({ read: 'ok', state: {} });
    rail();
    const work = screen.getByRole('group', { name: 'Work' });
    expect([...work.querySelectorAll('a')].map((a) => a.getAttribute('data-testid'))).toEqual(['nav-learn', 'nav-projects', 'nav-jobs', 'nav-repos']);
    expect(screen.getByTestId('nav-learn-mark')).toHaveTextContent('Start here');
    expect(screen.getByTestId('nav-learn')).toHaveAttribute('href', '/learn');
  });

  it('used: last in Insight, below Evaluate, with no mark', () => {
    rail();
    const insight = screen.getByRole('group', { name: 'Insight' });
    expect([...insight.querySelectorAll('a')].map((a) => a.getAttribute('data-testid'))).toEqual(['nav-report', 'nav-understand', 'nav-evaluate', 'nav-learn']);
    expect(screen.queryByTestId('nav-learn-mark')).toBeNull();
  });
});
