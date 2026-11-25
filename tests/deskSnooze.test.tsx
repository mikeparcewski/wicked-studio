import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { needsYouRows, type NeedRow, type NeedsYouInputs } from '../src/board/needsYou.js';
import { DeskInbox } from '../src/components/desk/DeskInbox.js';
import { snoozable, snoozeChoices, snoozeKey, snoozeOf, snoozeRank, splitSnoozed, SNOOZE_MAX_MS } from '../src/board/deskSnooze.js';
import { resetDeskSnoozes, useDeskSnoozes } from '../src/store/deskSnoozes.js';
import { gateFromInfo, useGateStore } from '../src/store/gates.js';

/**
 * The studio half of crew#1124: snooze a Needs-you item in the Desk's inbox. The wire is crew#1873's (api-types
 * 0.225.0): `GET /desk/snoozes` → `{snoozes: DeskSnooze[]}`, `PUT /desk/snoozes/:key` `{until, severity}` → the
 * DeskSnooze, `DELETE /desk/snoozes/:key` → `{key, woken}`. The bodies below are the route's own shapes
 * (packages/crew/src/api/desk-snoozes.ts at crew#1873: the PUT answers `{key, until: <ISO>, severity, at, by}`; an
 * agent gets 403 `{code: 'human_operator_only'}`; a daemon before the route answers Fastify's plain 404).
 */

vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));

const NOW = Date.UTC(2026, 10, 25, 12);
const HOUR = 3_600_000;

// A failed run's row, as needsYou.ts writes it (key `fail:<run>`, the daemon's terminal clock as its occurrence).
const row = (i: number, over: Partial<NeedRow> = {}): NeedRow => ({
  key: `fail:run-${i}`, kind: 'failed-run', severity: 70, stakes: 1,
  subject: `Job ${i}`, text: 'Run failed', tone: 'fail', at: NOW - i * HOUR, instance: `ended:${NOW - i * HOUR}`,
  subjectPath: `/run/run-${i}`, action: { kind: 'open', path: `/run/run-${i}`, label: 'Open' }, ...over,
});

const snooze = (r: NeedRow, untilMs: number, severity: number | null = r.severity) =>
  ({ key: snoozeKey(r), until: new Date(untilMs).toISOString(), severity, at: new Date(NOW - HOUR).toISOString(), by: 'operator' });

const run = (id: string, status: string, extra: Record<string, unknown> = {}): SessionView =>
  ({ session: { id, status, problem: `problem ${id}`, archived_at: null, ...extra }, units: [] }) as unknown as SessionView;
const rowsOf = (over: Partial<NeedsYouInputs>): NeedRow[] => needsYouRows({
  runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW, ...over,
});

