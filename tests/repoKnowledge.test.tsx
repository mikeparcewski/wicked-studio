import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry } from '../src/api/types.js';
import { ApiError } from '../src/api/errors.js';
import { compactCount, knowledgeMarks, knowledgeSentence, kindsRead, type RepoKnowledgeRead } from '../src/board/repoKnowledge.js';
import { makeView } from './factories.js';

/**
 * WHAT WE KNOW about a repository (operator, round 10): five marks, each a link, from data crew serves —
 * `GET /governance/graph?repo=` (node kinds), `GET /repos/:id/requirements?limit=1` (coverage + graphBuild) and
 * the run list. A failed read says unknown, never none.
 */

const mocks = vi.hoisted(() => ({
  kinds: vi.fn(),
  reqs: vi.fn(),
  listRepos: vi.fn(),
  listRuns: vi.fn(),
}));
vi.mock('../src/api/client.js', () => ({
  api: {
    getGraphKindsForRepo: mocks.kinds,
    listRequirements: mocks.reqs,
    listRepos: mocks.listRepos,
    listRuns: mocks.listRuns,
    getRepoGraph: () => Promise.resolve({ graph: null }),
    listProjects: () => Promise.resolve({ projects: [] }),
  },
}));
vi.mock('../src/components/RepoGraphModal.js', () => ({
  RepoGraphModal: ({ repo, initialView }: { repo: { name: string }; initialView?: string }) => <div data-testid="repo-graph-stub" data-view={initialView ?? 'code'}>{repo.name}</div>,
}));
vi.mock('../src/components/RequirementsModal.js', () => ({
  RequirementsModal: ({ repoName }: { repoName: string }) => <div data-testid="requirements-stub">{repoName}</div>,
}));

const { useRepoKnowledge, useRepoKnowledgeFor, resetRepoKnowledge, MAX_IN_FLIGHT, FRESH_MS, READ_TIMEOUT_MS } = await import('../src/store/repoKnowledge.js');
const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');
const { resetRepoLanguages } = await import('../src/hooks/useRepoLanguages.js');

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const S = NOW / 1000;
const repo = (id: string, findings: RepoEntry['findings'] = []): RepoEntry => ({ id, name: id, root_path: `/r/${id}`, default_branch: 'main', registered_at: S - 86_400 * 30, findings });
const COV = { realPct: 80, minPct: 80, behaviorBearing: 4333, real: 3476, placeholders: 836, unmapped: 21, notProduct: 2256 };
const CREW_KINDS = [{ kind: 'File', count: 901 }, { kind: 'Function', count: 4636 }, { kind: 'domain', count: 38 }, { kind: 'requirements_graph', count: 1 }, { kind: 'Variable', count: 40_901 }];
const RUNS = [
  makeView({ id: 'onb', repo_ref: 'crew', workflow_id: 'onboarding', status: 'completed', created_at: S - 2 * 86_400 }),
  makeView({ id: 'd-old', repo_ref: 'crew', workflow_id: 'domain-extraction', status: 'cancelled', created_at: S - 3 * 3600 }),
  makeView({ id: 'd-new', repo_ref: 'crew', workflow_id: 'domain-extraction', status: 'completed', created_at: S - 3600 }),
  makeView({ id: 'bug-1', repo_ref: 'crew', workflow_id: 'bug', status: 'completed', created_at: S - 5 * 3600 }),
  makeView({ id: 'feat-1', repo_ref: 'crew', workflow_id: 'feature', status: 'failed', created_at: S - 600 }),
  makeView({ id: 'other-repo', repo_ref: 'pi', workflow_id: 'bug', status: 'completed', created_at: S - 60 }),
  makeView({ id: 'archived', repo_ref: 'crew', workflow_id: 'bug', status: 'completed', created_at: S - 30, archived_at: S - 10 }),
];
const known = (over: Partial<RepoKnowledgeRead> = {}): RepoKnowledgeRead => ({
  kinds: kindsRead(CREW_KINDS),
  reqs: { state: 'ok', coverage: COV, build: { generation: 3, coverage: COV, behind: false } },
  ...over,
});
const byId = (marks: ReturnType<typeof knowledgeMarks>) => Object.fromEntries(marks.map((m) => [m.id, m]));

