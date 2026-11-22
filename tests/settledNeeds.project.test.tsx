// studio#1073: an empty project's Needs you showed skeletons for seconds, because its count waited on every needs
// source (`GET /proposals` took 2-4 s) although none of them can add a row to a project's count.
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

describe('a project scope (studio#1073)', () => {
  it('an empty project settles on "nothing" after the quiet window while the sources are still out', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, 'proj-empty'));
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 0, missing: [] });
  });

  it('a project with a waiting gate says it without waiting for the sources', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(2), true, false, 'proj-busy'));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 2 });
  });

  it('a failed source never makes a project count partial (it adds nothing there)', () => {
    useNeedsSources.setState({ readAt: { chats: Date.now(), proposals: Date.now(), repos: Date.now(), campaigns: Date.now() }, readOk: { proposals: false } });
    const { result } = renderHook(() => useSettledNeeds(rows(1), true, false, 'proj-x'));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 1, missing: [] });
  });

  it('runs not known yet still hold it', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(0), false, false, 'proj-empty'));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
  });

  it('the app-wide count still waits for its sources', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, ALL_NEEDS_SCOPE));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
    // Past the settle window it counts without them (partial), once the count has held still.
    act(() => { vi.advanceTimersByTime(NEEDS_SETTLE_MS); });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'partial', count: 0 });
  });
});

// The premise of the project scope: a REST source's row is never about a run, so a project's Desk (which keeps only
// its runs' rows) cannot count one. A new source row keyed to a run breaks this test, not the count.
it('no chat, proposal, repo or campaign row carries a run id', () => {
  const NOW = 1_700_000_000_000;
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