describe('which item a snooze names (codex r1: an identity that survives a reload)', () => {
  it('a gate is not offered yet: a run can ask again at the same ord, and no gate frame or read names the occurrence (codex delta P1)', () => {
    useGateStore.setState({ gates: {} });
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'run-1', ord: 7, prompt: 'Approve the plan?' } as never);
    const live = useGateStore.getState().gates['run-1']!;
    const reread = gateFromInfo({ runId: 'run-1', ord: 7, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: '2026-11-20T08:00:00.000Z' });
    for (const gate of [live, reread]) {
      const [g] = rowsOf({ runs: [run('run-1', 'awaiting_human')], gates: { 'run-1': gate } });
      expect(g!.kind).toBe('gate');
      expect(g!.instance).toBeUndefined();
      expect(snoozable(g!)).toBe(false);
    }
  });

  it('a steer ask is not offered: its id is minted by this browser and gone after a reload (codex delta P2)', () => {
    const [st] = rowsOf({ runs: [run('run-5', 'running')], steerRequests: [{ id: 'local-uuid-1', runId: 'run-5', message: 'Which database?', ts: NOW - HOUR }] }).filter((r) => r.kind === 'steer-request');
    expect(st).toBeDefined();
    expect(st!.instance).toBeUndefined();
    expect(snoozable(st!)).toBe(false);
  });

  it('a failed onboarding is named by its run and end, so the next onboarding of the repo is a new occurrence (codex delta P2)', () => {
    const repo = { id: 'repo-1', name: 'billing', root_path: '/repos/repo-1', default_branch: 'main', registered_at: 1_699_000_000 };
    const failed = (id: string, endedAt: number): SessionView => run(id, 'failed', { workflow_id: 'onboarding', repo_ref: 'repo-1', ended_at: endedAt });
    const [first] = rowsOf({ runs: [failed('r-onboard-1', 1_700_000_000)], repos: [repo] });
    expect(first!.kind).toBe('repo-graph');
    expect(snoozable(first!)).toBe(true);
    expect(snoozeKey(first!)).toBe('repo:repo-1@run:r-onboard-1@ended:1700000000000');
    const [again] = rowsOf({ runs: [failed('r-onboard-2', 1_700_100_000)], repos: [repo] });
    expect(snoozeKey(again!)).not.toBe(snoozeKey(first!));
  });

  it('rows only studio\'s own clock tells apart are not offered: a stalled chat, a gate not read yet, a row with no identity', () => {
    // A stalled chat's clock is `now - idle` (it moves every minute), so it carries no identity.
    const chat = rowsOf({ chats: [{ chatId: 'chat-0001', seats: ['claude'], idleSecs: 7200 }] }).find((r) => r.kind === 'stalled-chat')!;
    expect(chat.instance).toBeUndefined();
    expect(snoozable(chat)).toBe(false);
    // A run waiting on a person, its gate not read yet: a gate row carries no occurrence either way.
    const [unread] = rowsOf({ runs: [run('run-2', 'awaiting_human')] });
    expect(unread!.instance).toBeUndefined();
    expect(snoozable(unread!)).toBe(false);
    const campaign = row(1, { kind: 'campaign', key: 'campaign:c-1', at: null });
    delete campaign.instance; // a campaign row carries no daemon identity (needsYou.ts: `at: null`, no instance)
    expect(snoozable(campaign)).toBe(false);
  });

  it('a failed run is named by the daemon\'s terminal clock', () => {
    const [f] = rowsOf({ runs: [run('run-3', 'failed', { ended_at: 1_700_000_000 })] }).filter((r) => r.kind === 'failed-run');
    expect(snoozeKey(f!)).toBe('fail:run-3@ended:1700000000000');
  });
});

describe('which rows a snooze holds back (pure)', () => {
  it('holds an item until its end, and lets it back once it gets worse', () => {
    const r = row(1, { severity: 70 });
    const by = { [snoozeKey(r)]: snooze(r, NOW + HOUR) };
    expect(snoozeOf(r, by, NOW)).not.toBeNull();
    expect(snoozeOf(r, by, NOW + HOUR)).toBeNull();
    expect(snoozeOf({ ...r, severity: 100 }, by, NOW)).toBeNull();
    // No rank stored: only the time ends it.
    expect(snoozeOf({ ...r, severity: 100 }, { [snoozeKey(r)]: snooze(r, NOW + HOUR, null) }, NOW)).not.toBeNull();
  });

  it('is for the item instance: a new decision on the same job is not held back by the old snooze', () => {
    const r = row(1);
    const by = { [snoozeKey(r)]: snooze(r, NOW + HOUR) };
    expect(snoozeOf({ ...r, instance: 'ended:99' }, by, NOW)).toBeNull();
    expect(splitSnoozed([r, row(2)], by, NOW).awake.map((x) => x.key)).toEqual(['fail:run-2']);
  });

  it('offers ends crew takes: in the future and at most a week ahead', () => {
    for (const now of [NOW, Date.UTC(2026, 10, 25, 23, 59), Date.UTC(2026, 11, 31, 8)]) {
      for (const c of snoozeChoices(now)) {
        const end = Date.parse(c.until);
        expect(end).toBeGreaterThan(now);
        expect(end - now).toBeLessThanOrEqual(SNOOZE_MAX_MS);
        expect(c.until).toMatch(/Z$/);
      }
    }
  });

  it('sends a whole rank 0-1000 and compares the same rank (pi r1)', () => {
    expect(snoozeRank({ severity: 100.6 })).toBe(101);
    expect(snoozeRank({ severity: 5000 })).toBe(1000);
    expect(snoozeRank({ severity: -3 })).toBe(0);
    const r = row(1, { severity: 100.4 });
    expect(snoozeOf(r, { [snoozeKey(r)]: snooze(r, NOW + HOUR, 100) }, NOW)).not.toBeNull();
  });
});

