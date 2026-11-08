import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { webSetupOf, type WebSourceSetup } from '../src/api/webSource.js';
import { WebSourceSheet } from '../src/components/sources/WebSourceSheet.js';
import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { useCapabilities } from '../src/store/capabilities.js';

/**
 * CS9, studio: the web source's sheet over a mocked crew (`GET /sources/web/setup`, `POST /sources/web/install`). What
 * Install puts on this computer is listed with versions and hashes BEFORE consent; Install sends exactly the lock and
 * image shown; with no container engine the sheet says so plainly and offers no Install; after the install the Agents
 * box shows "query" off.
 */

const H = (c: string): string => c.repeat(64);
const NO_ENGINE = 'Research needs a container engine for web search: install Docker, Rancher Desktop or Podman';
const setup = (over: Partial<WebSourceSetup> = {}): WebSourceSetup => ({
  installed: false,
  registered: false,
  installing: false,
  lock: {
    sha256: H('a'),
    packages: [
      { name: 'mcp-server-fetch', version: '2026.11.4', markers: null, sha256: [H('b'), H('c')] },
      { name: 'httpx', version: '0.28.1', markers: null, sha256: [H('d')] },
      { name: 'regex', version: '2026.11.7', markers: "python_full_version >= '3.11'", sha256: [H('e')] },
    ],
  },
  reader: { name: 'mcp-server-fetch', version: '2026.11.4', license: 'MIT', sha256: [H('b'), H('c')], installed: false },
  image: {
    ref: `docker.io/searxng/searxng:2026.11.5-3e95f6cd2@sha256:${H('f')}`,
    version: '2026.11.5-3e95f6cd2',
    digest: `sha256:${H('f')}`,
    license: 'AGPL-3.0-or-later',
    revision: '3e95f6cd2a68add0329cb162907b49289e2bc1fd',
    source: 'https://github.com/searxng/searxng/tree/3e95f6cd2a68add0329cb162907b49289e2bc1fd',
    note: 'Search runs SearXNG (AGPL-3.0), unmodified, from its official image, in your container engine.',
    present: false,
  },
  search: { ready: true, engine: 'docker', reason: null },
  python: { found: true, version: '3.12.4', reason: null },
  agents: null,
  ...over,
});

let calls: Array<{ path: string; method: string; body: unknown }> = [];
beforeEach(() => {
  calls = [];
  apiFetch.mockReset();
});
afterEach(() => cleanup());

describe('the web source sheet', () => {
  it('lists what Install puts here, with versions, the image digest, the license and every hash, before consent', () => {
    render(<WebSourceSheet initial={setup()} onClose={() => undefined} onChanged={() => undefined} />);
    expect(screen.getByTestId('web-pkg-search').textContent).toContain('SearXNG 2026.11.5-3e95f6cd2');
    expect(screen.getByTestId('web-image-digest').getAttribute('title')).toBe(`sha256:${H('f')}`);
    expect(screen.getByTestId('web-license').textContent).toContain('AGPL-3.0-or-later');
    expect(screen.getByTestId('web-pkg-reader').textContent).toContain('mcp-server-fetch 2026.11.4');
    expect(screen.getByTestId('web-lock').textContent).toContain('Plus 2 dependencies');
    fireEvent.click(screen.getByTestId('web-lock-toggle'));
    const list = screen.getByTestId('web-lock-list');
    for (const h of [H('b'), H('c'), H('d'), H('e')]) expect(list.textContent).toContain(h);
    expect(screen.getByTestId('web-agents-after-install').textContent).toContain('Agents stay off');
  });

  it('with no container engine says so plainly and offers no Install', () => {
    render(<WebSourceSheet initial={setup({ search: { ready: false, engine: null, reason: NO_ENGINE } })} onClose={() => undefined} onChanged={() => undefined} />);
    expect(screen.getByTestId('web-need-engine').textContent).toBe(NO_ENGINE);
    expect(screen.getByTestId('web-sheet-foot').textContent).toBe(NO_ENGINE);
    expect((screen.getByTestId('web-install') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Install sends exactly the lock and image shown, then shows the Agents box with query off', async () => {
    const done = setup({ installed: true, registered: true, reader: { ...setup().reader, installed: true }, image: { ...setup().image, present: true }, agents: { see: true, query: false, projects: [], everyProject: false } });
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (path === '/sources/web/install') return Promise.resolve({ setup: done });
      if (path.startsWith('/projects')) return Promise.resolve({ projects: [] });
      if (path.endsWith('/agent-queries')) return Promise.resolve({ name: 'web', known: true, queries: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const changed = vi.fn();
    render(<WebSourceSheet initial={setup()} onClose={() => undefined} onChanged={changed} />);
    fireEvent.click(screen.getByTestId('web-install'));
    await waitFor(() => expect(screen.getByTestId('web-sheet').getAttribute('data-installed')).toBe('yes'));
    expect(calls.find((c) => c.path === '/sources/web/install')?.body).toEqual({ consent: { lock: H('a'), image: `sha256:${H('f')}` } });
    const box = screen.getByTestId('web-agent-controls');
    expect(box.getAttribute('data-query')).toBe('off');
    expect(within(box).getByTestId('web-agent-controls-consequence').textContent).toContain('robots.txt');
    expect(changed).toHaveBeenCalledWith(done);
  });

  it('an install crew refuses shows crew’s words', async () => {
    apiFetch.mockImplementation((path: string) => (path === '/sources/web/install' ? Promise.reject(new Error(NO_ENGINE)) : Promise.resolve(setup())));
    render(<WebSourceSheet initial={setup()} onClose={() => undefined} onChanged={() => undefined} />);
    fireEvent.click(screen.getByTestId('web-install'));
    await waitFor(() => expect(screen.getByTestId('web-sheet-error').textContent).toBe(NO_ENGINE));
  });
});

describe('the web source on the Data sources page', () => {
  beforeEach(() => useCapabilities.setState({ loaded: true, dataSources: true, trackerLinks: false }));

  it('a crew with the web source shows its box; a crew without it (404) shows none', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/mcp/servers') return Promise.resolve({ servers: [], discovered: [] });
      if (path === '/sources/web/setup') return Promise.resolve(setup({ search: { ready: false, engine: null, reason: NO_ENGINE } }));
      return Promise.resolve({});
    });
    render(<SourcesPage navigate={() => undefined} search="" />);
    await waitFor(() => expect(screen.getByTestId('web-source-why').textContent).toBe(NO_ENGINE));
    expect(screen.getByTestId('web-source-state').textContent).toContain('needs a container engine');
    fireEvent.click(screen.getByTestId('web-add'));
    expect(screen.getByTestId('web-sheet')).toBeTruthy();
    cleanup();
    const { ApiError } = await import('../src/api/errors.js');
    apiFetch.mockImplementation((path: string) => {
      if (path === '/mcp/servers') return Promise.resolve({ servers: [], discovered: [] });
      if (path === '/sources/web/setup') return Promise.reject(new ApiError(404, 'Not Found'));
      return Promise.resolve({});
    });
    render(<SourcesPage navigate={() => undefined} search="" />);
    await waitFor(() => expect(screen.getByTestId('sources-page')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('web-source')).toBeNull();
  });

  it('reads crew’s answer whole or not at all', () => {
    expect(webSetupOf(setup())).toEqual(setup());
    expect(webSetupOf({ ...setup(), lock: { sha256: H('a'), packages: [{ name: 'x', version: '1', markers: null, sha256: ['nothex'] }] } })).toBeNull();
    expect(webSetupOf({ ...setup(), search: { ready: true, engine: 'lxc', reason: null } })).toBeNull();
  });
});
