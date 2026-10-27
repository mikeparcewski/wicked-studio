import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { normalizeSnapshot, type SystemSnapshot } from '../src/api/system.js';
import { nerveState, toResolveWords } from '../src/board/nerveCenter.js';
import { agoRange, costWords, rankedSections, rankedSentence, resolveGroups } from '../src/board/rankedNeeds.js';
import { namedInStuck, NeedsRanked } from '../src/components/desk/NeedsRanked.js';
import { useNeedsNumber } from '../src/hooks/useRankedNeeds.js';
import { useSystemStore, resetSystemStore } from '../src/store/systemSnapshot.js';

/**
 * ONE NEEDS-YOU NUMBER (crew api-types 0.140.0, `capabilities.attentionRanked`): a ranked crew's
 * `GET /system.attention[]` is the list and its order, and every surface reads its length. The wire
 * below is what crew answers for the rig's 2026-10-27 data (crew's own test pins the same five items,
 * in this order): host load slows four jobs, wicked-core's red base blocks three, then three runs'
 * own causes. Sixteen runs are unresolved.
 */

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...original, api: { ...original.api, resolveRun: mocks.resolve, getHealth: () => new Promise(() => undefined) } };
});
vi.mock('../src/store/systemSnapshot.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/store/systemSnapshot.js')>();
  return { ...original, useSystemPoll: () => undefined };
});

const NOW = Date.parse('2026-10-27T04:11:50.422Z');
const H = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const run = (runId: string, gateOrd: number): Record<string, unknown> => ({ kind: 'run', runId, gateOrd });

const WIRE = {
  checkedAt: iso(NOW), budgetMs: 8000, tookMs: 900, level: 'red',
  attention: [
    { id: 'infra:load', severity: 'yellow', source: 'infra', kind: 'slows', title: 'Host load: degraded', reason: 'load 51.33 on 14 cores: work will run slowly; it slows the next step of 4 run(s) and every new run', remedy: 'Avoid starting more parallel runs until the load falls.', blocks: 4, blockedRunIds: ['1940f173', '2ebd9da2', '64f05d3d', '290a7fee'], waitedSince: null, unitsLeft: 14, target: { kind: 'infra', key: 'load' }, action: { kind: 'recheck', label: 'Re-check' } },
    { id: 'base:wicked-core:test', severity: 'red', source: 'run', kind: 'prevents', title: "wicked-core's base is red inside the floor sandbox", reason: '2 run(s) fail `test` on a base that fails it too; the fix 29bcace4 waits at its deliver gate', remedy: 'Approve delivery of 29bcace4, merge it, then retry the held floors.', blocks: 3, blockedRunIds: ['1940f173', '2ebd9da2', '29bcace4'], waitedSince: iso(NOW - 105.1 * H), unitsLeft: 9, target: run('29bcace4', 10), action: { kind: 'open_gate', label: 'Open the fix’s gate' } },
    { id: 'base:wicked-crew:test_targeted', severity: 'red', source: 'run', kind: 'prevents', title: "wicked-crew's base is red inside the floor sandbox", reason: '1 run(s) fail `test_targeted` on a base that fails it too', remedy: 'Make the base green, then retry the held floors.', blocks: 1, blockedRunIds: ['64f05d3d'], waitedSince: iso(NOW - 31.3 * H), unitsLeft: 2, target: run('64f05d3d', 9), action: { kind: 'open_gate', label: 'Open the gate' } },
    { id: 'run:290a7fee', severity: 'red', source: 'run', kind: 'prevents', title: 'wicked-core#840: a loopback dir removed after…: dead seat', reason: 'held at an escalation gate (unit 4); no failover: pi signed out, copilot benched until 04:28 UTC, opencode signed out', remedy: 'Open the gate and approve the retry; sign in pi and opencode to restore failover.', blocks: 1, blockedRunIds: ['290a7fee'], waitedSince: iso(NOW - 6.4 * H), unitsLeft: 4, target: run('290a7fee', 4), action: { kind: 'open_gate', label: 'Open the gate' } },
    { id: 'run:68c26704', severity: 'red', source: 'run', kind: 'prevents', title: 'Where is wicked-core riskiest to change', reason: 'held at an escalation gate (unit 1)', remedy: 'Open the gate and decide.', blocks: 1, blockedRunIds: ['68c26704'], waitedSince: iso(NOW - 0.1 * H), unitsLeft: 1, target: run('68c26704', 1), action: { kind: 'open_gate', label: 'Open the gate' } },
  ],
  unresolved: [
    { id: 'unresolved:7f4e149f', runId: '7f4e149f', repo: 'wicked-e2e-j6-plugins', workflow: 'editor-plugin', title: 'Build an editor plugin titled "Changelog entry"', status: 'awaiting_human', why: 'superseded', reason: 'still open at its deliver gate; superseded by 6f11390c, which delivered', supersededBy: '6f11390c', since: iso(NOW - 15.9 * H), cost: { costUsd: 1.25, tokens: { input: 1000, output: 500 }, wallMs: 17 * H }, actions: ['close_superseded', 'archive'] },
    { id: 'unresolved:1ff74953', runId: '1ff74953', repo: 'tiny-math', workflow: 'ask/adhoc', title: 'Read src/math.js in this repo with your tools', status: 'failed', why: 'failed', reason: 'failed 10 day(s) ago and was never retried or archived', since: iso(NOW - 244 * H), cost: { costUsd: 0.25, tokens: null, wallMs: 60_000 }, actions: ['retry', 'archive'] },
  ],
  unresolvedSpend: { costUsd: 1.5, tokens: { input: 1000, output: 500 }, costKnown: 2 },
  toReview: 30,
  clis: [], runs: [], infra: [], governance: [],
};

