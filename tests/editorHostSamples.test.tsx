import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { HostOptions } from '../src/editors/host.js';
import { devHostHref } from '../src/components/editors/EditorPluginsSettings.js';

const hosts: HostOptions[] = [];
vi.mock('../src/editors/host.js', async (original) => ({
  ...await original<typeof import('../src/editors/host.js')>(),
  EditorHost: class {
    constructor(opts: HostOptions) { hosts.push(opts); }
    mount() {}
    teardown() {}
    setSize() {}
    setTheme() {}
    setSurface() {}
    setMode() {}
    get alive() { return true; }
  },
}));
const { EditorHostPage } = await import('../src/components/editors/EditorHostPage.js');
afterEach(() => { cleanup(); hosts.length = 0; vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
it('devHostHref opens an insights editor over run-insights', () => {
  const href = devHostHref({ id: 'wicked-insights', version: '1', sha256: 'a'.repeat(64), title: 'Run insights', kinds: ['run-insights'] });
  expect(new URL(href, 'http://localhost').searchParams.get('kind')).toBe('run-insights');
});
it('EditorHostPage mounts run-insights sample content through InsightsAdapter', async () => {
  window.history.replaceState(null, '', '/editors/dev?editor=wicked-insights&version=1&sha=' + 'a'.repeat(64) + '&kind=run-insights');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ grants: [] })));
  render(<EditorHostPage mode="dev" />);
  await waitFor(() => expect(hosts.length).toBeGreaterThan(0));
  expect(hosts[0]!.adapter.artifact().kind).toBe('run-insights');
  expect(await hosts[0]!.adapter.read()).toMatchObject({ content: { type: 'run-insights', reviews: [expect.anything()] } });
  expect(screen.getByText(/sample review/i)).toBeTruthy();
});
it('EditorHostPage explains a kind with no sample without mounting a page', async () => {
  window.history.replaceState(null, '', '/editors/dev?editor=acme&version=1&sha=' + 'a'.repeat(64) + '&kind=mind-map');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ grants: [] })));
  render(<EditorHostPage mode="dev" />);
  expect(screen.getByText('The test page has no sample of mind map to open this editor on.')).toBeTruthy();
  await Promise.resolve();
  expect(hosts).toHaveLength(0);
});
