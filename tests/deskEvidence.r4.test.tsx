import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SeatRecord, SeatRecordResponse } from '../src/api/types.js';
import { spendAvailability, spendSeries, spendTotals } from '../src/board/deskInsights.js';
import { spendOf } from '../src/hooks/useWindowSpend.js';
import { DeskV2 } from '../src/components/desk/DeskV2.js';
import { useProjectsStore } from '../src/store/projects.js';
import { DAY, NOW, deskRun, names } from './fixtures/deskV2.js';

const mocks = vi.hoisted(() => ({ reads: [] as SeatRecordResponse[], projects: new Map<string, SeatRecordResponse[]>() }));
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
vi.mock('../src/hooks/useQualityChecks.js', () => ({ useQualityChecks: () => ({ tally: { read: 0, recorded: 0, passed: 0 }, failed: 0, capped: false }) }));
vi.mock('../src/hooks/useRoster.js', () => ({ useRoster: () => [] }));
vi.mock('../src/hooks/useDeskRecord.js', () => ({
  useDeskRecord: () => ({ phase: 'done', reads: mocks.reads, window: mocks.reads.at(-1), truncated: false }),
  useDeskRecordByProject: () => ({ phase: 'done', byProject: mocks.projects, truncated: false }),
}));
vi.mock('../src/hooks/useWindowSpend.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/hooks/useWindowSpend.js')>();
  return { ...original, useWindowSpend: () => {
    const spend = original.spendOf(mocks.reads.at(-1) ?? null);
    return { phase: 'done', current: spend?.usd ?? null, previous: null, partial: spend?.partial ?? false, truncated: false };
  } };
});
vi.mock('../src/hooks/useStandingOrders.js', () => ({ useStandingOrders: () => ({ state: null }) }));
vi.mock('../src/hooks/useHandover.js', () => ({ useHandover: () => ({ since: null, sections: [], dismiss: vi.fn() }) }));
vi.mock('../src/hooks/useDeskInsights.js', () => ({ useDeskInsights: () => ({ phase: 'idle' }) }));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.resolve({}) }));

function seat(cli: string, costUsd: number | null, units = 2): SeatRecord {
  return { cli, units, gated: 0, firstPass: 0, rework: 0, stalls: 0, benched: 0, benchReasons: {}, costUsd, costedUsage: costUsd === null ? 0 : 1, byPhase: {} };
}
function record(...seats: SeatRecord[]): SeatRecordResponse {
  return { days: 30, since: NOW - 30 * DAY, until: NOW, runsRead: 1, truncated: false, seats };
}
async function mount(view: 'report' | 'work' = 'report', projectId?: string): Promise<void> {
  // The global Desk's views are pages (`view`); a project's are its tabs (`?tab=`).
  const at = projectId === undefined ? { view } : { projectId, search: view === 'work' ? '' : `?tab=${view}` };
  await act(async () => { render(<DeskV2 runs={[deskRun('studio'), deskRun('crew', { project_id: 'crew' })]} runsLoaded needRows={[]} now={NOW} navigate={vi.fn()} {...at} />); });
}

