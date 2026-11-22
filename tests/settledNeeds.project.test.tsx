// studio#1073: an empty project's Needs you showed skeletons for seconds, because its count waited on every needs
// source (`GET /proposals` took 2-4 s). A project counts only its runs' rows (DeskV2), so a project with no runs has
// nothing any read could add: it waits on none of them. A project with runs waits as before (codex r1/r2 on #1306:
// those reads also cover the runs' own first reads, which have no readiness signal).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Proposal } from '../src/api/proposals.js';
import type { RepoEntry } from '../src/api/types.js';
import type { Campaign } from '../src/api/campaigns.js';
import { needsYouRows, type NeedRow } from '../src/board/needsYou.js';
import { needRunId } from '../src/board/deskModel.js';
import { ALL_NEEDS_SCOPE, NEEDS_QUIET_MS, NEEDS_SETTLE_MS, resetSettledNeedsForTest, useSettledNeeds } from '../src/hooks/useNeedsRows.js';
import { useNeedsSources } from '../src/store/needsSources.js';
import { resetSystemStore, useSystemStore } from '../src/store/systemSnapshot.js';

const NOW = 1_700_000_000_000;
const rows = (n: number): NeedRow[] => Array.from({ length: n }, (_, i) => ({ key: `gate:r${i}`, kind: 'gate' }) as unknown as NeedRow);

beforeEach(() => {
  vi.useFakeTimers();
  resetSettledNeedsForTest();
  // Nothing has answered yet: chats, proposals, repos and campaigns are all still out.
  useNeedsSources.setState({ chats: null, proposals: null, repos: null, readAt: {}, readOk: {} });
  resetSystemStore();
  useSystemStore.setState({ mode: 'fallback', healthAt: Date.now() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('a project with no runs (studio#1073)', () => {
  it('settles on "nothing" after the quiet window while every source is still out', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, 'proj-empty', 0));
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 0, missing: [] });
  });

  it('a failed proposals read never makes it partial', () => {
    const now = Date.now();
    useNeedsSources.setState({ repos: [], chats: [], readAt: { chats: now, proposals: now, repos: now, campaigns: now }, readOk: { proposals: false } });
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, 'proj-empty', 0));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 0, missing: [] });
  });

  it('runs (and memberships) not known yet still hold it', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(0), false, false, 'proj-empty', 0));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
  });

  it('a run joining it waits on the sources again, keeping its last count meanwhile (no skeleton flash)', () => {
    const { result, rerender } = renderHook(({ r, n }) => useSettledNeeds(r, true, false, 'proj-growing', n), { initialProps: { r: rows(0), n: 0 } });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 0 });
    rerender({ r: rows(1), n: 1 });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    rerender({ r: rows(1), n: 1 });
    // The sources are still out: the new row is not said yet, the last complete count stands.
    expect(result.current).toMatchObject({ phase: 'complete', count: 0 });
  });
});

describe('everything else waits for the sources, as before', () => {
  it('a project with runs', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, 'proj-busy', 2));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
  });

  it('a project scope that does not say how many runs it holds', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, 'proj-unknown'));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
  });

  it('the app-wide count, even with no runs', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, ALL_NEEDS_SCOPE, 0));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
    // Past the settle window it counts without them (partial), once the count has held still.
    act(() => { vi.advanceTimersByTime(NEEDS_SETTLE_MS); });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'partial', count: 0 });
  });
});

// The premise: a needs source's own rows are never about a run, so DeskV2's project filter (rows of the project's
// runs only) leaves every one of them out, and a project with no runs keeps none.
it('no chat, proposal, repo or campaign row carries a run id', () => {
  const repo: RepoEntry = { id: 'repo-never', name: 'repo-never', root_path: '/repos/repo-never', default_branch: 'main', registered_at: Math.floor(NOW / 1000) - 36_000 };
  const proposal: Proposal = { id: 'p1', kind_type: 'memory', state: 'pending', payload: { content: 'remember p1' }, facets: {}, provenance: {}, created_at: NOW / 1000 - 3600 };
  const campaign = {
    id: 'camp-1', def_id: 'camp-1', status: 'running',
    def: { id: 'camp-1', name: 'camp-1', nodes: [{ node_id: 'n0', run_spec: { problem: 'camp-1 n0' } }] },
    node_status: { n0: 'awaiting_human' }, node_run_id: {},
  } as unknown as Campaign;
  const out = needsYouRows({
    runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, now: NOW,
    chats: [{ chatId: 'chat-1', seats: ['claude'], idleSecs: 900 }],
    repos: [repo],
    campaigns: [campaign],
    proposals: [proposal],
  });
  const leaves = out.flatMap((r) => r.members ?? [r]);
  expect(new Set(leaves.map((r) => r.key.split(':')[0]))).toEqual(new Set(['chat', 'repo', 'campaign', 'proposal']));
  expect(leaves.map(needRunId)).toEqual(leaves.map(() => null));
});