describe('what we know (pure)', () => {
  it('folds node kinds into the graph size, its files and its domains', () => {
    expect(kindsRead(CREW_KINDS)).toEqual({ state: 'ok', nodes: 46_477, files: 901, domains: 38, reqGraph: true });
    expect(kindsRead([])).toEqual({ state: 'ok', nodes: 0, files: 0, domains: 0, reqGraph: false });
    expect([compactCount(980), compactCount(1234), compactCount(46_477), compactCount(999_499), compactCount(999_500), compactCount(2_340_000)]).toEqual(['980', '1.2k', '46k', '999k', '1M', '2.3M']);
  });

  it('a fully known repository: five marks, each linked to the thing itself', () => {
    const m = byId(knowledgeMarks(repo('crew'), RUNS, known(), NOW));
    expect(m.code).toMatchObject({ value: '46k symbols', tone: 'ok', target: { kind: 'code-graph' } });
    expect(m.code!.title).toContain('46,477 nodes in 901 files');
    expect(m.code!.title).toContain('indexed 2 days ago');
    expect(m.reqs).toMatchObject({ value: '80% real', tone: 'ok', meter: { pct: 80, min: 80 }, target: { kind: 'requirements' } });
    expect(m.reqs!.title).toBe('Requirements: 80% real (3,476 of 4,333), minimum 80%, 836 placeholders');
    expect(m.reqgraph).toMatchObject({ value: 'build 3 · 38 domains', tone: 'ok', target: { kind: 'req-graph' } });
    expect(m.reqgraph!.flag).toBeUndefined();
    // Domain runs: the newest is the one linked (its status is the tone); archived runs and other repos' are not counted.
    expect(m['domain-runs']).toMatchObject({ value: '2', tone: 'ok', target: { kind: 'run', runId: 'd-new' } });
    // Other runs: everything but onboarding (the code graph's) and domain extraction.
    expect(m.runs).toMatchObject({ value: '2', tone: 'fail', target: { kind: 'run', runId: 'feat-1' } });
    expect(knowledgeSentence(Object.values(m))).toContain('Requirements graph build 3 · 38 domains');
  });

  it('below the minimum, a graph behind, and none extracted yet', () => {
    const below = { ...COV, realPct: 54, real: 2340 };
    const m = byId(knowledgeMarks(repo('crew'), RUNS, known({ reqs: { state: 'ok', coverage: below, build: { generation: 2, coverage: null, behind: true } } }), NOW));
    expect(m.reqs).toMatchObject({ value: '54% real', tone: 'warn', meter: { pct: 54, min: 80 } });
    expect(m.reqgraph).toMatchObject({ value: 'build 2 · 38 domains', tone: 'warn', flag: 'behind' });
    const none = byId(knowledgeMarks(repo('crew'), [], known({ kinds: kindsRead([{ kind: 'File', count: 3 }, { kind: 'Function', count: 9 }]), reqs: { state: 'none', share: null } }), NOW));
    expect(none.reqs).toMatchObject({ value: 'none yet', tone: 'none', target: { kind: 'requirements' } });
    expect(none.reqgraph).toMatchObject({ value: 'not built', tone: 'none' });
    expect(none['domain-runs']).toMatchObject({ value: 'none', tone: 'none', target: { kind: 'none' } });
    // Not generated, with a share counted so far: the share when some are real, none when none is.
    const share = { ...COV, realPct: 9, real: 390 };
    expect(byId(knowledgeMarks(repo('crew'), [], known({ reqs: { state: 'none', share } }), NOW)).reqs).toMatchObject({ value: '9% real', tone: 'warn' });
    const zeroShare = byId(knowledgeMarks(repo('crew'), [], known({ reqs: { state: 'none', share: { ...COV, realPct: 0, real: 0, placeholders: 0 } } }), NOW)).reqs!;
    expect(zeroShare).toMatchObject({ value: 'none yet', tone: 'none' });
    expect(zeroShare.title).toContain('0 of 4,333 behaviours)');
    const zeroWithPlaceholders = byId(knowledgeMarks(repo('crew'), [], known({ reqs: { state: 'none', share: { ...COV, realPct: 0, real: 0, placeholders: 12 } } }), NOW)).reqs!;
    expect(zeroWithPlaceholders.title).toContain('0 of 4,333 behaviours, 12 placeholders');
    // A build of 0 is "not built", whatever the requirements say.
    const zero = byId(knowledgeMarks(repo('crew'), [], known({ reqs: { state: 'ok', coverage: COV, build: { generation: 0, coverage: null, behind: true } } }), NOW));
    expect(zero.reqgraph).toMatchObject({ value: 'not built', tone: 'none' });
  });

  it('a failed read is unknown, never none, whatever else answered; the engine’s findings outrank a finished index; an index in flight links its run', () => {
    const failed = byId(knowledgeMarks(repo('crew'), RUNS, { kinds: { state: 'failed' }, reqs: { state: 'failed' } }, NOW));
    expect(failed.code).toMatchObject({ value: 'unknown', tone: 'unknown' });
    expect(failed.reqs).toMatchObject({ value: 'unknown', tone: 'unknown' });
    expect(failed.reqgraph).toMatchObject({ value: 'unknown', tone: 'unknown' });
    // No onboarding run on record does not turn a failed size read into "not built".
    expect(byId(knowledgeMarks(repo('crew'), [], { kinds: { state: 'failed' }, reqs: { state: 'failed' } }, NOW)).code).toMatchObject({ value: 'unknown', tone: 'unknown' });
    // The requirements read failed while the graph's kinds answered without a requirements_graph node: unknown.
    const noReqNode = kindsRead([{ kind: 'File', count: 3 }, { kind: 'Function', count: 9 }]);
    expect(byId(knowledgeMarks(repo('crew'), RUNS, { kinds: noReqNode, reqs: { state: 'failed' } }, NOW)).reqgraph).toMatchObject({ value: 'unknown', tone: 'unknown' });
    // An older service (no graphBuild) and a failed kinds read: unknown; and while the kinds are still read: reading.
    const old = { state: 'ok' as const, coverage: COV, build: null };
    expect(byId(knowledgeMarks(repo('crew'), RUNS, { kinds: { state: 'failed' }, reqs: old }, NOW)).reqgraph).toMatchObject({ value: 'unknown' });
    expect(byId(knowledgeMarks(repo('crew'), RUNS, { kinds: { state: 'loading' }, reqs: old }, NOW)).reqgraph).toMatchObject({ value: '…' });
    // The run list could not be read: its marks are unknown (and lead nowhere), the code graph's age is not on record.
    const noRuns = byId(knowledgeMarks(repo('crew'), null, known(), NOW));
    expect(noRuns['domain-runs']).toMatchObject({ value: 'unknown', tone: 'unknown', target: { kind: 'none' } });
    expect(noRuns.runs).toMatchObject({ value: 'unknown', tone: 'unknown' });
    expect(noRuns.code!.title).toContain('when could not be read');
    const gap = byId(knowledgeMarks(repo('crew', [{ code: 'code_graph_root_unresolvable', message: 'No code graph root resolved.', path: null }]), RUNS, known(), NOW));
    expect(gap.code).toMatchObject({ value: 'no place to keep one', tone: 'fail' });
    const indexing = [makeView({ id: 'onb-now', repo_ref: 'crew', workflow_id: 'onboarding', status: 'executing', created_at: S - 60 })];
    expect(byId(knowledgeMarks(repo('crew'), indexing, known(), NOW)).code).toMatchObject({ value: 'indexing now', tone: 'run', target: { kind: 'run', runId: 'onb-now' } });
    // Never indexed and nothing in the store: not built (an honest none, from an answered read).
    expect(byId(knowledgeMarks(repo('crew'), [], known({ kinds: kindsRead([]) }), NOW)).code).toMatchObject({ value: 'not built', tone: 'none' });
    // An index older than a week reads amber.
    const stale = [makeView({ id: 'onb-old', repo_ref: 'crew', workflow_id: 'onboarding', status: 'completed', created_at: S - 10 * 86_400 })];
    expect(byId(knowledgeMarks(repo('crew'), stale, known(), NOW)).code).toMatchObject({ tone: 'warn' });
  });

  it('a failed re-index never makes the old graph read fresh: it says so and links the failed job', () => {
    const runs = [
      makeView({ id: 'onb-ok', repo_ref: 'crew', workflow_id: 'onboarding', status: 'completed', created_at: S - 10 * 86_400 }),
      makeView({ id: 'onb-bad', repo_ref: 'crew', workflow_id: 'onboarding', status: 'failed', created_at: S - 120 }),
    ];
    const code = byId(knowledgeMarks(repo('crew'), runs, known(), NOW)).code!;
    expect(code).toMatchObject({ value: '46k symbols', tone: 'fail', flag: 're-index failed', target: { kind: 'run', runId: 'onb-bad' } });
    expect(code.title).toContain('indexed 1 week ago');
    // No graph at all and the only index failed: indexing failed.
    expect(byId(knowledgeMarks(repo('crew'), runs.slice(1), known({ kinds: kindsRead([]) }), NOW)).code).toMatchObject({ value: 'indexing failed', tone: 'fail' });
  });

  it('a materialized workflow (workflow_id wf-…) is counted by its resolved name', () => {
    const ident = (name: string) => ({ kind: 'workflow', name, user_plan: false, system: false });
    const runs = [
      makeView({ id: 'wf-dom', repo_ref: 'crew', workflow_id: 'wf-1234', status: 'completed', created_at: S - 60, run_identity: ident('domain-extraction') } as never),
      makeView({ id: 'wf-onb', repo_ref: 'crew', workflow_id: 'wf-5678', status: 'executing', created_at: S - 30, run_identity: ident('onboarding') } as never),
      makeView({ id: 'bug', repo_ref: 'crew', workflow_id: 'bug', status: 'completed', created_at: S - 90 }),
    ];
    const m = byId(knowledgeMarks(repo('crew'), runs, known(), NOW));
    expect(m['domain-runs']).toMatchObject({ value: '1', target: { kind: 'run', runId: 'wf-dom' } });
    expect(m.runs).toMatchObject({ value: '1', target: { kind: 'run', runId: 'bug' } });
    expect(m.code).toMatchObject({ value: 'indexing now', target: { kind: 'run', runId: 'wf-onb' } });
  });
});

