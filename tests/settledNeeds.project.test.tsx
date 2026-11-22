// studio#1073: an empty project's Needs you showed skeletons for seconds, because its count waited on every needs
// source (`GET /proposals` took 2-4 s). A project counts only its runs' rows, and of the REST sources only the repo
// register changes one (a failed onboarding run becomes its repo's row), so a project waits on the repos read alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Proposal } from '../src/api/proposals.js';
import type { RepoEntry, SessionView } from '../src/api/types.js';
import type { Campaign } from '../src/api/campaigns.js';
import { needsYouRows, type NeedRow, type NeedsYouInputs } from '../src/board/needsYou.js';
import { needRunId } from '../src/board/deskModel.js';
import { ALL_NEEDS_SCOPE, NEEDS_QUIET_MS, NEEDS_SETTLE_MS, resetSettledNeedsForTest, useSettledNeeds } from '../src/hooks/useNeedsRows.js';
import { useNeedsSources } from '../src/store/needsSources.js';
import { resetSystemStore, useSystemStore } from '../src/store/systemSnapshot.js';
import { makeView } from './factories.js';

const NOW = 1_700_000_000_000;
const rows = (n: number): NeedRow[] => Array.from({ length: n }, (_, i) => ({ key: `gate:r${i}`, kind: 'gate' }) as unknown as NeedRow);
const repo = (id: string): RepoEntry => ({ id, name: id, root_path: `/repos/${id}`, default_branch: 'main', registered_at: Math.floor(NOW / 1000) - 36_000 });
const inputs = (over: Partial<NeedsYouInputs>): NeedsYouInputs => ({
  runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW, ...over,
});
/** DeskV2's project filter: only the rows of the project's own runs. */
const projectRows = (all: readonly NeedRow[], runs: readonly SessionView[]): NeedRow[] => {
  const ids = new Set(runs.map((v) => v.session.id));
  return all.filter((r) => { const id = needRunId(r); return id !== null && ids.has(id); });
};

beforeEach(() => {
  vi.useFakeTimers();
  resetSettledNeedsForTest();
  // Nothing has answered yet: chats, proposals, repos and campaigns are all still out.
  useNeedsSources.setState({ chats: null, proposals: null, repos: null, readAt: {}, readOk: {} });
  resetSystemStore();
  useSystemStore.setState({ mode: 'fallback', healthAt: Date.now() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const reposAnswered = (list: RepoEntry[] = []): void => {
  useNeedsSources.setState((s) => ({ repos: list, readAt: { ...s.readAt, repos: Date.now() }, readOk: { ...s.readOk, repos: true } }));
};

describe('a project scope (studio#1073)', () => {
  it('an empty project settles on "nothing" once the repos answer, with chats, proposals and campaigns still out', () => {
    reposAnswered();
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, 'proj-empty'));
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 0, missing: [] });
  });

  it('a project with a waiting gate says it without waiting for proposals', () => {
    reposAnswered();
    const { result } = renderHook(() => useSettledNeeds(rows(2), true, false, 'proj-busy'));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 2 });
  });

  it('a failed proposals read never makes a project count partial (it adds nothing there)', () => {
    const now = Date.now();
    useNeedsSources.setState({ repos: [], readAt: { chats: now, proposals: now, repos: now, campaigns: now }, readOk: { repos: true, proposals: false } });
    const { result } = renderHook(() => useSettledNeeds(rows(1), true, false, 'proj-x'));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 1, missing: [] });
  });

  // codex r1 on studio#1306: repos decide whether a failed onboarding run is a `fail:` row (counted by its project) or
  // its repo's row (not). A count said before they answer could change when they do.
  it('still waits for the repos read; a failed one is named missing', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(1), true, false, 'proj-onboard'));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
    act(() => { useNeedsSources.setState({ readAt: { repos: Date.now() }, readOk: { repos: false } }); });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'partial', count: 1, missing: ['repositories'] });
  });

  it('runs not known yet still hold it', () => {
    reposAnswered();
    const { result } = renderHook(() => useSettledNeeds(rows(0), false, false, 'proj-empty'));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
  });

  it('the app-wide count still waits for every source', () => {
    reposAnswered();
    const { result } = renderHook(() => useSettledNeeds(rows(0), true, false, ALL_NEEDS_SCOPE));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'loading', count: null });
    // Past the settle window it counts without them (partial), once the count has held still.
    act(() => { vi.advanceTimersByTime(NEEDS_SETTLE_MS); });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    expect(result.current).toMatchObject({ phase: 'partial', count: 0 });
  });
});

// The premise of the project scope. A new REST source row keyed to a run, or a new source that changes a run's row,
// breaks one of these tests before it can break a project's count.
describe('what a project count depends on', () => {
  it('no chat, proposal, repo or campaign row carries a run id', () => {
    const proposal: Proposal = { id: 'p1', kind_type: 'memory', state: 'pending', payload: { content: 'remember p1' }, facets: {}, provenance: {}, created_at: NOW / 1000 - 3600 };
    const campaign = {
      id: 'camp-1', def_id: 'camp-1', status: 'running',
      def: { id: 'camp-1', name: 'camp-1', nodes: [{ node_id: 'n0', run_spec: { problem: 'camp-1 n0' } }] },
      node_status: { n0: 'awaiting_human' }, node_run_id: {},
    } as unknown as Campaign;
    const out = needsYouRows(inputs({
      chats: [{ chatId: 'chat-1', seats: ['claude'], idleSecs: 900 }],
      repos: [repo('repo-never')],
      campaigns: [campaign],
      proposals: [proposal],
    }));
    const leaves = out.flatMap((r) => r.members ?? [r]);
    expect(new Set(leaves.map((r) => r.key.split(':')[0]))).toEqual(new Set(['chat', 'repo', 'campaign', 'proposal']));
    expect(leaves.map(needRunId)).toEqual(leaves.map(() => null));
  });

  it('chats, proposals and campaigns never change a project run’s row; repos do (a failed onboarding run)', () => {
    const runs = [makeView({ id: 'r-onboard', status: 'failed', workflow_id: 'onboarding', repo_ref: 'repo-1' })];
    const base = { runs, failedAt: { 'r-onboard': NOW - 60_000 } };
    const alone = projectRows(needsYouRows(inputs(base)), runs);
    expect(alone.map((r) => r.key)).toEqual(['fail:r-onboard']);
    const proposal: Proposal = { id: 'p1', kind_type: 'memory', state: 'pending', payload: { content: 'x' }, facets: {}, provenance: {}, created_at: NOW / 1000 };
    const others = projectRows(needsYouRows(inputs({ ...base, chats: [{ chatId: 'chat-1', seats: ['claude'], idleSecs: 900 }], proposals: [proposal] })), runs);
    expect(others).toEqual(alone);
    // The repo register turns that failure into the repo's row, which the project filter leaves out.
    expect(projectRows(needsYouRows(inputs({ ...base, repos: [repo('repo-1')] })), runs)).toEqual([]);
  });
});