const ranked = (): SystemSnapshot => ({ ...normalizeSnapshot(WIRE), ranked: true });
type Signals = Parameters<typeof nerveState>[0];
const signals = (snapshot: SystemSnapshot): Signals => ({ mode: 'system', health: { status: 'ok' }, healthAt: NOW, healthError: null, snapshot, snapshotAt: NOW, snapshotError: null, governance: { kind: 'unread' }, governanceAt: null });

beforeEach(() => { mocks.resolve.mockReset(); resetSystemStore(); });
afterEach(cleanup);

describe('the ranked wire', () => {
  it('normalizes the root causes, the unresolved work and the review count; an older crew is not ranked', () => {
    const s = ranked();
    expect(s.attention.map((a) => a.id)).toEqual(['infra:load', 'base:wicked-core:test', 'base:wicked-crew:test_targeted', 'run:290a7fee', 'run:68c26704']);
    expect(s.attention[1]).toMatchObject({ kind: 'prevents', blockedRunIds: ['1940f173', '2ebd9da2', '29bcace4'], runId: '29bcace4', waitedSince: NOW - 105.1 * H });
    expect(s.unresolved?.[0]).toMatchObject({ runId: '7f4e149f', why: 'superseded', supersededBy: '6f11390c', costUsd: 1.25, tokens: 1500 });
    expect(s).toMatchObject({ toReview: 30, unresolvedSpendUsd: 1.5, level: 'red' });
    const older: Record<string, unknown> = { ...WIRE };
    delete older['unresolved'];
    delete older['unresolvedSpend'];
    delete older['toReview'];
    expect(normalizeSnapshot(older).ranked).toBe(false);
  });

  it('the page sentence and its sections keep crew’s order', () => {
    const s = ranked();
    expect(rankedSentence(s.attention)).toBe('Five things are holding up work. The first one is slowing four jobs.');
    const { several, single } = rankedSections(s.attention);
    expect(several.map((a) => a.id)).toEqual(['infra:load', 'base:wicked-core:test']);
    expect(single.map((a) => a.id)).toEqual(['base:wicked-crew:test_targeted', 'run:290a7fee', 'run:68c26704']);
    expect(rankedSentence([])).toBe('Nothing is holding up work.');
  });
});

describe('Nerve Center tile against a ranked crew', () => {
  it('says how many and the first, in crew’s order (never re-sorted red first); red when any item is red', () => {
    const st = nerveState(signals(ranked()), 'connected', 99, NOW);
    expect(st).toMatchObject({ tone: 'red', words: '5 need you · Host load: degraded' });
    expect(st.attention.map((a) => a.id).slice(0, 2)).toEqual(['infra:load', 'base:wicked-core:test']);
  });

  it('unresolved work alone is yellow with its spend, never green; nothing at all is green', () => {
    const onlyResolve = { ...ranked(), attention: [] };
    expect(nerveState(signals(onlyResolve), 'connected', 0, NOW)).toMatchObject({ tone: 'yellow', words: '2 jobs to resolve · $1.50 spent' });
    expect(nerveState(signals({ ...onlyResolve, unresolved: [] }), 'connected', 0, NOW)).toMatchObject({ tone: 'green' });
    expect(toResolveWords(1, null)).toBe('1 job to resolve');
  });
});

