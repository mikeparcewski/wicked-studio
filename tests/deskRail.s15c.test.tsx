import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * THE DESK RAIL after Amendment 5 (DES-STUDIO-REBUILD-001, Amendment 5 as revised; S15c):
 * top to bottom — Desk · Watchtower · the sessions list · Skills · MCP tools · Steering · Health ·
 * "Additional settings" (a disclosure holding Configuration, Repositories, Workflows, Evals, Theme,
 * in that order, plus the orders/away and freeze controls). No Notifications entry: the Desk is the
 * notification surface. Nothing that redirects appears in the menu.
 */

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));
// The two controls under "Additional settings" have their own tests; here they are presence only.
vi.mock('../src/components/StandingOrdersPanel.js', () => ({ StandingOrdersPanel: () => <div data-testid="standing-orders" /> }));
vi.mock('../src/components/DeliveryFreezeSwitch.js', () => ({ DeliveryFreezeSwitch: () => <div data-testid="delivery-freeze" /> }));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { ADDITIONAL_SETTINGS, DESK_RAIL_LINKS } = await import('../src/board/deskModel.js');

afterEach(cleanup);

function rail(pathname = '/'): ReturnType<typeof render> {
  return render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname={pathname} />);
}

describe('the rail, top to bottom', () => {
  it('Desk · Watchtower · sessions · Product · Skills · MCP tools · Steering · Health · Additional settings — and no bell', () => {
    rail();
    const nav = screen.getByTestId('session-rail');
    const order = [...nav.querySelectorAll('[data-testid]')]
      .map((e) => e.getAttribute('data-testid') ?? '')
      .filter((id) => ['desk-rail-home', 'desk-rail-watch', 'desk-rail-start', 'desk-rail-product', 'desk-rail-skills', 'desk-rail-mcp', 'desk-rail-steering', 'rail-health-section', 'desk-rail-more'].includes(id));
    expect(order).toEqual(['desk-rail-home', 'desk-rail-watch', 'desk-rail-start', 'desk-rail-product', 'desk-rail-skills', 'desk-rail-mcp', 'desk-rail-steering', 'rail-health-section', 'desk-rail-more']);
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
    expect(dests).toEqual(['watch', 'section:product', 'section:skills', 'section:mcp', 'section:steering', 'health']);
    expect(DESK_RAIL_LINKS.map((l) => l.dest)).toEqual(['section:product', 'section:skills', 'section:mcp', 'section:steering']);
  });

  it('the current entry is marked', () => {
    rail('/rules');
    expect(screen.getByTestId('desk-rail-steering')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('desk-rail-home')).not.toHaveAttribute('aria-current');
  });
});

describe('"Additional settings"', () => {
  it('lists exactly Configuration, Repositories, Workflows, Evals, Theme — in that order — plus the controls', () => {
    rail();
    expect(screen.queryByTestId('desk-rail-additional')).toBeNull();
    fireEvent.click(screen.getByTestId('desk-rail-more'));
    const menu = screen.getByTestId('desk-rail-additional');
    const links = within(menu).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Configuration', 'Repositories', 'Workflows', 'Evals', 'Theme']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/system', '/repos', '/workflows', '/testing/evals', '/theme']);
    expect(links.map((a) => a.getAttribute('data-nav-dest'))).toEqual(['settings:/system', 'section:repos', 'settings:/workflows', 'section:testing', 'settings:/theme']);
    expect(within(menu).getByTestId('desk-rail-controls')).toBeInTheDocument();
    expect(ADDITIONAL_SETTINGS.map((d) => d.label)).toEqual(['Configuration', 'Repositories', 'Workflows', 'Evals', 'Theme']);
  });

  it('nothing that redirects is in the menu; Testing campaigns is not either (⌘K and Configuration reach it)', () => {
    rail();
    fireEvent.click(screen.getByTestId('desk-rail-more'));
    const hrefs = within(screen.getByTestId('desk-rail-additional')).getAllByRole('link').map((a) => a.getAttribute('href'));
    for (const old of ['/projects', '/chats', '/work', '/execute', '/vibe', '/demo', '/testing/campaigns']) expect(hrefs).not.toContain(old);
  });
});
