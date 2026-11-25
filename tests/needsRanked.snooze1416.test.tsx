import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSnapshot, type SystemSnapshot } from '../src/api/system.js';
import { NeedsRanked } from '../src/components/desk/NeedsRanked.js';
import { resetDeskSnoozes } from '../src/store/deskSnoozes.js';
import { resetSystemStore, useSystemStore } from '../src/store/systemSnapshot.js';

/**
 * studio#1416: snooze on the ranked Needs-you page. Crew (wicked-crew feat/1416-snoozed-attention, api-types 0.231.0)
 * marks each attention item a person may snooze with `snooze: {key, rank}` and returns the items a snooze holds back
 * in `snoozed[]` with their end (`holdSnoozed` in packages/crew/src/api/desk-snoozes.ts writes `{...item, snooze}` and
 * `{...item, snooze, until}`). Snoozing is `PUT /desk/snoozes/:key {until, severity: rank}`; studio then re-reads
 * /system, so the list, its number and every count that reads it follow crew.
 */

vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...original, api: { ...original.api, getHealth: () => new Promise(() => undefined) } };
});
vi.mock('../src/store/systemSnapshot.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/store/systemSnapshot.js')>();
  return { ...original, useSystemPoll: () => undefined };
});

const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const H = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const GATE = {
  id: 'run:68c26704', severity: 'yellow', source: 'run', kind: 'prevents', title: 'Where is wicked-core riskiest to change',
  reason: 'Waiting for you to approve its plan', remedy: 'Answer the gate.', blocks: 1, blockedRunIds: ['68c26704'],
  waitedSince: iso(NOW - 0.5 * H), unitsLeft: 1, target: { kind: 'run', runId: '68c26704', gateOrd: 1, interactionId: 'ir_9' },
  action: { kind: 'open_gate', label: 'Open the gate' }, snooze: { key: 'attention:run:68c26704@ir_9', rank: 101 },
};
const LOAD = {
  id: 'infra:load', severity: 'yellow', source: 'infra', kind: 'slows', title: 'Host load: degraded', reason: 'load 51 on 14 cores',
  remedy: 'Avoid starting more parallel runs.', blocks: 2, blockedRunIds: ['a', 'b'], waitedSince: null, unitsLeft: 3,
  target: { kind: 'infra', key: 'load' }, action: { kind: 'recheck', label: 'Re-check' },
};
const HELD = {
  id: 'run:290a7fee', severity: 'red', source: 'run', kind: 'prevents', title: 'wicked-core#840: a dead seat', reason: 'held at an escalation gate',
  remedy: 'Open the gate.', blocks: 1, blockedRunIds: ['290a7fee'], waitedSince: iso(NOW - 6 * H), unitsLeft: 4,
  target: { kind: 'run', runId: '290a7fee', gateOrd: 4, interactionId: 'ir_4' }, action: { kind: 'open_gate', label: 'Open the gate' },
  snooze: { key: 'attention:run:290a7fee@ir_4', rank: 201 }, until: iso(NOW + 3 * H),
};
const wire = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  checkedAt: iso(NOW), budgetMs: 8000, tookMs: 900, level: 'yellow', attention: [LOAD, GATE], snoozed: [HELD],
  unresolved: [], unresolvedSpend: { costUsd: null, tokens: null, costKnown: 0 }, toReview: 0, clis: [], runs: [], infra: [], governance: [], ...over,
});
const snap = (over: Record<string, unknown> = {}): SystemSnapshot => ({ ...normalizeSnapshot(wire(over)), ranked: true });

let calls: Array<{ method: string; url: string; body: unknown }>;
let answer: (method: string, url: string) => Response;
const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const refresh = vi.fn(async () => undefined);

beforeEach(() => {
  resetSystemStore();
  resetDeskSnoozes();
  refresh.mockClear();
  useSystemStore.setState({ refresh });
  calls = [];
  answer = (method, url) => {
    const key = decodeURIComponent(url.split('/desk/snoozes/')[1] ?? '');
    if (method === 'PUT') return json({ key, until: iso(NOW + H), severity: 101, at: iso(NOW), by: 'operator' });
    if (method === 'DELETE') return json({ key, woken: true });
    return json({ snoozes: [] });
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined });
    return answer(method, url);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = (s: SystemSnapshot) => render(<NeedsRanked snapshot={s} runs={[]} needRows={[]} navigate={vi.fn()} now={NOW} />);
const row = (id: string): HTMLElement => screen.getAllByTestId('needs-item').find((el) => el.getAttribute('data-id') === id)!;

describe('the ranked wire carries snoozes (studio#1416)', () => {
  it('reads each item\'s snooze and the held-back items with their end; an older crew has neither', () => {
    const s = snap();
    expect(s.attention.find((a) => a.id === 'run:68c26704')!.snooze).toEqual({ key: 'attention:run:68c26704@ir_9', rank: 101 });
    expect(s.attention.find((a) => a.id === 'infra:load')!.snooze).toBeNull();
    expect(s.snoozed).toEqual([expect.objectContaining({ id: 'run:290a7fee', until: NOW + 3 * H, snooze: { key: 'attention:run:290a7fee@ir_4', rank: 201 } })]);
    const older = normalizeSnapshot({ ...wire(), snoozed: undefined, attention: [LOAD, { ...GATE, snooze: undefined }] });
    expect(older.snoozed).toEqual([]);
    expect(older.attention.every((a) => a.snooze === null)).toBe(true);
  });
});

describe('Snooze on the ranked Needs-you page (studio#1416)', () => {
  it('offers Snooze only on what crew marks snoozable; it sends the key, the end and crew\'s rank, then re-reads /system', async () => {
    view(snap());
    expect(within(row('infra:load')).queryByTestId('needs-item-snooze')).toBeNull();
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze')); });
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze-hour')); });
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ force: true }));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toMatch(/\/api\/v1\/desk\/snoozes\/attention%3Arun%3A68c26704%40ir_9$/);
    expect(put.body).toEqual({ until: expect.stringMatching(/Z$/), severity: 101 });
  });

  it('a refused snooze says why and re-reads nothing (an agent: 403 human_operator_only)', async () => {
    answer = () => json({ error: 'Snoozing a need is a person\'s choice', code: 'human_operator_only' }, 403);
    view(snap());
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze')); });
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze-tomorrow')); });
    await waitFor(() => expect(within(row('run:68c26704')).getByTestId('needs-item-snooze-failed')).toHaveTextContent('Only a person can snooze'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says how many are snoozed, lists them with their end, and Wake now brings one back', async () => {
    view(snap());
    const held = screen.getByTestId('needs-snoozed');
    expect(within(held).getByTestId('needs-snoozed-summary')).toHaveTextContent('1 snoozed');
    const item = within(held).getByTestId('needs-snoozed-item');
    expect(item).toHaveTextContent('wicked-core#840: a dead seat');
    expect(within(item).getByTestId('needs-snoozed-until').textContent).toMatch(/^Back (today|tomorrow) \d+:\d\d$/);
    await act(async () => { fireEvent.click(within(item).getByTestId('needs-snoozed-wake')); });
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ force: true }));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toMatch(/\/api\/v1\/desk\/snoozes\/attention%3Arun%3A290a7fee%40ir_4$/);
  });

  it('nothing snoozed: no snoozed line; the number stays crew\'s list length', () => {
    view(snap({ snoozed: [] }));
    expect(screen.queryByTestId('needs-snoozed')).toBeNull();
    expect(screen.getByTestId('needs-sentence')).toHaveAttribute('data-count', '2');
  });
});
