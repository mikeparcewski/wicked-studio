/**
 * studio#1430 (narrowed, option C of DES-S-NEEDS-HOLDS): a snooze on the ranked Needs-you page makes crew hold the item
 * out of `/system.attention[]` and list it in `/system.snoozed[]` (wicked-crew `holdSnoozed`). Studio says so where its
 * ranked surfaces would otherwise go quiet, and the inbox snoozes on a phone; it does not apply crew's holds to its own
 * fold (that is the follow-up filed from this PR).
 *  - F2 (tests/nerveCenterPage.test.tsx): the Nerve Center's Attention tab says how many are snoozed, with the way back.
 *  - The project home says "N snoozed" for its runs in crew's `snoozed[]`, with the way to Needs you.
 *  - F5: on a phone (the reading pane hidden) each row carries its own Snooze.
 * The wire shapes are crew's (`holdSnoozed`, packages/crew/src/api/desk-snoozes.ts:69), as
 * tests/needsRanked.snooze1416.test.tsx copies them.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSnapshot, type SystemSnapshot } from '../src/api/system.js';
import type { Project, SessionView } from '../src/api/types.js';
import { needsYouRows, type NeedRow, type NeedsYouInputs } from '../src/board/needsYou.js';
import { snoozeKey } from '../src/board/deskSnooze.js';
import { DeskInbox } from '../src/components/desk/DeskInbox.js';
import { ProjectHome } from '../src/components/desk/ProjectHome.js';
import { resetDeskSnoozes } from '../src/store/deskSnoozes.js';
import { gateFromInfo, useGateStore } from '../src/store/gates.js';
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
/** A window `phone` ? 390 : 1440 px wide: each width query answers as it would there (the inbox reads 767 and 768). */
const phoneWidth = (phone: boolean): void => {
  const width = phone ? 390 : 1440;
  const fits = (q: string): boolean => [...q.matchAll(/\((max|min)-width:\s*(\d+)px\)/gu)].every(([, side, px]) => (side === 'max' ? width <= Number(px) : width >= Number(px)));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /width/u.test(q) && fits(q), media: q, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }));
};

describe('studio#1430: the project home says what crew holds back', () => {
  it('the project home says what crew holds back, with the way to it', () => {
    const PROJECT = { id: 'p1', name: 'Core', description: null, status: 'active', scope: 'project:p1', created_at: 0, updated_at: 0 } as unknown as Project;
    const views = [makeView({ id: '290a7fee', status: 'awaiting_human', problem: 'wicked-core#840' } as never, [])];
    const navigate = vi.fn();
    render(<ProjectHome project={PROJECT} projectId="p1" runs={views} allRuns={views} needRows={[]} repos={[]} now={NOW} known loading={false} navigate={navigate} isDefault={false} />);
    expect(screen.getByTestId('project-needs-snoozed')).toHaveTextContent('1 snoozed, not counted until it comes back');
    fireEvent.click(screen.getByTestId('project-needs-snoozed-open'));
    expect(navigate).toHaveBeenCalledWith('/needs');
  });
});

describe('studio#1430: a gate in the inbox offers no Snooze (it could not leave this inbox)', () => {
  it('on a ranked crew that lists a snooze key for the gate, the reading pane still draws none', async () => {
    phoneWidth(false);
    render(<DeskInbox rows={rowsOf().filter((r) => r.key.endsWith('68c26704'))} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    await act(async () => { fireEvent.click(screen.getAllByTestId('desk-inbox-row')[0]!); });
    expect(within(screen.getByTestId('desk-inbox-read')).queryByTestId('desk-inbox-snooze')).toBeNull();
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

  // studio#1501: the focus move ran on a timer and asked "is focus on <body>?". When that timer runs before React
  // commits the row's removal, focus is still on the leaving row's Snooze choice, so nothing moves it, and the removal
  // then drops it to <body> for good. One act scope holds the commit back until the timer has run, so this order is
  // certain here. That the flaky CI runs hit this order is inferred (same assertion, same <body>), not traced.
  it('the row leaves with focus even when the focus timer runs before the row is gone (studio#1501)', async () => {
    phoneWidth(true);
    render(<DeskInbox rows={[failed(1)]} {...props} runs={[]} />);
    await waitFor(() => expect(screen.getByTestId('desk-inbox-row-snooze')).toBeInTheDocument());
    const own = screen.getByTestId('desk-inbox-row-snooze');
    await act(async () => { fireEvent.click(within(own).getByTestId('desk-inbox-snooze')); });
    const hour = within(own).getByTestId('desk-inbox-snooze-hour');
    expect(document.activeElement).toBe(hour);
    await act(async () => {
      fireEvent.click(hour);
      // The snooze is sent and settles, and the 0 ms focus timer runs, all before this scope lets React commit.
      for (let i = 0; i < 50 && !calls.some((c) => c.method === 'PUT'); i += 1) await new Promise((r) => { setTimeout(r, 1); });
      await new Promise((r) => { setTimeout(r, 20); });
      expect(document.body.contains(hour)).toBe(true);
    });
    expect(listed()).toEqual([]);
    expect(document.activeElement).toBe(screen.getByTestId('desk-inbox-folder-all'));
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