describe('the knowledge store', () => {
  beforeEach(() => {
    resetRepoKnowledge();
    mocks.kinds.mockReset();
    mocks.reqs.mockReset();
  });

  it(`reads at most ${MAX_IN_FLIGHT} repositories at a time, keeps each for a minute, and reads a 404 notGenerated as none`, async () => {
    const release: Array<() => void> = [];
    mocks.kinds.mockImplementation(() => new Promise((res) => { release.push(() => res({ kinds: CREW_KINDS })); }));
    mocks.reqs.mockImplementation(async (id: string) => {
      if (id === 'none') throw new ApiError(404, 'Not Found', { code: 'notGenerated', workflow: 'domain-extraction' });
      return { coverage: COV, graphBuild: { generation: 3, coverage: COV, behind: false } };
    });
    const ids = ['a', 'b', 'c', 'd', 'none'];
    useRepoKnowledge.getState().ensure(ids);
    expect(mocks.kinds).toHaveBeenCalledTimes(MAX_IN_FLIGHT);
    expect(useRepoKnowledge.getState().reads['d']).toEqual({ kinds: { state: 'loading' }, reqs: { state: 'loading' } });
    for (let i = 0; i < 5; i += 1) { await act(async () => { release.shift()?.(); await Promise.resolve(); }); }
    await vi.waitFor(() => expect(Object.keys(useRepoKnowledge.getState().at)).toHaveLength(5));
    expect(mocks.kinds).toHaveBeenCalledTimes(5);
    expect(useRepoKnowledge.getState().reads['none']!.reqs).toEqual({ state: 'none', share: null });
    expect(useRepoKnowledge.getState().reads['a']!.kinds).toMatchObject({ state: 'ok', nodes: 46_477 });
    // Fresh: asked again within the minute, nothing is read.
    useRepoKnowledge.getState().ensure(ids);
    expect(mocks.kinds).toHaveBeenCalledTimes(5);
    // Stale: read again, keeping the last answer meanwhile.
    useRepoKnowledge.setState((s) => ({ at: { ...s.at, a: Date.now() - FRESH_MS - 1 } }));
    useRepoKnowledge.getState().ensure(['a']);
    expect(mocks.kinds).toHaveBeenCalledTimes(6);
    expect(useRepoKnowledge.getState().reads['a']!.kinds.state).toBe('ok');
    release.shift()?.();
  });

  it('a failed read lands as failed (the marks say unknown) and is not kept as fresh: the next ask reads it again', async () => {
    mocks.kinds.mockRejectedValue(new Error('engine down'));
    mocks.reqs.mockRejectedValue(new ApiError(500, 'boom'));
    useRepoKnowledge.getState().ensure(['x']);
    await vi.waitFor(() => expect(useRepoKnowledge.getState().reads['x']!.kinds.state).toBe('failed'));
    expect(useRepoKnowledge.getState().reads['x']!.reqs).toEqual({ state: 'failed' });
    expect(useRepoKnowledge.getState().at['x']).toBeUndefined();
    mocks.kinds.mockResolvedValue({ kinds: CREW_KINDS });
    useRepoKnowledge.getState().ensure(['x']);
    await vi.waitFor(() => expect(useRepoKnowledge.getState().reads['x']!.kinds.state).toBe('ok'));
    expect(mocks.kinds).toHaveBeenCalledTimes(2);
  });

  it('the page asking now goes first: a repository still queued for the list jumps ahead (asked once, however often named)', async () => {
    const order: string[] = [];
    const release: Array<() => void> = [];
    mocks.kinds.mockImplementation((id: string) => { order.push(id); return new Promise((res) => { release.push(() => res({ kinds: [] })); }); });
    mocks.reqs.mockResolvedValue({ coverage: COV, graphBuild: null });
    useRepoKnowledge.getState().ensure(['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
    useRepoKnowledge.getState().ensure(['l6', 'l6']);
    expect(order).toEqual(['l1', 'l2', 'l3']);
    await act(async () => { release.shift()?.(); await Promise.resolve(); });
    await vi.waitFor(() => expect(order).toHaveLength(4));
    expect(order[3]).toBe('l6');
    while (release.length > 0) { await act(async () => { release.shift()?.(); await Promise.resolve(); }); }
    await vi.waitFor(() => expect(order).toHaveLength(6));
    expect(order.filter((id) => id === 'l6')).toHaveLength(1);
  });
});

describe('the knowledge store: bounded reads and the minute', () => {
  beforeEach(() => { resetRepoKnowledge(); mocks.kinds.mockReset(); mocks.reqs.mockReset(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('a read that never answers is aborted after the timeout (its connection freed), counts as failed and frees its slot', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    mocks.kinds.mockImplementation((id: string, opts?: { signal?: AbortSignal }) => {
      if (opts?.signal !== undefined) signals.push(opts.signal);
      return id.startsWith('stuck') ? new Promise(() => {}) : Promise.resolve({ kinds: CREW_KINDS });
    });
    // The requirements read of the first one stalls too, and is aborted the same way.
    mocks.reqs.mockImplementation((id: string, _p: unknown, opts?: { signal?: AbortSignal }) => {
      if (opts?.signal !== undefined) signals.push(opts.signal);
      return id === 'stuck1' ? new Promise(() => {}) : Promise.resolve({ coverage: COV, graphBuild: null });
    });
    useRepoKnowledge.getState().ensure(['stuck1', 'stuck2', 'stuck3', 'ok']);
    expect(mocks.kinds).toHaveBeenCalledTimes(MAX_IN_FLIGHT);
    expect(signals).toHaveLength(6);
    expect(new Set(signals).size).toBe(6);
    expect(signals.some((sg) => sg.aborted)).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 10); });
    expect(useRepoKnowledge.getState().reads['stuck1']!.kinds).toEqual({ state: 'failed' });
    // Every read that had not answered is aborted: the three stalled kinds reads and stuck1's requirements read.
    expect(signals.filter((sg) => sg.aborted)).toHaveLength(4);
    expect(useRepoKnowledge.getState().reads['stuck1']!.reqs).toEqual({ state: 'failed' });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(useRepoKnowledge.getState().reads['ok']!.kinds.state).toBe('ok');
  });

  it('a page that stays open reads its repositories again every minute', async () => {
    vi.useFakeTimers();
    mocks.kinds.mockResolvedValue({ kinds: CREW_KINDS });
    mocks.reqs.mockResolvedValue({ coverage: COV, graphBuild: null });
    function Probe(): null { useRepoKnowledgeFor(['a']); return null; }
    render(<Probe />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(mocks.kinds).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(FRESH_MS); });
    expect(mocks.kinds).toHaveBeenCalledTimes(2);
  });
});

