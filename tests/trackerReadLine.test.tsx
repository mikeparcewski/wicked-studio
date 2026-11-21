import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { githubSlugOf } from '../src/api/trackers.js';
import { RepoTrackers } from '../src/components/RepoTrackers.js';
import { TrackerReadLine, trackerReadOf } from '../src/components/trackers/TrackerReadLine.js';
import { useCapabilities } from '../src/store/capabilities.js';

/**
 * studio-C9 (trackers):
 *  - studio#1013: a repository's Overview says jobs can read its linked trackers only when each linked tool's Helpers
 *    switches let them, says reading is off (with a way to that tool) when a switch keeps helpers out, and claims
 *    nothing when the switches can't be read;
 *  - studio#1012: Link a tracker on a repository whose remote is on GitHub offers that repository first, before the
 *    look-alikes a search by its short name lists.
 */

let servers: unknown[] = [];
let routes: Record<string, () => Promise<unknown>> = {};
const nav = vi.fn();
beforeEach(() => {
  servers = [];
  routes = {};
  nav.mockReset();
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const r = routes[`${init?.method ?? 'GET'} ${path}`];
    if (r !== undefined) return r();
    if (path === '/mcp/servers') return Promise.resolve({ servers, discovered: [] });
    return Promise.reject(new ApiError(404, 'not found'));
  });
  useCapabilities.setState({ loaded: true, trackerLinks: true });
});
afterEach(() => { cleanup(); useCapabilities.setState({ trackerLinks: false }); });

const access = (over: Partial<{ see: boolean; query: boolean; everyProject: boolean; projects: string[] }> = {}) => ({ see: true, query: true, everyProject: true, projects: [] as string[], ...over });
const gh = (agents: unknown) => ({ name: 'acme-gh', kind: 'mcp-http', pm: { system: 'github' }, tools: [], agents });

describe('studio#1013: whether jobs can read a repository’s trackers', () => {
  it('the rule: any tool off wins, then any tool unread (or none named), then project-limited, else all', () => {
    const t = (name: string, a: ReturnType<typeof access> | null) => ({ name, access: a });
    expect(trackerReadOf(['x'], null)).toEqual({ kind: 'reading' });
    expect(trackerReadOf(['x'], [t('x', access())])).toEqual({ kind: 'all' });
    expect(trackerReadOf(['x'], [t('x', access({ query: false }))])).toEqual({ kind: 'off', tools: [{ name: 'x', why: 'read' }] });
    expect(trackerReadOf(['x'], [t('x', access({ see: false, query: false }))])).toEqual({ kind: 'off', tools: [{ name: 'x', why: 'read' }] });
    // Reading on, but no project chosen: off for a different reason (review r1).
    expect(trackerReadOf(['x'], [t('x', access({ everyProject: false }))])).toEqual({ kind: 'off', tools: [{ name: 'x', why: 'project' }] });
    expect(trackerReadOf(['x'], [t('x', access({ everyProject: false, projects: ['p1'] }))])).toEqual({ kind: 'some', tools: ['x'] });
    expect(trackerReadOf(['x', 'y'], [t('x', access()), t('y', null)])).toEqual({ kind: 'unknown' });
    expect(trackerReadOf(['x', 'y'], [t('x', access())])).toEqual({ kind: 'unknown' });
    expect(trackerReadOf(['x', 'y', 'x'], [t('x', access({ query: false })), t('y', null)])).toEqual({ kind: 'off', tools: [{ name: 'x', why: 'read' }] });
    // No tool named at all is never "can read" (review r1).
    expect(trackerReadOf([], [t('x', access())])).toEqual({ kind: 'unknown' });
  });

  it('reading off at the tool (the default): says so and opens that tool, never “can read it”', async () => {
    servers = [gh(access({ query: false }))];
    render(<TrackerReadLine count={1} sources={['acme-gh']} navigate={nav} />);
    const line = await screen.findByTestId('repo-overview-trackers-read');
    await waitFor(() => expect(line).toHaveAttribute('data-read', 'off'));
    expect(line).toHaveTextContent('1 linked. Helpers can’t read issues from acme-gh yet: reading issues is off there. Open acme-gh');
    expect(line.textContent).not.toMatch(/can read it/);
    fireEvent.click(within(line).getByRole('link', { name: 'Open acme-gh' }));
    expect(nav).toHaveBeenCalledWith('/sources?source=acme-gh');
  });

  it('review r1: one tool off among readable ones names only that tool; reading on with no project says that', async () => {
    servers = [gh(access()), { name: 'acme-jira', kind: 'mcp-http', pm: { system: 'jira' }, tools: [], agents: access({ everyProject: false }) }];
    render(<TrackerReadLine count={2} sources={['acme-gh', 'acme-jira']} navigate={nav} />);
    await waitFor(() => expect(screen.getByTestId('repo-overview-trackers-read')).toHaveAttribute('data-read', 'off'));
    expect(screen.getByTestId('repo-overview-trackers-read')).toHaveTextContent('2 linked. Helpers can’t read issues from acme-jira yet: it names no project yet. Open acme-jira');
  });

  it('reading on for every project: jobs on this repository can read it', async () => {
    servers = [gh(access())];
    render(<TrackerReadLine count={1} sources={['acme-gh']} navigate={nav} />);
    await waitFor(() => expect(screen.getByTestId('repo-overview-trackers-read')).toHaveAttribute('data-read', 'all'));
    expect(screen.getByTestId('repo-overview-trackers-read')).toHaveTextContent('1 linked. Jobs on this repository can read it.');
  });

  it('switches that can’t be read claim nothing', async () => {
    routes['GET /mcp/servers'] = () => Promise.reject(new ApiError(503, 'down'));
    render(<TrackerReadLine count={2} sources={['acme-gh']} navigate={nav} />);
    await waitFor(() => expect(screen.getByTestId('repo-overview-trackers-read')).toHaveAttribute('data-read', 'unknown'));
    expect(screen.getByTestId('repo-overview-trackers-read')).toHaveTextContent('2 linked. Whether jobs can read them could not be checked just now.');
  });
});

