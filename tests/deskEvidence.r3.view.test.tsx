import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SeatRecordResponse } from '../src/api/types.js';
import type { WindowSpend } from '../src/hooks/useWindowSpend.js';
import { DeskV2 } from '../src/components/desk/DeskV2.js';
import { useProjectsStore } from '../src/store/projects.js';
import { useAskDock } from '../src/store/askDock.js';
import { DAY, NOW, deskRun } from './fixtures/deskV2.js';
import type { NeedRow } from '../src/board/needsYou.js';
import { DeskInbox } from '../src/components/desk/DeskInbox.js';

const mocks = vi.hoisted(() => ({
  spend: { phase: 'done', current: 12, previous: null, partial: false, truncated: false } as WindowSpend,
  record: null as SeatRecordResponse | null,
  generate: vi.fn(),
  handoverSince: null as number | null,
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
vi.mock('../src/hooks/useHandover.js', () => ({ useHandover: () => ({ since: mocks.handoverSince, sections: [], dismiss: vi.fn() }) }));
vi.mock('../src/hooks/useDeskInsights.js', () => ({ useDeskInsights: () => ({ phase: 'idle' }), generateInsights: mocks.generate }));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.resolve({ acp: { byCli: { claude: { fallbacks: 4, fallbackKinds: { session_died: 4 } } } } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  useProjectsStore.setState({ projects: [], load: vi.fn(async () => {}) });
  useAskDock.setState({ request: null });
  mocks.handoverSince = null;
  mocks.spend = { phase: 'done', current: 12, previous: null, partial: false, truncated: false };
  mocks.record = {
    days: 30, since: NOW - 30 * DAY, until: NOW, runsRead: 2, truncated: false,
    seats: [{ cli: 'claude', units: 10, gated: 10, firstPass: 2, rework: 8, stalls: 0,
      benched: 3, benchReasons: { quota: 3 }, costUsd: 20, costedUsage: 10, byPhase: {} }],
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Desk r3 evidence on screen', () => {
  // The landing (`/`) carries no stat tiles since home v2; a project's Work view keeps them.
  it('the landing has no Work tiles; a project page keeps them', async () => {
    await act(async () => { render(<DeskV2 runs={[]} runsLoaded needRows={[]} now={NOW} navigate={vi.fn()} />); });
    expect(screen.getByTestId('desk-work')).toHaveAttribute('data-home', 'v2');
    expect(screen.queryByTestId('desk-blocks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desk-inbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desk-happening')).not.toBeInTheDocument();
    cleanup();
    await act(async () => { render(<DeskV2 runs={[]} runsLoaded needRows={[]} now={NOW} navigate={vi.fn()} projectId="studio" />); });
    expect(screen.getByTestId('desk-blocks')).toBeInTheDocument();
  });

  it.each(['studio'])('labels truncated Work spend as a floor on project %s', async (projectId) => {
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
    await act(async () => { ({ rerender } = render(<DeskV2 {...p} view="report" />)); });
    expect(screen.getAllByTestId('desk-callout').some((c) => c.dataset.id === 'bench:claude')).toBe(true);
    fireEvent.change(screen.getByTestId('desk-refine-workflow'), { target: { value: 'fix-bug' } });
    const improve = screen.getByTestId('desk-insights');
    expect(improve).toHaveTextContent('Agent numbers can’t be split by workflow yet');
    expect(improve).toHaveTextContent('needs crew data');
    expect(screen.queryByTestId('desk-callout')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('desk-report').find((b) => b.dataset.id === 'bench')!);
    expect(useAskDock.getState().request?.seedText).toContain('the agent record has no workflow filter');
    rerender(<DeskV2 {...p} view="understand" />);
    expect(screen.getByTestId('desk-und-agents-unread')).toHaveTextContent('Agent numbers can’t be split by workflow yet');
    expect(screen.queryByTestId('desk-compare-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desk-insights-generate')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-analyze-start')).toBeDisabled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET')).toBe(true);
  });
});

const needs: NeedRow[] = ['gate', 'failed-run'].map((kind, i): NeedRow => ({
  key: `row-${i}`, kind: kind as NeedRow['kind'], severity: 100 - i, stakes: 1,
  subject: `Subject ${i}`, text: `Body ${i}`, tone: 'gate', at: null,
  subjectPath: '/watch', action: { kind: 'open', path: '/watch', label: 'Open' },
}));

describe('Desk r4 evidence (codex r4, lane half)', () => {
  it('a partial Needs-you read with no rows is never "nothing is waiting"; it names what failed and retries', () => {
    const retry = vi.fn();
    render(<DeskInbox rows={[]} runs={[]} navigate={vi.fn()} now={NOW} settled="partial" agentName={(x) => x} missing={['proposals', 'reviews']} onRetry={retry} />);
    expect(screen.getByTestId('desk-inbox-count')).toHaveTextContent('not everything could be read');
    expect(screen.getByTestId('desk-inbox-count')).not.toHaveTextContent('nothing is waiting');
    const banner = screen.getByTestId('desk-needs-partial');
    expect(banner).toHaveTextContent('proposals, reviews');
    fireEvent.click(within(banner).getByRole('button'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('before the job list is read, Report quality and Understand say nothing and start nothing', async () => {
    const p = { runs: [deskRun('a')], runsLoaded: false, needRows: [], now: NOW, navigate: vi.fn() };
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => { ({ rerender } = render(<DeskV2 {...p} view="report" />)); });
    const q = screen.getByTestId('desk-stat-quality');
    expect(q.querySelector('.wk-stat-value')).toHaveAttribute('aria-busy', 'true');
    expect(q).not.toHaveTextContent('no jobs');
    rerender(<DeskV2 {...p} view="understand" />);
    expect(screen.getByTestId('desk-und-reading')).toBeInTheDocument();
    expect(screen.queryByTestId('desk-insights-generate')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-analyze-start')).toBeDisabled();
  });

  it('the handover shows on the Desk but never on a project page', async () => {
    mocks.handoverSince = NOW - DAY;
    const p = { runs: [], runsLoaded: true, needRows: [], now: NOW, navigate: vi.fn() };
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => { ({ rerender } = render(<DeskV2 {...p} />)); });
    expect(screen.getByTestId('handover-panel')).toBeInTheDocument();
    rerender(<DeskV2 {...p} projectId="studio" />);
    expect(screen.queryByTestId('handover-panel')).not.toBeInTheDocument();
  });

  it('the focus lock is in the Desk header menu', async () => {
    await act(async () => { render(<DeskV2 runs={[]} runsLoaded needRows={needs} now={NOW} navigate={vi.fn()} />); });
    fireEvent.click(screen.getByTestId('desk-more'));
    expect(within(screen.getByTestId('desk-more-panel')).getByTestId('home-focus-toggle')).toBeInTheDocument();
  });
});