describe('Repositories and a repository’s page: what we know', () => {
  beforeEach(() => {
    // The fixtures are dated against NOW: on the real clock the onboarding run aged past the stale-index line on
    // 2026-11-06 and the Code map column read "Index is 7 days old". Only Date is faked, so waits still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    resetRepoKnowledge();
    resetRepoLanguages();
    mocks.listRepos.mockResolvedValue({ repos: [repo('crew'), repo('pi')] });
    mocks.listRuns.mockResolvedValue({ runs: RUNS });
    mocks.kinds.mockImplementation(async (id: string) => ({ kinds: id === 'crew' ? CREW_KINDS : [] }));
    mocks.reqs.mockImplementation(async (id: string) => {
      if (id === 'pi') throw new ApiError(404, 'Not Found', { code: 'notGenerated', workflow: 'domain-extraction' });
      return { coverage: COV, graphBuild: { generation: 3, coverage: COV, behind: false } };
    });
  });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('each row’s Code map column carries the graph’s size from the same read', async () => {
    render(<RepositoriesPanel navigate={vi.fn()} />);
    await screen.findByTestId('repos-list');
    const crew = screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === 'crew')!;
    await vi.waitFor(() => expect(within(crew).getByTestId('repo-row-map')).toHaveTextContent('Indexed · 46k symbols'));
    expect(within(crew).queryByTestId('repo-know')).toBeNull(); // the marks are the page's Overview now
  });

  it('a repository’s Overview says what we know, and each mark opens the thing itself', async () => {
    const onSelectRun = vi.fn();
    const onOpenGraph = vi.fn();
    render(<RepoDetailPage repoId="crew" navigate={vi.fn()} onSelectRun={onSelectRun} onOpenGraph={onOpenGraph} />);
    const band = await screen.findByTestId('repo-know');
    expect(band).toHaveAccessibleName('What we know');
    await vi.waitFor(() => expect(within(band).getAllByTestId('repo-know-value').map((v) => v.textContent)).toEqual(['46k symbols', '80% real', 'build 3 · 38 domains', '2', '2']));
    const mark = (id: string) => within(band).getAllByTestId('repo-know-mark').find((m) => m.getAttribute('data-mark') === id)!;
    fireEvent.click(mark('code'));
    expect(onOpenGraph).toHaveBeenLastCalledWith();
    fireEvent.click(mark('reqgraph'));
    expect(onOpenGraph).toHaveBeenLastCalledWith(undefined, 'domain');
    fireEvent.click(mark('reqs'));
    expect(screen.getByTestId('requirements-stub')).toHaveTextContent('crew');
    fireEvent.click(mark('domain-runs'));
    expect(onSelectRun).toHaveBeenLastCalledWith('d-new');
    cleanup();
    // A repository with nothing extracted: plain words, and a mark with nothing behind it is not a button.
    render(<RepoDetailPage repoId="pi" navigate={vi.fn()} onSelectRun={vi.fn()} onOpenGraph={vi.fn()} />);
    const piBand = await screen.findByTestId('repo-know');
    await vi.waitFor(() => expect(within(piBand).getAllByTestId('repo-know-value')[1]).toHaveTextContent('none yet'));
    const piDomain = within(piBand).getAllByTestId('repo-know-mark').find((m) => m.getAttribute('data-mark') === 'domain-runs')!;
    expect(piDomain.tagName).toBe('SPAN');
    expect(piDomain).toHaveAttribute('data-link', 'false');
  });
});
