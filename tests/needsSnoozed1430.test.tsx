/**
 * studio#1430: a snooze on the ranked Needs-you page makes crew hold the item out of `/system.attention[]` and list it in
 * `/system.snoozed[]` (wicked-crew `holdSnoozed`). The ranked surfaces follow crew; these surfaces read studio's own fold,
 * so they kept counting and listing the held run. The one rule: on a ranked crew, a run in `snoozed[]` is snoozed
 * everywhere, with Wake by the held item's `wakeKey`, and the inbox snoozes with crew's own key where crew has one.
 *  - F1: a project's inbox and its count leave the held run out (it waits in Snoozed); its home says "1 snoozed".
 *  - F3: the peek's top item is never the held run.
 *  - F4: a gate snoozed in a project's inbox uses crew's `attention:` key and rank, so crew holds it back too.
 *  - F5: on a phone (the reading pane hidden) each row carries its own Snooze.
 * The wire shapes are crew's (`attentionSnooze`, packages/crew/src/api/desk-snoozes.ts:54, and `holdSnoozed` at :69), as
 * tests/needsRanked.snooze1416.test.tsx copies them.
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSnapshot, type SystemSnapshot } from '../src/api/system.js';
import type { Project, SessionView } from '../src/api/types.js';
import { needsYouRows, type NeedRow, type NeedsYouInputs } from '../src/board/needsYou.js';
import { snoozeKey } from '../src/board/deskSnooze.js';
import { DeskInbox } from '../src/components/desk/DeskInbox.js';
import { ProjectHome } from '../src/components/desk/ProjectHome.js';
import { usePeekJump } from '../src/hooks/usePeekJump.js';
import { NEEDS_QUIET_MS, resetSettledNeedsForTest, useSettledNeeds } from '../src/hooks/useNeedsRows.js';
import { resetDeskSnoozes } from '../src/store/deskSnoozes.js';
import { gateFromInfo, useGateStore } from '../src/store/gates.js';
import { useMembershipStore } from '../src/store/membership.js';
import { useNeedsSources } from '../src/store/needsSources.js';
import { resetSystemStore, useSystemStore } from '../src/store/systemSnapshot.js';
import { makeView } from './factories.js';

vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...original, api: { ...original.api, getRunEvents: vi.fn().mockResolvedValue({ events: [] }), getHealth: () => new Promise(() => undefined) } };
});
vi.mock('../src/store/systemSnapshot.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/store/systemSnapshot.js')>();
  return { ...original, useSystemPoll: () => undefined };
});

const NOW = Date.UTC(2026, 10, 25, 12);
const H = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const GATE_AT = iso(NOW - 0.5 * H);
const HELD_AT = iso(NOW - 6 * H);
/** An awake gate crew may snooze (its `snooze: {key, rank}`), and a held one (`snoozed[]`, with its `until`). */
const GATE = {
  id: 'run:68c26704', severity: 'yellow', source: 'run', kind: 'prevents', title: 'Where is wicked-core riskiest to change',
  reason: 'Waiting for you to approve its plan', remedy: 'Answer the gate.', blocks: 1, blockedRunIds: ['68c26704'],
  waitedSince: GATE_AT, unitsLeft: 1, target: { kind: 'run', runId: '68c26704', gateOrd: 1, interactionId: 'ir_9' },
  action: { kind: 'open_gate', label: 'Open the gate' }, snooze: { key: `attention:run:68c26704@ir_9@${GATE_AT}`, rank: 101 },
};
const HELD = {
  id: 'run:290a7fee', severity: 'red', source: 'run', kind: 'prevents', title: 'wicked-core#840: a dead seat', reason: 'held at an escalation gate',
  remedy: 'Open the gate.', blocks: 1, blockedRunIds: ['290a7fee'], waitedSince: HELD_AT, unitsLeft: 4,
  target: { kind: 'run', runId: '290a7fee', gateOrd: 4, interactionId: 'ir_4' }, action: { kind: 'open_gate', label: 'Open the gate' },
  snooze: { key: `attention:run:290a7fee@ir_4@${HELD_AT}`, rank: 201 }, until: iso(NOW + 3 * H),
};
const wire = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  checkedAt: iso(NOW), budgetMs: 8000, tookMs: 900, level: 'yellow', attention: [GATE], snoozed: [HELD],
  unresolved: [], unresolvedSpend: { costUsd: null, tokens: null, costKnown: 0 }, toReview: 0, clis: [], runs: [], infra: [], governance: [], ...over,
});
const snap = (over: Record<string, unknown> = {}): SystemSnapshot => ({ ...normalizeSnapshot(wire(over)), ranked: true });

