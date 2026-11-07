/**
 * PLAN S1, part 2:
 *  - A4: which run fills a proposal card's slot; one live card per artifact (an older attempt says one line); the run's
 *    own block leaves its made bubble out when the slot draws it.
 *  - G2: a review run's Run insights shows only its own review; inline is read-only, the pane decides (D6).
 *  - G3: an app turn's App card says what the turn did in crew's words and opens the app (D8).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InsightsResponse } from '../src/api/insights.js';
import type { SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

const insights = vi.fn();
const accept = vi.fn();
vi.mock('../src/api/insights.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/insights.js')>()),
  insightsApi: { insights: () => insights(), accept: (id: string) => accept(id), dismiss: vi.fn() },
}));
vi.mock('../src/api/editors.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/editors.js')>()),
  listEditors: async () => [{ id: 'wicked-insights', version: '1', sha256: 's', title: 'Run insights', first_party: true, kinds: ['run-insights'], sizes: ['inline', 'pane', 'full'], protocol: [2], enabled: true }],
  editorFor: () => ({ id: 'wicked-insights', version: '1', sha256: 's', title: 'Run insights', first_party: true, sizes: ['inline', 'pane', 'full'] }),
}));
vi.mock('../src/editors/model.js', async (orig) => ({ ...(await orig<typeof import('../src/editors/model.js')>()), fetchGrants: async () => ({ grants: [] }) }));
// The frame is the plugin's: the host side is what is tested here. Capture the host options to point as the plugin does.
const hosts: Array<{ o: { ui: { selected: (a: unknown[]) => void }; surface?: string; adapter: { read(): Promise<{ content: { reviews: unknown[] } }> } }; surfaces: string[] }> = [];
vi.mock('../src/editors/host.js', async (orig) => ({
  ...(await orig<typeof import('../src/editors/host.js')>()),
  EditorHost: class {
    surfaces: string[] = [];
    constructor(readonly o: never) { hosts.push(this as never); }
    mount(): void {}
    teardown(): void {}
    setTheme(): void {}
    setSurface(s: string): void { this.surfaces.push(s); }
    artifactChanged(): void {}
  },
}));
const apiFetch = vi.fn();
vi.mock('../src/api/client.js', async (orig) => ({ ...(await orig<typeof import('../src/api/client.js')>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { proposalSlots, olderSlotLine } = await import('../src/board/proposalSlots.js');
const { RunInsightsSlot, insightsOfRun } = await import('../src/components/insights/RunInsightsSlot.js');
const { RunAppCard, appSlugOfRun } = await import('../src/components/session/RunAppCard.js');

const at = (v: SessionView): number => Number(v.session.id.replace(/\D/g, ''));
const run = (id: string, extra: Record<string, unknown> = {}): SessionView => makeView({ id, status: 'completed', ...extra } as never);

beforeEach(() => { hosts.length = 0; insights.mockReset(); accept.mockReset(); apiFetch.mockReset(); });
afterEach(() => cleanup());

describe('A4: a proposal card\'s slot', () => {
  it('is the run crew recorded on the result, else the run whose proposal_id is the card\'s', () => {
    const runs = [run('r1', { proposal_id: 'c:a' }), run('r2'), run('r3', { proposal_id: 'c:b' })];
    const slots = proposalSlots([{ pid: 'c:a', result: { runId: 'r2' } }, { pid: 'c:b' }, { pid: 'c:none' }], runs, at);
    expect(slots.get('c:a')!.run.session.id).toBe('r2');
    expect(slots.get('c:b')!.run.session.id).toBe('r3');
    expect(slots.has('c:none')).toBe(false);
  });

  it('two attempts at one document: only the newest draws the card; the older says crew\'s reason', () => {
    const failed = run('r1', { proposal_id: 'c:a', artifact_ref: '_unfiled/doc', landing_failed: { reason: 'the run failed', at: 1 } });
    const retry = run('r2', { proposal_id: 'c:retry:r1', artifact_ref: '_unfiled/doc' });
    const slots = proposalSlots([{ pid: 'c:a' }, { pid: 'c:retry:r1' }], [failed, retry], at);
    expect(slots.get('c:a')!.older).toBe(true);
    expect(slots.get('c:retry:r1')!.older).toBe(false);
    expect(olderSlotLine(failed)).toBe('Not made: the run failed');
    expect(olderSlotLine(run('r9'))).toBe('Shown below, with the newer attempt.');
  });
});

function review(runId: string, recs: number): InsightsResponse['reviews'][number] {
  return {
    runId, trigger: 'manual', scheduleId: null, launchedAt: '2026-11-01T00:00:00Z', endedAt: '2026-11-01T01:00:00Z', status: 'completed',
    window: { startMs: 0, endMs: 1 }, baselineWindows: [], projectIds: [], summary: null, interpreted: true, totals: { runs: 6 }, series: [],
    improvements: [], regressions: [], watching: [], error: null,
    recommendations: Array.from({ length: recs }, (_, j) => ({
      id: `${runId}:rec${j}`, candidate: 'resolve-stale', kind: 'resolve-stale' as const, title: `Resolve ${j}`,
      evidence: { line: 'Six runs failed.', runs: [], n: 6 }, expectedEffect: 'A clean list.', confidence: 'medium' as const, changeMind: 'If parked.', impact: 1, basis: 'pattern' as const,
      action: { runs: [] }, state: 'new' as const, reason: null, decidedAt: null, proposalId: null, proposalError: null,
    })),
  } as never;
}
const RESPONSE: InsightsResponse = { reviews: [review('rv-1', 2), review('rv-2', 1)], newRecommendations: 3, running: false, lastReview: null, metrics: [], minSample: 5 };

describe('G2: Run insights in the review run\'s thread', () => {
  it('shows only this run\'s review', () => {
    expect(insightsOfRun(RESPONSE, 'rv-2').reviews.map((r) => r.runId)).toEqual(['rv-2']);
  });

  it('inline is read-only (no decide aside); the pane decides on what the plugin points at', async () => {
    insights.mockResolvedValue(RESPONSE);
    const { rerender } = render(<RunInsightsSlot runId="rv-1" runStatus="completed" size="inline" />);
    await waitFor(() => expect(hosts).toHaveLength(1));
    expect(hosts[0]!.o.surface).toBe('card');
    const content = (await hosts[0]!.o.adapter.read()).content;
    expect(content.reviews).toHaveLength(1);
    expect(screen.queryByTestId('insights-decide')).toBeNull();

    rerender(<RunInsightsSlot runId="rv-1" runStatus="completed" size="pane" />);
    expect(hosts).toHaveLength(1); // the one frame, told its new surface
    expect(hosts[0]!.surfaces).toContain('full');
    expect(screen.getByTestId('insights-decide')).toBeDefined();
    hosts[0]!.o.ui.selected([{ kind: 'element', id: 'v0r1' }]);
    expect((await screen.findByTestId('insights-decide-title')).textContent).toBeTruthy();
    accept.mockResolvedValue({ open: { kind: 'runs', runIds: [] } });
    fireEvent.click(screen.getByTestId('insights-accept'));
    await waitFor(() => expect(accept).toHaveBeenCalledWith('rv-1:rec1'));
  });

  it('a review run with no report yet says so', async () => {
    insights.mockResolvedValue(RESPONSE);
    render(<RunInsightsSlot runId="rv-9" runStatus="executing" size="inline" />);
    expect((await screen.findByTestId('run-insights-state')).textContent).toContain('still running');
  });
});

describe('G3: the App card in an app turn\'s thread', () => {
  const detail = (turns: unknown[]) => ({ app: { slug: 'open-tickets', name: 'Open tickets', head: { version: 3, tree: 't', receipt: null }, versions: [], turns, spec: {}, lock: {}, queryText: {} } });
  it('reads the app slug off crew\'s run id', () => {
    expect(appSlugOfRun('apps-open-tickets-support-01f450e70f3c')).toBe('open-tickets-support');
    expect(appSlugOfRun('apps-x')).toBeNull();
    expect(appSlugOfRun('9c64a070-244e-46ed-97b4-3f48758f2121')).toBeNull();
  });

  it('a turn that ended without landing says crew\'s reason; Open the app goes to the app', async () => {
    apiFetch.mockResolvedValue(detail([{ runId: 'apps-open-tickets-0123456789ab', at: 1, actor: 'u', message: 'm', about: [], base: 3, state: 'refused', endedAt: 2, version: null, change: null, summary: null, builder: null, reviewer: null, code: 'check_failed', reason: 'the query names no table' }]));
    const push = vi.spyOn(history, 'pushState');
    render(<RunAppCard runId="apps-open-tickets-0123456789ab" runStatus="failed" />);
    expect((await screen.findByText(/Nothing landed: the query names no table/)).getAttribute('data-testid')).toBe('run-app-line');
    expect(screen.queryByTestId('run-app-preview')).toBeNull();
    fireEvent.click(screen.getByTestId('run-app-open'));
    expect(push.mock.calls.at(-1)?.[2]).toBe('/apps/open-tickets');
  });

  it('a landed turn names its version and crew\'s change line', async () => {
    apiFetch.mockResolvedValue(detail([{ runId: 'apps-open-tickets-0123456789ab', at: 1, actor: 'u', message: 'm', about: [], base: 2, state: 'landed', endedAt: 2, version: 3, change: 'Added 1 chart', summary: null, builder: 'claude', reviewer: 'codex', code: null, reason: null }]));
    render(<RunAppCard runId="apps-open-tickets-0123456789ab" runStatus="completed" />);
    expect((await screen.findByTestId('run-app-line')).textContent).toMatch(/^v3 · Added 1 chart/);
    expect(screen.getByTestId('run-app-version').textContent).toBe('Version 3');
  });
});