function Count({ rows }: { rows: [] }): React.ReactElement {
  return <span data-testid="n">{useNeedsNumber(rows)}</span>;
}

describe('the number every surface reads', () => {
  it('is the ranked list’s length; an older crew keeps the fold’s badge', () => {
    useSystemStore.setState({ mode: 'system', snapshot: ranked(), snapshotAt: NOW, snapshotError: null });
    const { unmount } = render(<Count rows={[]} />);
    expect(screen.getByTestId('n').textContent).toBe('5');
    unmount();
    useSystemStore.setState({ mode: 'system', snapshot: { ...ranked(), ranked: false }, snapshotAt: NOW, snapshotError: null });
    render(<Count rows={[]} />);
    expect(screen.getByTestId('n').textContent).toBe('0');
  });
});

describe('/needs against a ranked crew (the approved mockup)', () => {
  const renderPage = (navigate = vi.fn()) => render(<NeedsRanked snapshot={ranked()} runs={[]} needRows={[]} navigate={navigate} now={NOW} />);

  it('several jobs first as cards, then one decision each as rows, then To resolve with its spend; reviews folded', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Needs you');
    expect(screen.getByTestId('needs-sentence').textContent).toMatch(/^Five things are holding up work/);
    expect(within(screen.getByTestId('needs-several')).getAllByTestId('needs-item').map((e) => e.getAttribute('data-id'))).toEqual(['infra:load', 'base:wicked-core:test']);
    const rows = within(screen.getByTestId('needs-single')).getAllByTestId('needs-item');
    expect(rows.map((e) => e.getAttribute('data-id'))).toEqual(['base:wicked-crew:test_targeted', 'run:290a7fee', 'run:68c26704']);
    expect(rows[0]!.textContent).toMatch(/waiting 31 h/);
    expect(screen.getByTestId('needs-resolve-words').textContent).toBe('2 jobs to resolve · $1.50 spent');
    expect(screen.getAllByTestId('needs-resolve-row').map((e) => e.getAttribute('data-run'))).toEqual(['7f4e149f', '1ff74953']);
    expect(screen.getByTestId('needs-worth').textContent).toMatch(/30 things worth a look \(not blocking\)/);
    expect(screen.getByTestId('needs-to-review').textContent).toBe('30 to review');
  });

  it('a row opens its gate', () => {
    const navigate = vi.fn();
    renderPage(navigate);
    fireEvent.click(within(screen.getByTestId('needs-single')).getAllByTestId('needs-item-act')[0]!);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('64f05d3d'));
  });

  it('archive needs a reason: no reason, no send; with one, it resolves with the reason', async () => {
    mocks.resolve.mockResolvedValue({ runId: '1ff74953', action: 'archive', archived: true, cancelled: false, note: 'resolved: x' });
    renderPage();
    const row = screen.getAllByTestId('needs-resolve-row')[1]!;
    fireEvent.click(within(row).getByTestId('needs-resolve-archive'));
    const confirm = within(row).getByTestId('needs-resolve-archive-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.submit(confirm.closest('form')!);
    expect(mocks.resolve).not.toHaveBeenCalled();
    fireEvent.change(within(row).getByTestId('needs-resolve-reason'), { target: { value: 'a routing probe' } });
    fireEvent.click(confirm);
    expect(mocks.resolve).toHaveBeenCalledWith('1ff74953', { action: 'archive', reason: 'a routing probe' });
  });

  it('close as superseded names the run that replaced it', () => {
    mocks.resolve.mockResolvedValue({});
    renderPage();
    fireEvent.click(within(screen.getAllByTestId('needs-resolve-row')[0]!).getByTestId('needs-resolve-superseded'));
    expect(mocks.resolve).toHaveBeenCalledWith('7f4e149f', { action: 'superseded', by: '6f11390c' });
  });
});

