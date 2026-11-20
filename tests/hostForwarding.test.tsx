import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HostOptions } from '../src/editors/host.js';
import type { InsightsResponse } from '../src/api/insights.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';

const hosts: HostOptions[] = [];
vi.mock('../src/editors/host.js', async (original) => ({
  ...await original<typeof import('../src/editors/host.js')>(),
  EditorHost: class {
    constructor(private opts: HostOptions) { hosts.push(opts); }
    mount() { this.opts.container.append(document.createElement('iframe')); }
    teardown() { this.opts.container.replaceChildren(); }
    setTheme() {}
    setSurface() {}
    setAppMode() {}
    appChangedByHost() {}
  },
}));
const { AppHostView } = await import('../src/components/editorHost/AppHostView.js');
const { InsightsPage } = await import('../src/components/insights/InsightsPage.js');
const { RunInsightsSlot } = await import('../src/components/insights/RunInsightsSlot.js');
const review: InsightsResponse = {
  reviews: [{ runId: 'review', trigger: 'manual', scheduleId: null, launchedAt: '2026-10-01T00:00:00Z', endedAt: null,
    status: 'completed', window: { startMs: 1, endMs: 2 }, baselineWindows: [], projectIds: [], summary: 'A sample review.',
    interpreted: true, totals: { runs: 6 }, series: [], improvements: [], regressions: [], recommendations: [], watching: [], error: null }],
  newRecommendations: 0, running: false, lastReview: null, metrics: [], minSample: 5,
};
beforeEach(() => {
  hosts.length = 0;
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/u, '');
    const body = path === '/projects' ? { projects: [] } : path === '/insights' ? review : path === '/editors' ? { editors: [{
      id: 'wicked-insights', title: 'Run insights', version: '1', sha256: 'a'.repeat(64), enabled: true, first_party: true,
      kinds: ['run-insights'], sizes: ['inline', 'pane', 'full'], protocol: [1, 2], permissions: [],
    }] } : path === '/apps/desk' ? { app: {
      slug: 'desk', name: 'Desk', projectId: 'p', repoId: 'desk', createdAt: 1, head: { version: 1, tree: 't', receipt: 'you' },
      turn: null, archived: null, spec: structuredClone(SAMPLE_APPS['escalations']!.spec),
      lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} }, queryText: {},
      versions: [], history: { states: [1], pointer: 0, canUndo: false, canRedo: false },
    } } : { grants: [] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('RunInsightsSlot forwards typing to its session composer', async () => {
  render(<><div data-testid="composer" data-composer="review-chat"><textarea /></div>
    <RunInsightsSlot runId="review" runStatus="completed" size="pane" composerKey="review-chat" /></>);
  await waitFor(() => expect(hosts).toHaveLength(1));
  act(() => hosts[0]!.ui.typed('a'));
  expect(useSessionDrafts.getState().drafts['review-chat']).toBe('a');
  expect(document.activeElement).toBe(document.querySelector('textarea'));
});

it.each(['run', 'page'] as const)('%s insights forwards exactly one Escape only from its focused frame', async (surface) => {
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
  render(<><button>Beside the frame</button>{surface === 'run' ? <RunInsightsSlot runId="review" runStatus="completed" size="pane" /> : <InsightsPage navigate={vi.fn()} />}</>);
  await waitFor(() => expect(hosts).toHaveLength(1));
  const escape = vi.fn();
  const listen = (e: KeyboardEvent) => { if (e.key === 'Escape') escape(); };
  document.addEventListener('keydown', listen);
  try {
    hosts[0]!.ui.key('Escape');
    expect(escape).not.toHaveBeenCalled();
    document.querySelector('iframe')!.focus();
    hosts[0]!.ui.key('Escape');
    expect(escape).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(document.querySelector('iframe'));
  } finally { document.removeEventListener('keydown', listen); }
});

it('AppHostView typed h opens Chat and preserves the grapheme in its composer', async () => {
  localStorage.setItem('wicked.apps.panel.collapsed', 'true');
  render(<AppHostView editor="wicked-apps" version="1" sha={'a'.repeat(64)} app="desk" sample={null}
    caps={{ apps: { query: false, actions: false, turns: true, publish: false, uploads: false, sourceCheck: false } }} />);
  await waitFor(() => expect(hosts).toHaveLength(1));
  const input = await screen.findByTestId('app-composer-input');
  fireEvent.change(input, { target: { value: 'draft ' } });
  fireEvent.click(screen.getByTestId('app-panel-rail-properties'));
  fireEvent.click(screen.getByTestId('app-panel-toggle'));
  expect(screen.getByTestId('app-panel')).toHaveAttribute('data-collapsed', 'true');
  act(() => hosts[0]!.ui.typed('h'));
  expect(screen.getByTestId('app-panel').getAttribute('data-collapsed')).toBe('false');
  expect(screen.getByTestId('app-panel-tab-chat').getAttribute('aria-selected')).toBe('true');
  await waitFor(() => expect(screen.getByTestId('app-composer-input')).toHaveValue('draft h'));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('app-composer-input')));
});

it('AppHostView forwards Escape only while its frame holds focus', async () => {
  render(<AppHostView editor="wicked-apps" version="1" sha={'a'.repeat(64)} app="desk" sample={null}
    caps={{ apps: { query: false, actions: false, turns: false, publish: false, uploads: false, sourceCheck: false } }} />);
  await waitFor(() => expect(hosts).toHaveLength(1));
  const escape = vi.fn();
  document.addEventListener('keydown', escape);
  try {
    hosts[0]!.ui.key('Escape');
    expect(escape).not.toHaveBeenCalled();
    document.querySelector('iframe')!.focus();
    hosts[0]!.ui.key('Escape');
    expect(escape).toHaveBeenCalledTimes(1);
  } finally { document.removeEventListener('keydown', escape); }
});

it('a question waiting opens the phone panel over its minimised default', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  render(<AppHostView editor="wicked-apps" version="1" sha={'a'.repeat(64)} app="desk" sample={null}
    caps={{ apps: { query: false, actions: false, turns: false, publish: false, uploads: false, sourceCheck: false } }} />);
  await waitFor(() => expect(hosts).toHaveLength(1));
  await waitFor(() => expect(screen.getByTestId('app-panel')).toHaveAttribute('data-collapsed', 'true'));
  act(() => { void hosts[0]!.app!.openLink('https://example.com'); });
  expect(screen.getByTestId('app-panel')).toHaveAttribute('data-collapsed', 'false');
});
