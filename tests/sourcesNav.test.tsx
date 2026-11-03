import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The sidebar's Data sources entry (operator 2026-11-03: "studio has no way to get to data sources page (should go
 * in sidebar)"): in Work, below Repositories, only when the connected crew serves data sources
 * (`HealthCapabilities.apps.uploads`, DES-APPS-001 K1); current on /sources. Without the capability the entry is
 * absent, /sources is a Build & settings page, and the page says this crew doesn't support data sources yet.
 */

const apiFetch = vi.fn();
vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { SourcesPage } = await import('../src/components/sources/SourcesPage.js');
const { navCurrent, navGroups } = await import('../src/board/navModel.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useFirstRun, resetFirstRun } = await import('../src/store/firstRun.js');

beforeEach(() => {
  resetFirstRun();
  useFirstRun.setState({ read: 'ok', state: { learnUsedAt: 1 } });
  apiFetch.mockReset();
  apiFetch.mockImplementation(() => Promise.resolve({ servers: [], discovered: [] }));
});
afterEach(() => { cleanup(); useCapabilities.setState({ loaded: false, dataSources: false }); });

const rail = (pathname: string) => render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname={pathname} />);

describe('the sidebar\'s Data sources entry', () => {
  it('the model: last in Work with the capability, nowhere without it', () => {
    const work = (sources: boolean) => navGroups('insight', { sources }).find((g) => g.id === 'work')!.items.map((i) => i.label);
    expect(work(true)).toEqual(['Projects', 'Jobs', 'Apps', 'Repositories', 'Data sources']);
    expect(work(false)).toEqual(['Projects', 'Jobs', 'Apps', 'Repositories']);
    expect(navGroups('start', { sources: true }).find((g) => g.id === 'work')!.items.map((i) => i.label)).toEqual(['Learn', 'Projects', 'Jobs', 'Apps', 'Repositories', 'Data sources']);
    expect(navCurrent('/sources', { sources: true })).toBe('sources');
    expect(navCurrent('/sources')).toBe('build');
  });

  it('shows with the capability, links to /sources, and is the current page there', () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    rail('/sources');
    const item = screen.getByTestId('nav-sources');
    expect(item).toHaveAttribute('href', '/sources');
    expect(item).toHaveTextContent(/^Data sources$/);
    expect(item).toHaveAttribute('aria-current', 'page');
    expect(item).toHaveAttribute('data-nav-dest', 'page:sources');
    expect(screen.getByTestId('desk-rail-build')).not.toHaveAttribute('aria-current');
    // In the Work group, right after Repositories.
    const work = screen.getByRole('group', { name: 'Work' });
    expect([...work.querySelectorAll('a')].map((a) => a.getAttribute('data-testid'))).toEqual(['nav-projects', 'nav-jobs', 'nav-apps', 'nav-repos', 'nav-sources']);
  });

  it('is not current on another page', () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    rail('/repos');
    expect(screen.getByTestId('nav-sources')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('nav-repos')).toHaveAttribute('aria-current', 'page');
  });

  it('is hidden without the capability; /sources is then a Build & settings page', () => {
    useCapabilities.setState({ loaded: true, dataSources: false });
    rail('/sources');
    expect(screen.queryByTestId('nav-sources')).toBeNull();
    expect(screen.getByTestId('desk-rail-build')).toHaveAttribute('aria-current', 'page');
  });
});

describe('/sources on a crew without data sources', () => {
  it('says so by address, and reads nothing', () => {
    useCapabilities.setState({ loaded: true, dataSources: false });
    render(<SourcesPage navigate={vi.fn()} search="" />);
    expect(screen.getByTestId('sources-unsupported')).toHaveTextContent('This crew doesn’t support data sources yet.');
    expect(screen.queryByTestId('sources-add')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('with the capability: the page itself', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    render(<SourcesPage navigate={vi.fn()} search="" />);
    expect(await screen.findByTestId('sources-add')).toBeTruthy();
    expect(apiFetch).toHaveBeenCalledWith('/mcp/servers');
  });
});
