import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeSnapshot, type SystemSnapshot } from '../src/api/system.js';
import { NeedsRanked } from '../src/components/desk/NeedsRanked.js';
import { snoozeEndWords } from '../src/board/deskSnooze.js';
import { resetDeskSnoozes } from '../src/store/deskSnoozes.js';
import { resetSystemStore, useSystemStore } from '../src/store/systemSnapshot.js';

/**
 * studio#1416: snooze on the ranked Needs-you page. Crew (wicked-crew feat/1416-snoozed-attention, api-types 0.231.0)
 * marks each attention item a person may snooze with `snooze: {key, rank}` and returns the items a snooze holds back
 * in `snoozed[]` with their end (`holdSnoozed`, packages/crew/src/api/desk-snoozes.ts:69, writes `{...item, snooze}`
 * and `{...item, snooze, until}`; `attentionSnooze` at :54 writes the key `attention:<id>@<interactionId>@<waitedSince>`
 * for one run's own open gate, and the rank `(red ? 200 : 100) + min(blocks, 99)`). Snoozing is `PUT /desk/snoozes/:key {until, severity: rank}`; studio then re-reads
 * /system, so the list, its number and every count that reads it follow crew.
 */

const live = vi.hoisted(() => ({ health: (): Promise<unknown> => new Promise(() => undefined) }));
vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...original, api: { ...original.api, getHealth: () => live.health() } };
});
vi.mock('../src/store/systemSnapshot.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/store/systemSnapshot.js')>();
  return { ...original, useSystemPoll: () => undefined };
});

const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const H = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const GATE_AT = iso(NOW - 0.5 * H);
const HELD_AT = iso(NOW - 6 * H);
const GATE = {
  id: 'run:68c26704', severity: 'yellow', source: 'run', kind: 'prevents', title: 'Where is wicked-core riskiest to change',
  reason: 'Waiting for you to approve its plan', remedy: 'Answer the gate.', blocks: 1, blockedRunIds: ['68c26704'],
  waitedSince: GATE_AT, unitsLeft: 1, target: { kind: 'run', runId: '68c26704', gateOrd: 1, interactionId: 'ir_9' },
  action: { kind: 'open_gate', label: 'Open the gate' }, snooze: { key: `attention:run:68c26704@ir_9@${GATE_AT}`, rank: 101 },
};
const LOAD = {
  id: 'infra:load', severity: 'yellow', source: 'infra', kind: 'slows', title: 'Host load: degraded', reason: 'load 51 on 14 cores',
  remedy: 'Avoid starting more parallel runs.', blocks: 2, blockedRunIds: ['a', 'b'], waitedSince: null, unitsLeft: 3,
  target: { kind: 'infra', key: 'load' }, action: { kind: 'recheck', label: 'Re-check' },
};
const HELD = {
  id: 'run:290a7fee', severity: 'red', source: 'run', kind: 'prevents', title: 'wicked-core#840: a dead seat', reason: 'held at an escalation gate',
  remedy: 'Open the gate.', blocks: 1, blockedRunIds: ['290a7fee'], waitedSince: HELD_AT, unitsLeft: 4,
  target: { kind: 'run', runId: '290a7fee', gateOrd: 4, interactionId: 'ir_4' }, action: { kind: 'open_gate', label: 'Open the gate' },
  snooze: { key: `attention:run:290a7fee@ir_4@${HELD_AT}`, rank: 201 }, until: iso(NOW + 3 * H),
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
    expect(s.attention.find((a) => a.id === 'run:68c26704')!.snooze).toEqual({ key: `attention:run:68c26704@ir_9@${GATE_AT}`, rank: 101 });
    expect(s.attention.find((a) => a.id === 'infra:load')!.snooze).toBeNull();
    expect(s.snoozed).toEqual([expect.objectContaining({ id: 'run:290a7fee', until: NOW + 3 * H, snooze: { key: `attention:run:290a7fee@ir_4@${HELD_AT}`, rank: 201 } })]);
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
    expect(put.url.endsWith(`/api/v1/desk/snoozes/${encodeURIComponent(GATE.snooze.key)}`)).toBe(true);
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
    expect(within(item).getByTestId('needs-snoozed-until')).toHaveTextContent(`Back ${snoozeEndWords(HELD.until, NOW)}`);
    await act(async () => { fireEvent.click(within(item).getByTestId('needs-snoozed-wake')); });
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ force: true }));
    expect(calls.find((c) => c.method === 'DELETE')!.url.endsWith(`/api/v1/desk/snoozes/${encodeURIComponent(HELD.snooze.key)}`)).toBe(true);
  });

  it('nothing snoozed: no snoozed line; the number stays crew\'s list length', () => {
    view(snap({ snoozed: [] }));
    expect(screen.queryByTestId('needs-snoozed')).toBeNull();
    expect(screen.getByTestId('needs-sentence')).toHaveAttribute('data-count', '2');
  });
});

