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
  it('Desk · Watchtower · sessions · Steering · Skills · MCP · Plugins · Evals · Repositories · General settings · Health — and no bell (operator 2026-10-12)', () => {
    rail();
    const nav = screen.getByTestId('session-rail');
    const ids = ['desk-rail-home', 'desk-rail-watch', 'desk-rail-steering', 'desk-rail-skills', 'desk-rail-mcp', 'desk-rail-plugins', 'desk-rail-evals', 'desk-rail-repos', 'desk-rail-more', 'desk-rail-health'];
    const order = [...nav.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid') ?? '').filter((id) => ids.includes(id));
    expect(order).toEqual(ids);
    expect(nav.querySelector('[data-nav-dest="notifications"]')).toBeNull();
    expect(nav.querySelector('[data-testid="desk-rail-product"], [data-testid="desk-rail-testing"]')).toBeNull();
    expect(nav.textContent).not.toContain('Everything else');
    expect(screen.getByTestId('desk-rail-steering')).toHaveAttribute('href', '/rules');
    expect(screen.getByTestId('desk-rail-mcp')).toHaveTextContent(/^MCP$/);
    expect(screen.getByTestId('desk-rail-plugins')).toHaveAttribute('href', '/plugins');
    expect(screen.getByTestId('desk-rail-evals')).toHaveAttribute('href', '/testing/evals');
    expect(screen.getByTestId('desk-rail-repos')).toHaveAttribute('href', '/repos');
    expect(screen.getByTestId('desk-rail-more')).toHaveTextContent('General settings');
  });

  it('the rail entries carry the skin contract\'s nav-dest marks', () => {
    rail();
    const dests = [...screen.getByTestId('session-rail').querySelectorAll('[data-nav-dest]')].map((e) => e.getAttribute('data-nav-dest'));
    expect(dests).toEqual(['watch', 'section:steering', 'section:skills', 'section:mcp', 'section:plugins', 'section:evals', 'section:repos', 'settings', 'health']);
  });

  it('the current entry is marked', () => {
    rail('/rules');
    expect(screen.getByTestId('desk-rail-steering')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('desk-rail-home')).not.toHaveAttribute('aria-current');
  });
});

describe('"General settings"', () => {
  it('is a link to the /settings page, which lists exactly Configuration, Workflows, Theme — in that order', () => {
    rail();
    expect(screen.getByTestId('desk-rail-more')).toHaveAttribute('href', '/settings');
    expect(screen.queryByTestId('desk-rail-additional')).toBeNull();
    expect(ADDITIONAL_SETTINGS.map((d) => [d.label, d.path, d.dest])).toEqual([
      ['Configuration', '/system', 'settings:/system'], ['Workflows', '/workflows', 'settings:/workflows'], ['Theme', '/theme', 'settings:/theme'],
    ]);
  });

  it('nothing that redirects is listed: not the retired Testing landing either', () => {
    const hrefs = [...ADDITIONAL_SETTINGS, ...DESK_RAIL_LINKS].map((d) => d.path);
    for (const old of ['/projects', '/chats', '/work', '/execute', '/vibe', '/demo', '/testing/campaigns', '/product']) expect(hrefs).not.toContain(old);
  });
});