const run = (id: string, status: string): SessionView =>
  ({ session: { id, status, problem: `problem ${id}`, archived_at: null }, units: [] }) as unknown as SessionView;
const gates = {
  '290a7fee': gateFromInfo({ runId: '290a7fee', ord: 4, prompt: 'Escalation: the seat died', lifecycle: 'open', receivedAt: HELD_AT }),
  '68c26704': gateFromInfo({ runId: '68c26704', ord: 1, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: GATE_AT }),
};
const RUNS = [run('290a7fee', 'awaiting_human'), run('68c26704', 'awaiting_human')];
const rowsOf = (over: Partial<NeedsYouInputs> = {}): NeedRow[] => needsYouRows({
  runs: RUNS, gates, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW, ...over,
});
// A failed run's row, as needsYou.ts writes it (studio's own snooze key `fail:<run>@ended:<ms>`).
const failed = (i: number): NeedRow => ({
  key: `fail:run-${i}`, kind: 'failed-run', severity: 70, stakes: 1,
  subject: `Job ${i}`, text: 'Run failed', tone: 'fail', at: NOW - i * H, instance: `ended:${NOW - i * H}`,
  subjectPath: `/run/run-${i}`, action: { kind: 'open', path: `/run/run-${i}`, label: 'Open' },
});

let calls: Array<{ method: string; url: string; body: unknown }>;
let snoozes: Array<{ key: string; until: string; severity: number | null; at: string; by: string }>;
const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const refresh = vi.fn(async () => undefined);

beforeEach(() => {
  resetSystemStore();
  resetDeskSnoozes();
  refresh.mockReset().mockResolvedValue(undefined);
  useSystemStore.setState({ mode: 'system', snapshot: snap(), refresh } as never);
  useGateStore.setState({ gates: {} });
  calls = [];
  snoozes = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body !== undefined ? JSON.parse(String(init.body)) as { until: string; severity?: number } : undefined;
    calls.push({ method, url, body });
    const key = decodeURIComponent(url.split('/desk/snoozes/')[1] ?? '');
    // crew's /desk/snoozes (packages/crew/src/api/desk-snoozes.ts): the PUT stores and answers the snooze, the list reads them.
    if (url.endsWith('/desk/snoozes') && method === 'GET') return json({ snoozes });
    if (method === 'PUT') {
      const s = { key, until: body!.until, severity: body!.severity ?? null, at: iso(NOW), by: 'operator' };
      snoozes = [...snoozes.filter((x) => x.key !== key), s];
      return json(s);
    }
    if (method === 'DELETE') { snoozes = snoozes.filter((x) => x.key !== key); return json({ key, woken: true }); }
    return json({ error: 'Not Found' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetSystemStore(); });

const props = { runs: RUNS, navigate: vi.fn(), now: NOW, settled: 'complete' as const, agentName: (s: string) => s };
const listed = (): string[] => screen.queryAllByTestId('desk-inbox-row').map((b) => b.getAttribute('data-key') ?? '');
const heldKey = (): string => rowsOf().find((r) => r.key.endsWith('290a7fee'))!.key;
const awakeKey = (): string => rowsOf().find((r) => r.key.endsWith('68c26704'))!.key;
/** A window `phone` ? 390 : 1440 px wide: each width query answers as it would there (the inbox reads 767 and 768). */
const phoneWidth = (phone: boolean): void => {
  const width = phone ? 390 : 1440;
  const fits = (q: string): boolean => [...q.matchAll(/\((max|min)-width:\s*(\d+)px\)/gu)].every(([, side, px]) => (side === 'max' ? width <= Number(px) : width >= Number(px)));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /width/u.test(q) && fits(q), media: q, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }));
};