describe('the ends offered, in local time across DST and year ends (codex r1)', () => {
  const tz = process.env['TZ'];
  afterEach(() => { if (tz === undefined) delete process.env['TZ']; else process.env['TZ'] = tz; });
  it.each([
    ['spring forward', 'America/New_York', '2026-03-07T20:00:00-05:00', 8],
    ['fall back', 'America/New_York', '2026-10-31T23:30:00-04:00', 1],
    ['year end', 'Europe/London', '2026-12-31T22:00:00Z', 1],
  ])('%s (%s): an hour, tomorrow at 9:00 local, three days', (_name, zone, at, day) => {
    process.env['TZ'] = zone;
    const now = Date.parse(at);
    const [hour, tomorrow, days] = snoozeChoices(now);
    expect(Date.parse(hour!.until) - now).toBe(HOUR);
    expect(Date.parse(days!.until) - now).toBe(3 * 24 * HOUR);
    const t = new Date(Date.parse(tomorrow!.until));
    expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([day, 9, 0]);
  });
});

let snoozes: unknown[];
let calls: Array<{ method: string; url: string; body: unknown }>;
type Answer = Response | Promise<Response>;
let putAnswer: (url: string, body: { until: string; severity?: number }) => Answer;
let listAnswer: () => Answer;
let defaultPut: (url: string, body: { until: string; severity?: number }) => Response;
const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  resetDeskSnoozes();
  snoozes = [];
  calls = [];
  listAnswer = () => json({ snoozes });
  defaultPut = (url, body) => {
    const key = decodeURIComponent(url.split('/desk/snoozes/')[1]!);
    const s = { key, until: new Date(Date.parse(body.until)).toISOString(), severity: body.severity ?? null, at: new Date(NOW).toISOString(), by: 'operator' };
    snoozes.push(s);
    return json(s);
  };
  putAnswer = defaultPut;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/desk/snoozes') && method === 'GET') return listAnswer();
    if (url.includes('/desk/snoozes/') && method === 'PUT') return putAnswer(url, JSON.parse(String(init!.body)) as { until: string; severity?: number });
    if (url.includes('/desk/snoozes/') && method === 'DELETE') {
      const key = decodeURIComponent(url.split('/desk/snoozes/')[1]!);
      const had = snoozes.some((s) => (s as { key: string }).key === key);
      snoozes = snoozes.filter((s) => (s as { key: string }).key !== key);
      return json({ key, woken: had });
    }
    return json({ error: 'Not Found' }, 404);
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const props = { runs: [], navigate: vi.fn(), now: NOW, settled: 'complete' as const, agentName: (s: string) => s };
const listed = (): string[] => screen.queryAllByTestId('desk-inbox-row').map((b) => b.getAttribute('data-key') ?? '');

async function openRow(key: string): Promise<HTMLElement> {
  await act(async () => { fireEvent.click(screen.getAllByTestId('desk-inbox-row').find((b) => b.getAttribute('data-key') === key)!); });
  return screen.getByTestId('desk-inbox-read');
}