describe('what the ranked wire may offer (studio#1416 round 1)', () => {
  it('a snooze outside crew\'s contract is not offered, and the item stays: rank 100-299 whole, key 1-200 characters', () => {
    const bad = [{ key: GATE.snooze.key, rank: 999 }, { key: GATE.snooze.key, rank: 99 }, { key: GATE.snooze.key, rank: 101.5 }, { key: '', rank: 101 }, { key: 'k'.repeat(201), rank: 101 }];
    for (const snooze of bad) {
      const s = normalizeSnapshot(wire({ attention: [{ ...GATE, snooze }] }));
      expect(s.attention.map((a) => a.id)).toEqual(['run:68c26704']);
      expect(s.attention[0]!.snooze).toBeNull();
    }
    expect(normalizeSnapshot(wire({ attention: [{ ...GATE, snooze: { key: 'k'.repeat(200), rank: 299 } }] })).attention[0]!.snooze).toEqual({ key: 'k'.repeat(200), rank: 299 });
  });

  it('a held item with an end that is no time is kept, counted, and can be woken; nothing throws', () => {
    view(snap({ snoozed: [{ ...HELD, until: 1e20 }, { ...HELD, id: 'run:other', snooze: { key: 'attention:run:other@ir_1@x', rank: 999 }, until: 'soon' }] }));
    expect(screen.getByTestId('needs-snoozed-summary')).toHaveTextContent('2 snoozed');
    const items = screen.getAllByTestId('needs-snoozed-item');
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(within(item).queryByTestId('needs-snoozed-until')).toBeNull();
      expect(within(item).getByTestId('needs-snoozed-wake')).toBeEnabled();
    }
  });

  it('an older crew: no Snooze on any row and no snoozed line', () => {
    view({ ...normalizeSnapshot({ ...wire(), snoozed: undefined, attention: [LOAD, { ...GATE, snooze: undefined }] }), ranked: true });
    expect(screen.queryByTestId('needs-item-snooze')).toBeNull();
    expect(screen.queryByTestId('needs-snoozed')).toBeNull();
  });

  it('Cancel sends nothing and hands focus back to Snooze', async () => {
    view(snap());
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze')); });
    expect(document.activeElement).toBe(within(row('run:68c26704')).getByTestId('needs-item-snooze-hour'));
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze-cancel')); });
    expect(document.activeElement).toBe(within(row('run:68c26704')).getByTestId('needs-item-snooze'));
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('a held item\'s Wake belongs to its occurrence: a new occurrence of the same run starts fresh', async () => {
    let finish: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'DELETE') return new Promise<Response>((r) => { finish = r; });
      return Promise.resolve(answer(init?.method ?? 'GET', url));
    }));
    const { rerender } = view(snap());
    await act(async () => { fireEvent.click(screen.getByTestId('needs-snoozed-wake')); });
    expect(screen.getByTestId('needs-snoozed-wake')).toBeDisabled();
    const next = { ...HELD, snooze: { key: `attention:run:290a7fee@ir_4@${iso(NOW - H)}`, rank: 201 } };
    rerender(<NeedsRanked snapshot={snap({ snoozed: [next] })} runs={[]} needRows={[]} navigate={vi.fn()} now={NOW} />);
    expect(screen.getByTestId('needs-snoozed-wake')).toBeEnabled();
    await act(async () => { finish(json({ error: 'refused', code: 'human_operator_only' }, 403)); });
    expect(screen.queryByText(/Only a person/)).toBeNull();
  });
});