describe('To resolve stays calm (coordinator review of r5)', () => {
  const u = (runId: string, over: Record<string, unknown> = {}) => ({ id: `unresolved:${runId}`, runId, title: `Read src/math.js ${runId}`, repo: 'tiny-math', workflow: 'ask/adhoc', status: 'failed', why: 'failed', reason: 'failed 10 days ago and was never retried or archived', since: iso(NOW - 10 * 24 * H), cost: { costUsd: null, tokens: null, wallMs: null }, actions: ['retry', 'archive'], ...over });
  const probes = Array.from({ length: 12 }, (_, i) => u(`p${i}`, i === 0 ? { since: iso(NOW - 9 * 24 * H) } : {}));
  const replaced = ['a', 'b', 'c'].map((id) => u(`s-${id}`, { repo: 'wicked-e2e-j6-plugins', workflow: 'editor-plugin', why: 'superseded', supersededBy: `new-${id}`, actions: ['close_superseded', 'archive'], reason: 'superseded' }));
  const others = ['x1', 'x2', 'x3', 'x4'].map((id) => u(id, { repo: `repo-${id}` }));
  const snapshot = (): SystemSnapshot => ({ ...normalizeSnapshot({ ...WIRE, unresolved: [...probes, ...replaced, ...others] }), ranked: true });

  it('look-alike runs fold into one line in words, with no "cost not recorded" anywhere', () => {
    const groups = resolveGroups(snapshot().unresolved ?? [], NOW);
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ['12 jobs in tiny-math failed 9–10 days ago', 12],
      ['3 jobs in wicked-e2e-j6-plugins were replaced by later runs', 3],
      ['Read src/math.js x1', 1], ['Read src/math.js x2', 1], ['Read src/math.js x3', 1], ['Read src/math.js x4', 1],
    ]);
    expect(costWords({ costUsd: null, tokens: null, wallMs: null })).toBe('');
    expect(agoRange([NOW - 2 * 24 * H, NOW - 2 * 24 * H], NOW)).toBe('2 days ago');
    render(<NeedsRanked snapshot={snapshot()} runs={[]} needRows={[]} navigate={vi.fn()} now={NOW} />);
    expect(screen.getByTestId('needs-resolve').textContent).not.toMatch(/not recorded|\(s\)/);
  });

  it('at most five lines, then "Show N more"; a group expands to its runs', () => {
    render(<NeedsRanked snapshot={snapshot()} runs={[]} needRows={[]} navigate={vi.fn()} now={NOW} />);
    const section = screen.getByTestId('needs-resolve');
    expect(within(section).getAllByTestId('needs-resolve-group')).toHaveLength(2);
    expect(within(section).getAllByTestId('needs-resolve-row')).toHaveLength(3);
    fireEvent.click(within(section).getByTestId('needs-resolve-more'));
    expect(within(section).getAllByTestId('needs-resolve-row')).toHaveLength(4);
    fireEvent.click(within(section).getAllByTestId('needs-resolve-group-toggle')[0]!);
    expect(within(section).getAllByTestId('needs-resolve-row')).toHaveLength(16);
  });

  it('one bulk move per group: archive all with a reason (required), close all as superseded each by its own successor', async () => {
    mocks.resolve.mockResolvedValue({});
    render(<NeedsRanked snapshot={snapshot()} runs={[]} needRows={[]} navigate={vi.fn()} now={NOW} />);
    const [failedGroup, replacedGroup] = screen.getAllByTestId('needs-resolve-group');
    fireEvent.click(within(replacedGroup!).getByTestId('needs-resolve-group-superseded'));
    await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(3));
    expect(mocks.resolve.mock.calls.map((c) => c[1])).toEqual([{ action: 'superseded', by: 'new-a' }, { action: 'superseded', by: 'new-b' }, { action: 'superseded', by: 'new-c' }]);
    mocks.resolve.mockClear();
    fireEvent.click(within(failedGroup!).getByTestId('needs-resolve-group-archive'));
    const confirm = within(failedGroup!).getByTestId('needs-resolve-archive-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(failedGroup!).getByTestId('needs-resolve-reason'), { target: { value: 'routing probes, fixed since' } });
    fireEvent.click(confirm);
    await vi.waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(12));
    expect(mocks.resolve.mock.calls[0]![1]).toEqual({ action: 'archive', reason: 'routing probes, fixed since' });
  });

  it('Set up is calm rows; a helper a stuck item already names is not repeated there', () => {
    const s = ranked();
    expect(namedInStuck('pi', s.attention)).toBe(true);
    expect(namedInStuck('claude', s.attention)).toBe(false);
    const act = vi.fn();
    render(<NeedsRanked snapshot={s} runs={[]} needRows={[]} navigate={vi.fn()} now={NOW} setup={[{ key: 'memory-empty', title: 'Your memory is empty', line: 'Index a repository', label: 'Build memory', onAct: act }]} />);
    const rows = within(screen.getByTestId('needs-setup')).getAllByTestId('needs-setup-row');
    expect(rows.map((r) => r.getAttribute('data-key'))).toEqual(['memory-empty']);
    fireEvent.click(within(rows[0]!).getByTestId('needs-setup-act'));
    expect(act).toHaveBeenCalled();
  });
});

