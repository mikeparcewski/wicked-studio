import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeedRow } from '../src/board/needsYou.js';
import { DeskInbox } from '../src/components/desk/DeskInbox.js';
import { snoozeChoices, snoozeKey, snoozeOf, splitSnoozed, SNOOZE_MAX_MS } from '../src/board/deskSnooze.js';
import { resetDeskSnoozes } from '../src/store/deskSnoozes.js';

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

const row = (i: number, over: Partial<NeedRow> = {}): NeedRow => ({
  key: `gate:run-${i}`, kind: 'gate', severity: 100, stakes: 1,
  subject: `Job ${i}`, text: `Approve step ${i}?`, tone: 'gate', at: NOW - i * HOUR,
  subjectPath: `/run/run-${i}`, action: { kind: 'open', path: `/run/run-${i}`, label: 'Open' }, ...over,
});

const snooze = (r: NeedRow, untilMs: number, severity: number | null = r.severity) =>
  ({ key: snoozeKey(r), until: new Date(untilMs).toISOString(), severity, at: new Date(NOW - HOUR).toISOString(), by: 'operator' });

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
    expect(snoozeOf({ ...r, at: NOW }, by, NOW)).toBeNull();
    expect(splitSnoozed([r, row(2)], by, NOW).awake.map((x) => x.key)).toEqual(['gate:run-2']);
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
});

let snoozes: unknown[];
let calls: Array<{ method: string; url: string; body: unknown }>;
let putAnswer: (url: string, body: { until: string; severity?: number }) => Response;
let listAnswer: () => Response;
const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  resetDeskSnoozes();
  snoozes = [];
  calls = [];
  listAnswer = () => json({ snoozes });
  putAnswer = (url, body) => {
    const key = decodeURIComponent(url.split('/desk/snoozes/')[1]!);
    const s = { key, until: new Date(Date.parse(body.until)).toISOString(), severity: body.severity ?? null, at: new Date(NOW).toISOString(), by: 'operator' };
    snoozes.push(s);
    return json(s);
  };
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
    await waitFor(() => expect(listed()).toEqual(['gate:run-2']));
    expect(screen.getByTestId('desk-inbox-count')).toHaveTextContent('1 waiting · 1 unread · 1 snoozed');
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-snoozed')); });
    const item = screen.getByTestId('desk-inbox-snoozed-item');
    expect(item).toHaveAttribute('data-key', 'gate:run-1');
    expect(within(item).getByTestId('desk-inbox-snoozed-until').textContent).toMatch(/^Back today \d+:\d\d$/);
    await act(async () => { fireEvent.click(within(item).getByTestId('desk-inbox-wake')); });
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toMatch(new RegExp(`/api/v1/desk/snoozes/${encodeURIComponent(snoozeKey(a)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await act(async () => { fireEvent.click(screen.getByTestId('desk-inbox-folder-all')); });
    // Back in the list (the queue keeps the order it already showed, so it may come back at the end).
    await waitFor(() => expect([...listed()].sort()).toEqual(['gate:run-1', 'gate:run-2']));
  });

  it('Snooze in the reading pane sends the item instance, its end and its rank, and the item leaves the list', async () => {
    const [a, b] = [row(1), row(2)];
    render(<DeskInbox rows={[a, b]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('gate:run-1');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-hour')); });
    await waitFor(() => expect(listed()).toEqual(['gate:run-2']));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toMatch(/\/api\/v1\/desk\/snoozes\/gate%3Arun-1%40\d+$/);
    expect(put.body).toEqual({ until: new Date(NOW + HOUR).toISOString(), severity: 100 });
    expect(screen.getByTestId('desk-inbox-count')).toHaveTextContent('· 1 snoozed');
  });

  it('a refused snooze says why and the item stays (an agent: 403 human_operator_only)', async () => {
    putAnswer = () => json({ error: 'Only a human operator can snooze a need.', code: 'human_operator_only' }, 403);
    render(<DeskInbox rows={[row(1)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('gate:run-1');
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze')); });
    await act(async () => { fireEvent.click(within(pane).getByTestId('desk-inbox-snooze-tomorrow')); });
    await waitFor(() => expect(within(pane).getByTestId('desk-inbox-snooze-failed')).toHaveTextContent('Only a person can snooze'));
    expect(listed()).toEqual(['gate:run-1']);
  });

  it('a daemon without the snooze route (plain 404) offers no snooze and hides nothing', async () => {
    listAnswer = () => json({ error: 'Not Found' }, 404);
    render(<DeskInbox rows={[row(1)]} {...props} />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true));
    const pane = await openRow('gate:run-1');
    await act(async () => { await Promise.resolve(); });
    expect(within(pane).queryByTestId('desk-inbox-snooze')).toBeNull();
    expect(screen.queryByTestId('desk-inbox-folder-snoozed')).toBeNull();
  });

  it('an item that got worse since it was snoozed is back in the list', async () => {
    const a = row(1, { kind: 'failed-run', severity: 70 });
    snoozes = [snooze(a, NOW + 3 * HOUR)];
    const { rerender } = render(<DeskInbox rows={[a]} {...props} />);
    await waitFor(() => expect(listed()).toEqual([]));
    rerender(<DeskInbox rows={[{ ...a, severity: 94 }]} {...props} />);
    expect(listed()).toEqual(['gate:run-1']);
  });
});
