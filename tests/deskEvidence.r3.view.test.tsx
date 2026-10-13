import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SeatRecordResponse } from '../src/api/types.js';
import type { WindowSpend } from '../src/hooks/useWindowSpend.js';
import { DeskV2 } from '../src/components/desk/DeskV2.js';
import { useProjectsStore } from '../src/store/projects.js';
import { useAskDock } from '../src/store/askDock.js';
import { DAY, NOW, deskRun } from './fixtures/deskV2.js';

const mocks = vi.hoisted(() => ({
  spend: { phase: 'done', current: 12, previous: null, partial: false, truncated: false } as WindowSpend,
  record: null as SeatRecordResponse | null,
  generate: vi.fn(),
  // The Work tab reads projects and repositories; a read answers empty, and no write may be sent.
  fetch: vi.fn((_url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') throw new Error('Unexpected write');
    return Promise.resolve(new Response('{"projects":[],"repos":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
  }),
}));
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
vi.mock('../src/hooks/useQualityChecks.js', () => ({ useQualityChecks: () => ({ tally: { read: 0, recorded: 0, passed: 0 }, failed: 0, capped: false }) }));
vi.mock('../src/hooks/useRoster.js', () => ({ useRoster: () => [] }));
vi.mock('../src/hooks/useDeskRecord.js', () => ({
  useDeskRecord: () => ({ phase: 'done', reads: [], window: mocks.record, truncated: false }),
  useDeskRecordByProject: () => ({ phase: 'done', byProject: new Map(), truncated: false }),
}));
vi.mock('../src/hooks/useWindowSpend.js', () => ({ useWindowSpend: () => mocks.spend }));
vi.mock('../src/hooks/useStandingOrders.js', () => ({ useStandingOrders: () => ({ state: null }) }));
vi.mock('../src/hooks/useHandover.js', () => ({ useHandover: () => ({ since: null, sections: [], dismiss: vi.fn() }) }));
vi.mock('../src/hooks/useDeskInsights.js', () => ({ useDeskInsights: () => ({ phase: 'idle' }), generateInsights: mocks.generate }));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.resolve({ acp: { byCli: { claude: { fallbacks: 4, fallbackKinds: { session_died: 4 } } } } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  useProjectsStore.setState({ projects: [], load: vi.fn(async () => {}) });
  useAskDock.setState({ request: null });
  mocks.spend = { phase: 'done', current: 12, previous: null, partial: false, truncated: false };
  mocks.record = {
    days: 30, since: NOW - 30 * DAY, until: NOW, runsRead: 2, truncated: false,
    seats: [{ cli: 'claude', units: 10, gated: 10, firstPass: 2, rework: 8, stalls: 0,
      benched: 3, benchReasons: { quota: 3 }, costUsd: 20, costedUsage: 10, byPhase: {} }],
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Desk r3 evidence on screen', () => {
  it.each([undefined, 'studio'])('labels truncated Work spend as a floor on Desk/project %s', async (projectId) => {
    mocks.spend.truncated = true;
    // Even if a prior amount is present, truncation must take precedence over a delta.
    mocks.spend.previous = 5;
    await act(async () => { render(<DeskV2 runs={[]} runsLoaded needRows={[]} now={NOW} navigate={vi.fn()}
      {...(projectId === undefined ? {} : { projectId })} />); });
    const tile = screen.getByTestId('desk-block-spend');
    expect(tile.querySelector('.wk-stat-value')).toHaveTextContent('at least $12.00');
    expect(tile.querySelector('.wk-stat-note')).toHaveTextContent('Partial: last 30 days');
    expect(tile).toHaveTextContent('newest jobs only; older ones were not read');
    expect(tile).not.toHaveTextContent('vs prior');
    expect(mocks.fetch.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('preserves whole spend and priced-only wording when the read is complete', async () => {
    const p = { runs: [], runsLoaded: true, needRows: [], now: NOW, navigate: vi.fn(), projectId: 'studio' };
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => { ({ rerender } = render(<DeskV2 {...p} />)); });
    const tile = screen.getByTestId('desk-block-spend');
    expect(tile.querySelector('.wk-stat-value')?.textContent).toBe('$12.00');
    expect(tile.querySelector('.wk-stat-note')?.textContent).toBe('last 30 days');
    mocks.spend.partial = true;
    rerender(<DeskV2 {...p} />);
    expect(tile).toHaveTextContent('last 30 days · priced usage only');
  });

  it('removes workflow-unsupported findings and carries the limitation into Understand and Report questions', async () => {
    const p = { runs: [deskRun('failed', { status: 'failed' })], runsLoaded: true, needRows: [], now: NOW, navigate: vi.fn() };
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => { ({ rerender } = render(<DeskV2 {...p} search="?tab=report" />)); });
    expect(screen.getAllByTestId('desk-callout').some((c) => c.dataset.id === 'bench:claude')).toBe(true);
    fireEvent.change(screen.getByTestId('desk-refine-workflow'), { target: { value: 'fix-bug' } });
    const improve = screen.getByTestId('desk-insights');
    expect(improve).toHaveTextContent('Agent numbers can’t be split by workflow yet');
    expect(improve).toHaveTextContent('needs crew data');
    expect(screen.queryByTestId('desk-callout')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('desk-report').find((b) => b.dataset.id === 'bench')!);
    expect(useAskDock.getState().request?.seedText).toContain('the agent record has no workflow filter');
    rerender(<DeskV2 {...p} search="?tab=understand" />);
    expect(screen.getByTestId('desk-und-agents-unread')).toHaveTextContent('Agent numbers can’t be split by workflow yet');
    expect(screen.queryByTestId('desk-compare-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desk-insights-generate')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-analyze-start')).toBeDisabled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET')).toBe(true);
  });
});