describe('studio#1430 F1: a project inbox treats the run crew holds back as snoozed', () => {
  it('the held run leaves the list and the count, waits in Snoozed with crew\'s end, and Wake sends the held wakeKey', async () => {
    refresh.mockImplementation(async () => { useSystemStore.setState({ snapshot: snap({ attention: [GATE, HELD], snoozed: [] }) }); });
    render(<DeskInbox rows={[...rowsOf(), failed(2)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    await waitFor(() => expect(listed()).not.toContain(heldKey()));
    expect([...listed()].sort()).toEqual([awakeKey(), 'fail:run-2'].sort());
    expect(screen.getByTestId('desk-inbox-count')).toHaveTextContent('2 waiting');
    expect(screen.getByTestId('desk-inbox-count')).toHaveTextContent('· 1 snoozed');
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-snoozed')); });
    const item = screen.getByTestId('desk-inbox-snoozed-item');
    expect(item).toHaveAttribute('data-key', heldKey());
    expect(within(item).getByTestId('desk-inbox-snoozed-until').textContent).toMatch(/^Back today \d+:\d\d$/);
    await act(async () => { fireEvent.click(within(item).getByTestId('desk-inbox-wake')); });
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.url.endsWith(`/desk/snoozes/${encodeURIComponent(HELD.snooze.key)}`)).toBe(true);
    // crew moved the item back: /system is read again (forced: a read already out may predate the wake), so the inbox,
    // /needs and the badge follow.
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ force: true }));
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-all')); });
    await waitFor(() => expect(listed()).toEqual(expect.arrayContaining(['group:approval', 'fail:run-2'])));
    expect(screen.getByTestId('desk-inbox-count')).not.toHaveTextContent('snoozed');
  });

  it('a woken run stays awake when the re-read fails: the last snapshot no longer holds it (codex r1)', async () => {
    refresh.mockRejectedValue(new Error('crew did not answer'));
    render(<DeskInbox rows={[...rowsOf(), failed(2)]} {...props} />);
    await waitFor(() => expect(listed()).not.toContain(heldKey()));
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-snoozed')); });
    await act(async () => { fireEvent.click(within(screen.getByTestId('desk-inbox-snoozed-item')).getByTestId('desk-inbox-wake')); });
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ force: true }));
    expect(useSystemStore.getState().snapshot?.snoozed ?? []).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-all')); });
    await waitFor(() => expect(listed()).toContain('group:approval'));
  });

  it('a hold whose end has passed holds nothing, even in the last snapshot read (a failed re-read keeps it)', async () => {
    useSystemStore.setState({ snapshot: snap({ snoozed: [{ ...HELD, until: iso(NOW - 1) }] }) });
    render(<DeskInbox rows={[...rowsOf(), failed(2)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    await waitFor(() => expect([...listed()].sort()).toEqual(['fail:run-2', 'group:approval']));
    expect(screen.getByTestId('desk-inbox-count')).not.toHaveTextContent('snoozed');
  });

  it('an older crew (no ranked snapshot) holds nothing back', async () => {
    useSystemStore.setState({ mode: 'fallback', snapshot: null } as never);
    render(<DeskInbox rows={[...rowsOf(), failed(2)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    // Both gates wait (the queue groups the two approvals) and nothing is snoozed.
    await waitFor(() => expect([...listed()].sort()).toEqual(['fail:run-2', 'group:approval']));
    expect(screen.getByTestId('desk-inbox-count')).not.toHaveTextContent('snoozed');
  });

  it('the project\'s count leaves the held run out', () => {
    vi.useFakeTimers({ now: NOW });
    try {
      resetSettledNeedsForTest();
      const t = Date.now();
      useNeedsSources.setState({ chats: [], proposals: [], repos: [], campaigns: [], readAt: { chats: t, proposals: t, repos: t, campaigns: t }, readOk: {} } as never);
      useSystemStore.setState({ healthAt: t, snapshotAt: t } as never);
      const rows = rowsOf();
      const { result } = renderHook(() => useSettledNeeds(rows, true, false, 'proj-1430', 2));
      act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
      expect(result.current).toMatchObject({ phase: 'complete', count: 1 });
    } finally { vi.useRealTimers(); }
  });

  it('the project home says what crew holds back, with the way to it', () => {
    const PROJECT = { id: 'p1', name: 'Core', description: null, status: 'active', scope: 'project:p1', created_at: 0, updated_at: 0 } as unknown as Project;
    const views = [makeView({ id: '290a7fee', status: 'awaiting_human', problem: 'wicked-core#840' } as never, [])];
    const navigate = vi.fn();
    render(<ProjectHome project={PROJECT} projectId="p1" runs={views} allRuns={views} needRows={[]} repos={[]} now={NOW} known loading={false} navigate={navigate} isDefault={false} />);
    expect(screen.getByTestId('project-needs-snoozed')).toHaveTextContent('1 snoozed, not counted until it comes back');
    fireEvent.click(screen.getByTestId('project-needs-snoozed-open'));
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/work/u));
  });
});

describe('studio#1430 F3: the peek never jumps to the run crew holds back', () => {
  function Peek({ rows }: { rows: NeedRow[] }): React.ReactElement {
    const view = usePeekJump(RUNS, vi.fn(), rows);
    return <span data-testid="peek-run" data-run={view.target?.runId ?? 'none'} />;
  }
  beforeEach(() => {
    // The peek reads the clock (a hold ends at its `until`): this file's NOW.
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    useGateStore.setState({ gates });
    useMembershipStore.setState({ projectIdByRun: {}, attachedAtByRun: {} });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('the awake gate is the top item, though the held one is older', () => {
    render(<Peek rows={rowsOf()} />);
    expect(screen.getByTestId('peek-run')).toHaveAttribute('data-run', '68c26704');
  });

  it('with only the held gate left, nothing needs you (its live gate is not picked up either)', () => {
    useGateStore.setState({ gates: { '290a7fee': gates['290a7fee'] } });
    render(<Peek rows={rowsOf().filter((r) => r.key === heldKey())} />);
    expect(screen.getByTestId('peek-run')).toHaveAttribute('data-run', 'none');
  });
});

describe('studio#1430 F4: a gate snoozed in the inbox uses crew\'s key, so crew holds it back too', () => {
  it('sends crew\'s attention key and rank, then reads /system again', async () => {
    refresh.mockImplementation(async () => { useSystemStore.setState({ snapshot: snap({ attention: [], snoozed: [HELD, { ...GATE, until: iso(NOW + H) }] }) }); });
    render(<DeskInbox rows={rowsOf().filter((r) => r.key === awakeKey())} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    await act(async () => { fireEvent.click(screen.getAllByTestId('desk-inbox-row').find((b) => b.getAttribute('data-key') === awakeKey())!); });
    const pane = screen.getByTestId('desk-inbox-read');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-hour')); });
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url.endsWith(`/desk/snoozes/${encodeURIComponent(GATE.snooze.key)}`)).toBe(true);
    expect(put.body).toEqual({ until: iso(NOW + H), severity: 101 });
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ force: true }));
    await waitFor(() => expect(listed()).toEqual([]));
    expect(screen.getByTestId('desk-inbox-count')).toHaveTextContent('1 snoozed');
  });
});

describe('studio#1430 F5: on a phone each row carries its own Snooze', () => {
  it('at 390 the row offers Snooze, and it sends the item\'s snooze', async () => {
    phoneWidth(true);
    render(<DeskInbox rows={[failed(1)]} {...props} runs={[]} />);
    await waitFor(() => expect(screen.getByTestId('desk-inbox-row-snooze')).toBeInTheDocument());
    const own = screen.getByTestId('desk-inbox-row-snooze');
    await act(async () => { fireEvent.click(within(own).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(own).getByTestId('desk-inbox-snooze-hour')); });
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.url.endsWith(`/desk/snoozes/${encodeURIComponent(snoozeKey(failed(1)))}`)).toBe(true);
    // The row left with the control that had focus: focus goes to the All tab (codex r1).
    await waitFor(() => expect(listed()).toEqual([]));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('desk-inbox-folder-all')));
  });

  it('a refusal that lands after the person moved on leaves their focus where it is (codex r1)', async () => {
    phoneWidth(true);
    let refuse: (r: Response) => void = () => undefined;
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => (init?.method === 'PUT' ? new Promise<Response>((r) => { refuse = r; }) : base(url as string, init)));
    render(<DeskInbox rows={[failed(1), failed(2)]} {...props} runs={[]} />);
    await waitFor(() => expect(screen.getAllByTestId('desk-inbox-row-snooze')).toHaveLength(2));
    const own = screen.getAllByTestId('desk-inbox-row-snooze')[0]!;
    await act(async () => { fireEvent.click(within(own).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(own).getByTestId('desk-inbox-snooze-hour')); });
    const elsewhere = screen.getByTestId('desk-inbox-folder-all');
    act(() => { elsewhere.focus(); });
    await act(async () => { refuse(json({ code: 'human_operator_only', error: 'Only a person may snooze.' }, 403)); });
    await waitFor(() => expect(within(own).getByTestId('desk-inbox-snooze-failed')).toBeInTheDocument());
    expect(document.activeElement).toBe(elsewhere);
  });

  it('on a phone an opened row has one Snooze: the hidden reading pane draws none (pi r1)', async () => {
    phoneWidth(true);
    render(<DeskInbox rows={[failed(1)]} {...props} runs={[]} />);
    await waitFor(() => expect(screen.getByTestId('desk-inbox-row-snooze')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getAllByTestId('desk-inbox-row')[0]!); });
    expect(screen.getAllByTestId('desk-inbox-snooze')).toHaveLength(1);
  });

  it('at 1440 the reading pane carries it, so the row does not', async () => {
    phoneWidth(false);
    render(<DeskInbox rows={[failed(1)]} {...props} runs={[]} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    await waitFor(() => expect(listed()).toEqual(['fail:run-1']));
    await act(async () => { fireEvent.click(screen.getAllByTestId('desk-inbox-row')[0]!); });
    expect(within(screen.getByTestId('desk-inbox-read')).getByTestId('desk-inbox-snooze')).toBeInTheDocument();
    expect(screen.queryByTestId('desk-inbox-row-snooze')).toBeNull();
  });
});
