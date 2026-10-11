import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * THE DESK RAIL after Amendment 5 (DES-STUDIO-REBUILD-001, Amendment 5 as revised; S15c):
 * top to bottom — Desk · Watchtower · the sessions list · the "Workspace" foot (Product · Skills ·
 * MCP tools · Steering · Health) · "Additional settings" (a disclosure holding Configuration,
 * Repositories, Workflows, Evals, Theme, in that order). No Notifications entry: the Desk is the
 * notification surface. Nothing that redirects appears in the menu — and (studio#421 r3 change 17)
 * the menu is NAVIGATION ONLY: the orders/away and freeze controls are the Desk sheet's.
 */

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { ADDITIONAL_SETTINGS, DESK_RAIL_LINKS } = await import('../src/board/deskModel.js');

afterEach(cleanup);

function rail(pathname = '/'): ReturnType<typeof render> {
  return render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname={pathname} />);
}

describe('the rail, top to bottom', () => {
  it('Desk · Watchtower · sessions · Product · Skills · MCP tools · Steering · Additional settings · Health — and no bell', () => {
    rail();
    const nav = screen.getByTestId('session-rail');
    const order = [...nav.querySelectorAll('[data-testid]')]
      .map((e) => e.getAttribute('data-testid') ?? '')
      .filter((id) => ['desk-rail-home', 'desk-rail-watch', 'desk-rail-product', 'desk-rail-skills', 'desk-rail-mcp', 'desk-rail-steering', 'desk-rail-health', 'desk-rail-more'].includes(id));
    expect(order).toEqual(['desk-rail-home', 'desk-rail-watch', 'desk-rail-product', 'desk-rail-skills', 'desk-rail-mcp', 'desk-rail-steering', 'desk-rail-more', 'desk-rail-health']);
    expect(nav.querySelector('[data-nav-dest="notifications"]')).toBeNull();
    expect(nav.textContent).not.toContain('Rules');
    expect(nav.textContent).not.toContain('Everything else');
    expect(screen.getByTestId('desk-rail-steering')).toHaveAttribute('href', '/rules');
    expect(screen.getByTestId('desk-rail-steering')).toHaveTextContent('Steering');
    expect(screen.getByTestId('desk-rail-product')).toHaveAttribute('href', '/product');
    expect(screen.getByTestId('desk-rail-product')).toHaveTextContent('Product');
    expect(screen.getByTestId('desk-rail-skills')).toHaveAttribute('href', '/skills');
    expect(screen.getByTestId('desk-rail-mcp')).toHaveAttribute('href', '/mcp');
    expect(screen.getByTestId('desk-rail-more')).toHaveTextContent('Additional settings');
  });

  it('the rail entries carry the skin contract\'s nav-dest marks', () => {
    rail();
    const dests = [...screen.getByTestId('session-rail').querySelectorAll('[data-nav-dest]')].map((e) => e.getAttribute('data-nav-dest'));
    expect(dests).toEqual(['watch', 'section:product', 'section:skills', 'section:mcp', 'section:steering', 'section:testing', 'settings', 'health']);
    expect(DESK_RAIL_LINKS.map((l) => l.dest)).toEqual(['section:product', 'section:skills', 'section:mcp', 'section:steering', 'section:testing']);
  });

  it('the current entry is marked', () => {
    rail('/rules');
    expect(screen.getByTestId('desk-rail-steering')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('desk-rail-home')).not.toHaveAttribute('aria-current');
  });
});

describe('"Additional settings"', () => {
  it('is a link to the /settings page, which lists exactly Configuration, Repositories, Workflows, Evals, Theme — in that order', () => {
    rail();
    expect(screen.getByTestId('desk-rail-more')).toHaveAttribute('href', '/settings');
    expect(screen.queryByTestId('desk-rail-additional')).toBeNull();
    expect(ADDITIONAL_SETTINGS.map((d) => d.label)).toEqual(['Configuration', 'Repositories', 'Workflows', 'Evals', 'Theme']);
    expect(ADDITIONAL_SETTINGS.map((d) => d.path)).toEqual(['/system', '/repos', '/workflows', '/testing/evals', '/theme']);
    expect(ADDITIONAL_SETTINGS.map((d) => d.dest)).toEqual(['settings:/system', 'section:repos', 'settings:/workflows', 'section:testing', 'settings:/theme']);
  });

  it('nothing that redirects is listed; Testing campaigns is not either (⌘K and Configuration reach it)', () => {
    const hrefs = ADDITIONAL_SETTINGS.map((d) => d.path);
    for (const old of ['/projects', '/chats', '/work', '/execute', '/vibe', '/demo', '/testing/campaigns']) expect(hrefs).not.toContain(old);
  });
});