describe('studio#1012: the repository’s own GitHub remote is offered first', () => {
  it('reads the remote’s owner/name from its git URL', () => {
    expect(githubSlugOf('https://github.com/acme/billing-api.git')).toBe('acme/billing-api');
    expect(githubSlugOf('git@github.com:acme/billing-api.git')).toBe('acme/billing-api');
    expect(githubSlugOf('ssh://git@github.com/acme/billing-api')).toBe('acme/billing-api');
    expect(githubSlugOf('ssh://git@github.com:22/acme/billing-api.git')).toBe('acme/billing-api');
    expect(githubSlugOf('https://github.com:443/acme/billing-api.git')).toBe('acme/billing-api');
    expect(githubSlugOf('https://gitlab.com/acme/billing-api')).toBeNull();
    expect(githubSlugOf('https://github.com/acme/billing-api/tree/main')).toBeNull();
    expect(githubSlugOf(undefined)).toBeNull();
  });

  it('a search by the short name lists look-alikes; the repository’s own comes first, once, marked as this repository', async () => {
    servers = [gh(access())];
    const tr = (key: string) => ({ tenant: 'github.com', tenantLabel: 'github.com', key, label: key.split('/')[1]!, links: [] });
    routes['GET /tracker-links?repo=billing-api'] = async () => ({ target: { repo: 'billing-api' }, links: [], viaRepos: [], projects: [], agents: [] });
    routes['GET /sources/acme-gh/trackers'] = async () => ({ name: 'acme-gh', next: null, trackers: [tr('someone/billing-api'), tr('acme/billing-api'), tr('other/billing-api')] });
    routes['GET /sources/acme-gh/trackers?q=acme%2Fbilling-api'] = async () => ({ name: 'acme-gh', next: null, trackers: [tr('acme/billing-api')] });
    render(<RepoTrackers repoId="billing-api" repoName="billing-api" gitUrl="git@github.com:acme/billing-api.git" navigate={nav} />);
    fireEvent.click(await screen.findByTestId('repo-trackers-add'));
    const picker = await screen.findByTestId('tracker-picker');
    const own = await within(picker).findByTestId('tracker-picker-own');
    expect(own).toHaveAttribute('data-key', 'acme/billing-api');
    expect(own).toHaveTextContent('This repository');
    await waitFor(() => expect(within(picker).getAllByTestId('tracker-picker-option').map((o) => o.dataset.key)).toEqual(['someone/billing-api', 'other/billing-api']));
    // It sits above the search's results.
    const rows = [...picker.querySelectorAll('[data-testid="tracker-picker-own"], [data-testid="tracker-picker-option"]')].map((r) => (r as HTMLElement).dataset.key);
    expect(rows).toEqual(['acme/billing-api', 'someone/billing-api', 'other/billing-api']);
  });

  it('review r1: a same-named repository on another GitHub host is not this repository', async () => {
    servers = [gh(access())];
    const ghe = { tenant: 'ghe.acme.example', tenantLabel: 'ghe.acme.example', key: 'acme/billing-api', label: 'billing-api', links: [] };
    routes['GET /tracker-links?repo=billing-api'] = async () => ({ target: { repo: 'billing-api' }, links: [], viaRepos: [], projects: [], agents: [] });
    routes['GET /sources/acme-gh/trackers'] = async () => ({ name: 'acme-gh', next: null, trackers: [ghe] });
    routes['GET /sources/acme-gh/trackers?q=acme%2Fbilling-api'] = async () => ({ name: 'acme-gh', next: null, trackers: [ghe] });
    render(<RepoTrackers repoId="billing-api" repoName="billing-api" gitUrl="https://github.com:443/acme/billing-api.git" navigate={nav} />);
    fireEvent.click(await screen.findByTestId('repo-trackers-add'));
    const picker = await screen.findByTestId('tracker-picker');
    await waitFor(() => expect(within(picker).getAllByTestId('tracker-picker-option')).toHaveLength(1));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => (c[0] as string).includes('?q=acme%2Fbilling-api'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(picker).queryByTestId('tracker-picker-own')).toBeNull();
  });

  it('a project’s picker, or a repository with no GitHub remote, reads no own row', async () => {
    servers = [gh(access())];
    routes['GET /tracker-links?repo=billing-api'] = async () => ({ target: { repo: 'billing-api' }, links: [], viaRepos: [], projects: [], agents: [] });
    routes['GET /sources/acme-gh/trackers'] = async () => ({ name: 'acme-gh', next: null, trackers: [] });
    render(<RepoTrackers repoId="billing-api" repoName="billing-api" gitUrl="/srv/billing-api" navigate={nav} />);
    fireEvent.click(await screen.findByTestId('repo-trackers-add'));
    await screen.findByTestId('tracker-picker-empty');
    expect(screen.queryByTestId('tracker-picker-own')).toBeNull();
    expect(apiFetch.mock.calls.map((c) => c[0] as string).filter((p) => p.includes('?q='))).toEqual([]);
  });
});