beforeEach(() => {
  mocks.reads = [record(seat('claude', null))];
  mocks.projects = new Map([['studio', mocks.reads], ['crew', [record()]]]);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"projects":[],"repos":[],"events":[]}')));
  useProjectsStore.setState({ projects: [], load: vi.fn(async () => {}) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Desk r4 spend availability', () => {
  it('preserves unknown prices alongside compatible numeric agent and project buckets', () => {
    expect(spendAvailability(mocks.reads, null)).toEqual({ unpriced: true, anyPriced: false });
    expect(spendSeries(mocks.reads, null, names)).toEqual([]);
    expect(spendTotals(mocks.reads, null)).toEqual([0]);
    expect(spendOf(mocks.reads[0]!)).toBeNull();
    const mixed = [record(seat('claude', null)), record(seat('claude', 12))];
    expect(spendAvailability(mixed, null)).toEqual({ unpriced: true, anyPriced: true });
    expect(spendTotals(mixed, null)).toEqual([12, 0]);
  });

  it('limits availability to selected helpers, excluding tools and inactive unpriced seats', () => {
    const reads = [record(seat('claude', 0), seat('codex', null), seat('bash', null), seat('pi', null, 0))];
    expect(spendAvailability(reads, 'claude')).toEqual({ unpriced: false, anyPriced: true });
    expect(spendAvailability(reads, 'codex')).toEqual({ unpriced: true, anyPriced: false });
    expect(spendAvailability(reads, 'pi')).toEqual({ unpriced: false, anyPriced: false });
    expect(spendAvailability([record(seat('bash', null))], null)).toEqual({ unpriced: false, anyPriced: false });
    expect(spendAvailability([null], null)).toBeNull();
    expect(spendAvailability([{ ...reads[0]!, truncated: true }], null)).toBeNull();
  });

  it.each(['agent', 'project'])('shows unknown spend in the stat and card grouped by %s', async (group) => {
    await mount();
    fireEvent.click(screen.getByTestId(`desk-groupby-${group}`));
    const stat = screen.getByTestId('desk-stat-spend');
    expect(stat.querySelector('.wk-stat-value')?.textContent).toBe('—');
    expect(stat).toHaveTextContent('unknown: usage recorded, no price reported');
    expect(screen.getByTestId('desk-viz-spend')).toHaveTextContent('Spend unknown: usage recorded, no price reported');
    expect(stat).not.toHaveTextContent('$0');
    expect(screen.queryByTestId('desk-chart-spend')).not.toBeInTheDocument();
  });

  it.each(['agent', 'project'])('qualifies the priced subtotal grouped by %s', async (group) => {
    mocks.reads = [record(seat('claude', 12), seat('codex', null))];
    mocks.projects.set('studio', [record(seat('claude', 12))]);
    mocks.projects.set('crew', [record(seat('codex', null))]);
    await mount();
    fireEvent.click(screen.getByTestId(`desk-groupby-${group}`));
    const stat = screen.getByTestId('desk-stat-spend');
    expect(stat.querySelector('.wk-stat-value')?.textContent).toBe('at least $12.00');
    expect(stat).toHaveTextContent('priced usage only');
    expect(screen.getByTestId('desk-viz-spend')).toHaveTextContent('At least $12.00 · priced usage only');
    fireEvent.change(screen.getByTestId('desk-refine-agent'), { target: { value: 'codex' } });
    expect(stat.querySelector('.wk-stat-value')?.textContent).toBe('—');
    fireEvent.change(screen.getByTestId('desk-refine-agent'), { target: { value: 'claude' } });
    expect(stat.querySelector('.wk-stat-value')?.textContent).toBe('$12.00');
    expect(stat).not.toHaveTextContent('priced usage only');
  });

  it.each<[SeatRecord[]]>([[[]], [[seat('claude', 0)]]])('retains $0 for no usage or a known zero price: %j', async (seats) => {
    mocks.reads = [record(...seats)];
    await mount();
    expect(screen.getByTestId('desk-stat-spend').querySelector('.wk-stat-value')?.textContent).toBe('$0.00');
  });

  // The Work tiles live on a project's page (the landing has none since home v2).
  it('never shows $0 for all-unknown Work spend and qualifies partial Work spend', async () => {
    await mount('work', 'studio');
    expect(screen.getByTestId('desk-block-spend').querySelector('.wk-stat-value')?.textContent).toBe('—');
    cleanup();
    mocks.reads = [record(seat('claude', 12), seat('codex', null))];
    await mount('work', 'studio');
    expect(screen.getByTestId('desk-block-spend')).toHaveTextContent('at least $12.00');
    expect(screen.getByTestId('desk-block-spend')).toHaveTextContent('priced usage only');
  });
});