describe('snoozing in the Desk inbox (crew#1124)', () => {
  it('a snoozed item leaves the list and the count, waits in Snoozed with its end, and Wake now brings it back', async () => {
    const [a, b] = [row(1), row(2)];
    snoozes = [snooze(a, NOW + 3 * HOUR)];
    render(<DeskInbox rows={[a, b]} {...props} />);
    await waitFor(() => expect(listed()).toEqual(['fail:run-2']));
    expect(screen.getByTestId('desk-inbox-count')).toHaveTextContent('1 waiting · 1 unread · 1 snoozed');
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-snoozed')); });
    const item = screen.getByTestId('desk-inbox-snoozed-item');
    expect(item).toHaveAttribute('data-key', 'fail:run-1');
    expect(within(item).getByTestId('desk-inbox-snoozed-until').textContent).toMatch(/^Back today \d+:\d\d$/);
    await act(async () => { fireEvent.click(within(item).getByTestId('desk-inbox-wake')); });
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toMatch(new RegExp(`/api/v1/desk/snoozes/${encodeURIComponent(snoozeKey(a)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-all')); });
    // Back in the list (the queue keeps the order it already showed, so it may come back at the end).
    await waitFor(() => expect([...listed()].sort()).toEqual(['fail:run-1', 'fail:run-2']));
  });

  it('Snooze in the reading pane sends the item instance, its end and its rank, and the item leaves the list', async () => {
    const [a, b] = [row(1), row(2)];
    render(<DeskInbox rows={[a, b]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('fail:run-1');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-hour')); });
    await waitFor(() => expect(listed()).toEqual(['fail:run-2']));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toMatch(new RegExp(`/api/v1/desk/snoozes/fail%3Arun-1%40ended%3A${NOW - HOUR}$`));
    expect(put.body).toEqual({ until: new Date(NOW + HOUR).toISOString(), severity: 70 });
    expect(screen.getByTestId('desk-inbox-count')).toHaveTextContent('· 1 snoozed');
  });

  it('a refused snooze says why and the item stays (an agent: 403 human_operator_only)', async () => {
    putAnswer = () => json({ error: 'Only a human operator can snooze a need.', code: 'human_operator_only' }, 403);
    render(<DeskInbox rows={[row(1)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('fail:run-1');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-tomorrow')); });
    await waitFor(() => expect(within(pane).getByTestId('desk-inbox-snooze-failed')).toHaveTextContent('Only a person can snooze'));
    expect(listed()).toEqual(['fail:run-1']);
  });

  it('a daemon without the snooze route (plain 404) offers no snooze and hides nothing', async () => {
    listAnswer = () => json({ error: 'Not Found' }, 404);
    render(<DeskInbox rows={[row(1)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('fail:run-1');
    await act(async () => { await Promise.resolve(); });
    expect(within(pane).queryByTestId('desk-inbox-snooze')).toBeNull();
    expect(screen.queryByTestId('desk-inbox-folder-snoozed')).toBeNull();
  });

  it('a failed refresh after a good read hides nothing and offers no snooze; the next minute reads again (codex r1)', async () => {
    const [a, b] = [row(1), row(2)];
    snoozes = [snooze(a, NOW + 3 * HOUR)];
    const { rerender } = render(<DeskInbox rows={[a, b]} {...props} />);
    await waitFor(() => expect(listed()).toEqual(['fail:run-2']));
    listAnswer = () => json({ error: 'store locked' }, 500);
    await act(async () => { await useDeskSnoozes.getState().load(); });
    await waitFor(() => expect([...listed()].sort()).toEqual(['fail:run-1', 'fail:run-2']));
    expect(screen.queryByTestId('desk-inbox-folder-snoozed')).toBeNull();
    expect(within(await openRow('fail:run-1')).queryByTestId('desk-inbox-snooze')).toBeNull();
    listAnswer = () => json({ snoozes });
    rerender(<DeskInbox rows={[a, b]} {...props} now={NOW + 60_000} />);
    await waitFor(() => expect(listed()).toEqual(['fail:run-2']));
  });

  it('a read that started before a snooze landed does not bring the item back (codex, pi r1)', async () => {
    const [a, b] = [row(1), row(2)];
    render(<DeskInbox rows={[a, b]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const held: Array<() => void> = [];
    listAnswer = () => { const before = [...snoozes]; return new Promise((done) => { held.push(() => done(json({ snoozes: before }))); }); };
    const stale = useDeskSnoozes.getState().load(); // in flight; nothing changes until it answers
    const pane = await openRow('fail:run-1');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-hour')); });
    await waitFor(() => expect(listed()).toEqual(['fail:run-2']));
    expect(held.length).toBe(2); // the read in flight, and the one the snooze starts
    await act(async () => { held[0]!(); await stale; });
    expect(listed()).toEqual(['fail:run-2']);
    await act(async () => { held[1]!(); await new Promise((r) => setTimeout(r, 0)); });
    expect(listed()).toEqual(['fail:run-2']);
  });

  it('a read that started before a wake landed does not hide the item again', async () => {
    const [a, b] = [row(1), row(2)];
    snoozes = [snooze(a, NOW + 3 * HOUR)];
    render(<DeskInbox rows={[a, b]} {...props} />);
    await waitFor(() => expect(listed()).toEqual(['fail:run-2']));
    const held: Array<() => void> = [];
    listAnswer = () => { const before = [...snoozes]; return new Promise((done) => { held.push(() => done(json({ snoozes: before }))); }); };
    const stale = useDeskSnoozes.getState().load();
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-snoozed')); });
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-wake')); });
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-all')); });
    await waitFor(() => expect([...listed()].sort()).toEqual(['fail:run-1', 'fail:run-2']));
    expect(held.length).toBe(2); // the read in flight, and the one the wake starts
    await act(async () => { held[0]!(); await stale; });
    expect([...listed()].sort()).toEqual(['fail:run-1', 'fail:run-2']);
    await act(async () => { held[1]!(); await new Promise((r) => setTimeout(r, 0)); });
    expect([...listed()].sort()).toEqual(['fail:run-1', 'fail:run-2']);
  });

  it('an end crew refuses (400 desk_snooze_invalid) says what crew takes', async () => {
    putAnswer = () => json({ error: 'until must be in the future', code: 'desk_snooze_invalid' }, 400);
    render(<DeskInbox rows={[row(1)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('fail:run-1');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-days')); });
    await waitFor(() => expect(within(pane).getByTestId('desk-inbox-snooze-failed')).toHaveTextContent('a snooze ends in the future, at most a week ahead'));
    expect(listed()).toEqual(['fail:run-1']);
  });

  it('keyboard: the choices take focus when they open, and Cancel hands it back to Snooze (pi r1)', async () => {
    render(<DeskInbox rows={[row(1)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('fail:run-1');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    expect(document.activeElement).toBe(within(pane).getByTestId('desk-inbox-snooze-hour'));
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-cancel')); });
    expect(document.activeElement).toBe(within(pane).getByTestId('desk-inbox-snooze'));
    // A refusal hands focus back to Snooze too (codex delta P3).
    putAnswer = () => json({ error: 'nope', code: 'desk_snooze_unsaved' }, 500);
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-hour')); });
    await waitFor(() => expect(within(pane).getByTestId('desk-inbox-snooze-failed')).toHaveTextContent('Couldn’t snooze it just now'));
    expect(document.activeElement).toBe(within(pane).getByTestId('desk-inbox-snooze'));
  });

  it('a new occurrence while a snooze is on its way starts with fresh controls and stays in the list (codex r1)', async () => {
    const [a, b] = [row(1), row(2)];
    let release: (() => void) | null = null;
    putAnswer = (url, body) => new Promise((done) => { release = () => done(defaultPut(url, body)); });
    const { rerender } = render(<DeskInbox rows={[a, b]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('fail:run-1');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-hour')); });
    expect(within(pane).getByTestId('desk-inbox-snooze-hour')).toBeDisabled();
    const next = { ...a, instance: `ended:${NOW}` };
    rerender(<DeskInbox rows={[next, b]} {...props} />);
    expect(within(screen.getByTestId('desk-inbox-read')).getByTestId('desk-inbox-snooze')).toBeEnabled();
    await act(async () => { release!(); await Promise.resolve(); });
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2));
    expect([...listed()].sort()).toEqual(['fail:run-1', 'fail:run-2']);
  });

  it('an item that got worse since it was snoozed is back in the list', async () => {
    const a = row(1, { kind: 'failed-run', severity: 70 });
    snoozes = [snooze(a, NOW + 3 * HOUR)];
    const { rerender } = render(<DeskInbox rows={[a]} {...props} />);
    await waitFor(() => expect(listed()).toEqual([]));
    rerender(<DeskInbox rows={[{ ...a, severity: 94 }]} {...props} />);
    expect(listed()).toEqual(['fail:run-1']);
  });
});
