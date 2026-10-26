import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * THE DESK RAIL after the sidebar regroup (ui-v2, operator 2026-10-26; before it the IA change of
 * 2026-10-13 and S15c): top to bottom — the wordmark (a label) · New job · New project · Chat · Search ·
 * the pages in three groups (WORK: Home, Jobs, Repositories · INSIGHT: Report, Understand, Evaluate ·
 * GOVERN: Steering, Memory, Agents) · Recent · Build & settings · the Nerve Center tile. Home carries the
 * needs-you badge; Skills, MCP, Plugins, Workflows and Settings are on the Build & settings page. No
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
const { BUILD_ITEM, NAV_GROUPS } = await import('../src/board/navModel.js');

afterEach(cleanup);

function rail(pathname = '/'): ReturnType<typeof render> {
  return render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname={pathname} />);
}

describe('the rail, top to bottom', () => {
  it('wordmark · New job · New project · the nine pages in three groups · Build & settings · Nerve Center', () => {
    rail();
    const nav = screen.getByTestId('session-rail');
    const pages = ['desk-rail-home', 'nav-jobs', 'nav-repos', 'nav-report', 'nav-understand', 'nav-evaluate', 'nav-steering', 'nav-memory', 'nav-agents'];
    const ids = ['desk-rail-wordmark', 'desk-rail-new-job', 'desk-rail-new-project', ...pages, 'desk-rail-build', 'desk-rail-nerve'];
    const order = [...nav.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid') ?? '').filter((id) => ids.includes(id));
    expect(order).toEqual(ids);
    // The groups, their small-caps labels and their pages, in the mockup's words.
    expect(NAV_GROUPS.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Work', ['Home', 'Jobs', 'Repositories']], ['Insight', ['Report', 'Understand', 'Evaluate']], ['Govern', ['Steering', 'Memory', 'Agents']],
    ]);
    for (const g of NAV_GROUPS) {
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
    // The wordmark is a label (Home is the page), and Nerve Center sits last.
    expect(screen.getByTestId('desk-rail-wordmark').tagName).toBe('DIV');
    expect(screen.getByTestId('desk-rail-wordmark')).toContainElement(screen.getByTestId('desk-rail-brand'));
    expect(screen.getByTestId('desk-rail-home')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('session-rail').lastElementChild).toContainElement(screen.getByTestId('desk-rail-nerve'));
    expect(screen.getByTestId('desk-rail-build')).toHaveAttribute('href', '/build');
    expect(screen.getByTestId('desk-rail-build')).toHaveTextContent(/^Build & settings$/);
    for (const g of NAV_GROUPS) for (const i of g.items) expect(screen.getByTestId(i.testId)).toHaveAttribute('href', i.path);
  });

  it('the rail entries carry the skin contract\'s nav-dest marks', () => {
    rail();
    const dests = [...screen.getByTestId('session-rail').querySelectorAll('[data-nav-dest]')].map((e) => e.getAttribute('data-nav-dest'));
    expect(dests).toEqual(['page:home', 'page:jobs', 'page:repos', 'page:report', 'page:understand', 'page:evaluate', 'page:steering', 'page:memory', 'page:agents', 'page:build', 'watch']);
  });

  it.each([
    ['/', 'desk-rail-home'], ['/jobs', 'nav-jobs'], ['/repos', 'nav-repos'], ['/repo-detail/r1', 'nav-repos'], ['/report', 'nav-report'],
    ['/understand', 'nav-understand'], ['/testing/evals', 'nav-evaluate'], ['/rules/R1', 'nav-steering'], ['/steering/proposals', 'nav-steering'],
    ['/memory', 'nav-memory'], ['/agents', 'nav-agents'], ['/build', 'desk-rail-build'], ['/system', 'desk-rail-build'], ['/skills', 'desk-rail-build'],
    ['/mcp/inspect', 'desk-rail-build'], ['/plugins', 'desk-rail-build'], ['/workflows', 'desk-rail-build'],
  ])('on %s the current page is %s, and only it', (path, id) => {
    rail(path);
    const current = [...screen.getByTestId('session-rail').querySelectorAll('[aria-current="page"]')].map((e) => e.getAttribute('data-testid'));
    expect(current).toEqual([id]);
  });

  it('a page that is not in the sidebar marks none (a session, a project, Nerve Center marks its own tile)', () => {
    rail('/projects/p1');
    expect(screen.getByTestId('session-rail').querySelectorAll('.wk-rail-nav-item[aria-current="page"]')).toHaveLength(0);
  });

  it('nothing that redirects is linked: not the retired Testing landing, the /settings overview or an old Desk tab address', () => {
    const hrefs = [...NAV_GROUPS.flatMap((g) => g.items), BUILD_ITEM].map((d) => d.path);
    for (const old of ['/projects', '/chats', '/work', '/execute', '/vibe', '/demo', '/testing/campaigns', '/product', '/settings']) expect(hrefs).not.toContain(old);
    expect(hrefs.some((h) => h.includes('?tab='))).toBe(false);
  });
});
