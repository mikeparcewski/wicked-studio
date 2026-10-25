import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * THE DESK RAIL after the operator's IA change (2026-10-13; first Amendment 5, S15c): top to bottom —
 * the wordmark (one link to the Desk, carrying its needs-you badge) · New project · the sessions list ·
 * the "Workspace" foot: Skills · MCP · Plugins · Workflows · Theme · General, then the Nerve Center tile. No
 * Desk item, no Notifications entry (the Desk is the notification surface), no "General settings"
 * overview, and none of the Desk tabs (Repositories, Steering, Evals, Agents). Navigation only.
 */

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { DESK_RAIL_LINKS } = await import('../src/board/deskModel.js');

afterEach(cleanup);

function rail(pathname = '/'): ReturnType<typeof render> {
  return render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname={pathname} />);
}

describe('the rail, top to bottom', () => {
  it('Desk (the wordmark) · New project · sessions · Skills · MCP · Plugins · Workflows · Theme · General · Nerve Center (DES-SYSTEM-VIEW)', () => {
    rail();
    const nav = screen.getByTestId('session-rail');
    const ids = ['desk-rail-home', 'desk-rail-new-project', 'desk-rail-skills', 'desk-rail-mcp', 'desk-rail-plugins', 'desk-rail-workflows', 'desk-rail-theme', 'desk-rail-general', 'desk-rail-nerve'];
    const order = [...nav.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid') ?? '').filter((id) => ids.includes(id));
    expect(order).toEqual(ids);
    expect(nav.querySelector('[data-nav-dest="notifications"]')).toBeNull();
    for (const gone of ['desk-rail-product', 'desk-rail-testing', 'desk-rail-steering', 'desk-rail-evals', 'desk-rail-repos', 'desk-rail-more', 'desk-rail-agents']) {
      expect(nav.querySelector(`[data-testid="${gone}"]`)).toBeNull();
    }
    for (const word of ['Everything else', 'General settings', 'Repositories', 'Steering', 'Evals', 'Agents']) expect(nav.textContent).not.toContain(word);
    // The wordmark is the Desk's link, and Nerve Center sits last in the Workspace foot.
    expect(screen.getByTestId('desk-rail-home')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('desk-rail-home')).toContainElement(screen.getByTestId('desk-rail-brand'));
    expect(screen.getByTestId('session-rail').lastElementChild).toContainElement(screen.getByTestId('desk-rail-nerve'));
    expect(screen.getByTestId('desk-rail-mcp')).toHaveTextContent(/^MCP$/);
    expect(screen.getByTestId('desk-rail-plugins')).toHaveAttribute('href', '/plugins');
    expect(screen.getByTestId('desk-rail-workflows')).toHaveAttribute('href', '/workflows');
    expect(screen.getByTestId('desk-rail-theme')).toHaveAttribute('href', '/theme');
    expect(screen.getByTestId('desk-rail-general')).toHaveAttribute('href', '/system');
    expect(screen.getByTestId('desk-rail-general')).toHaveTextContent(/^General$/);
  });

  it('the rail entries carry the skin contract\'s nav-dest marks', () => {
    rail();
    const dests = [...screen.getByTestId('session-rail').querySelectorAll('[data-nav-dest]')].map((e) => e.getAttribute('data-nav-dest'));
    expect(dests).toEqual(['section:skills', 'section:mcp', 'section:plugins', 'section:workflows', 'section:theme', 'section:general', 'watch']);
  });

  it('the current entry is marked', () => {
    rail('/system');
    expect(screen.getByTestId('desk-rail-general')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('desk-rail-home')).not.toHaveAttribute('aria-current');
    cleanup();
    rail('/');
    expect(screen.getByTestId('desk-rail-home')).toHaveAttribute('aria-current', 'page');
  });

  it('nothing that redirects is linked: not the retired Testing landing or the /settings overview either', () => {
    const hrefs = DESK_RAIL_LINKS.map((d) => d.path);
    for (const old of ['/projects', '/chats', '/work', '/execute', '/vibe', '/demo', '/testing/campaigns', '/product', '/settings']) expect(hrefs).not.toContain(old);
  });
});