describe('Snooze and Wake through crew\'s re-read (studio#1416 round 1)', () => {
  // Crew's side, as desk-snoozes.ts holdSnoozed answers it: a snooze in force moves the item into snoozed[].
  let held: Map<string, string>;
  let late: Array<() => void>;
  let holdNext = false;
  const system = (): Record<string, unknown> => {
    const keyOf = (a: Record<string, unknown>): string => (a['snooze'] as { key: string } | undefined)?.key ?? '';
    const items: Array<Record<string, unknown>> = [LOAD, GATE, { ...HELD, until: undefined }];
    const keep = items.filter((a) => !held.has(keyOf(a)));
    const back = items.filter((a) => held.has(keyOf(a))).map((a) => ({ ...a, until: held.get(keyOf(a)) }));
    return wire({ attention: keep, snoozed: back });
  };
  function Live(): React.ReactElement | null {
    const s = useSystemStore((st) => st.snapshot);
    return s === null ? null : <NeedsRanked snapshot={s} runs={[]} needRows={[]} navigate={vi.fn()} now={NOW} />;
  }
  beforeEach(() => {
    held = new Map([[HELD.snooze.key, iso(NOW + 3 * H)]]);
    late = [];
    holdNext = false;
    live.health = async () => ({ status: 'ok', capabilities: { system: true, attentionRanked: true } });
    useSystemStore.setState({ refresh: resetRefresh });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/api/v1/system')) {
        const body = system();
        if (holdNext) { holdNext = false; return new Promise<Response>((r) => { late.push(() => r(json(body))); }); }
        return json(body);
      }
      const key = decodeURIComponent(url.split('/desk/snoozes/')[1] ?? '');
      if (method === 'PUT') { const b = JSON.parse(String(init!.body)) as { until: string; severity: number }; held.set(key, b.until); return json({ key, ...b, at: iso(NOW), by: 'operator' }); }
      if (method === 'DELETE') { held.delete(key); return json({ key, woken: true }); }
      return json({ snoozes: [] });
    }));
  });
  afterEach(() => { live.health = () => new Promise(() => undefined); });
  const resetRefresh = useSystemStore.getState().refresh;

  it('Snooze: the item leaves the list, the number drops, "N snoozed" grows, and focus lands on it', async () => {
    await act(async () => { await useSystemStore.getState().refresh(); });
    render(<Live />);
    expect(screen.getByTestId('needs-sentence')).toHaveAttribute('data-count', '2');
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze')); });
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze-hour')); });
    await waitFor(() => expect(screen.getByTestId('needs-sentence')).toHaveAttribute('data-count', '1'));
    expect(screen.queryAllByTestId('needs-item').map((el) => el.getAttribute('data-id'))).toEqual(['infra:load']);
    expect(screen.getByTestId('needs-snoozed-summary')).toHaveTextContent('2 snoozed');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('needs-snoozed-summary')));
  });

  it('Wake now: the item comes back with the number, and focus lands on its row', async () => {
    await act(async () => { await useSystemStore.getState().refresh(); });
    render(<Live />);
    expect(screen.getByTestId('needs-sentence')).toHaveAttribute('data-count', '2');
    await act(async () => { fireEvent.click(screen.getByTestId('needs-snoozed-wake')); });
    await waitFor(() => expect(screen.getByTestId('needs-sentence')).toHaveAttribute('data-count', '3'));
    expect(screen.queryByTestId('needs-snoozed')).toBeNull();
    await waitFor(() => expect(row('run:290a7fee').contains(document.activeElement)).toBe(true));
  });

  it('a /system read begun before the snooze and answering after it does not bring the old list back', async () => {
    await act(async () => { await useSystemStore.getState().refresh(); });
    render(<Live />);
    holdNext = true;
    let first: Promise<void> = Promise.resolve();
    act(() => { first = useSystemStore.getState().refresh(); }); // a poll, in flight with the pre-snooze list
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze')); });
    await act(async () => { fireEvent.click(within(row('run:68c26704')).getByTestId('needs-item-snooze-hour')); });
    await act(async () => { late.forEach((f) => f()); await first; });
    await waitFor(() => expect(screen.getByTestId('needs-sentence')).toHaveAttribute('data-count', '1'));
    expect(screen.getByTestId('needs-snoozed-summary')).toHaveTextContent('2 snoozed');
  });
});
