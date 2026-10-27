import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { getRunEvents: (...a: unknown[]) => events(...a) }, apiBase: () => 'http://x/api/v1' }));

import { DeskHappening, resetHappeningBackfill } from '../src/components/desk/DeskHappening.js';
import { resetDeskStream, useDeskStream } from '../src/store/deskStream.js';
import { DEFAULT_REFINE } from '../src/board/deskInsights.js';
import { runsView } from '../src/board/deskRuns.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { DAY, NOW, deskRun, names, title } from './fixtures/deskV2.js';

/** codex r3 (lane half): Happening words follow the contract; failed reads stay visible; Runs reach every job. */
const run = (id: string): SessionView => ({ session: { id, status: 'running', created_at: 1_700_000_000, problem: id }, units: [] } as unknown as SessionView);
const ev = (e: Record<string, unknown>): CoreEvent => ({ session: 'a', ord: 0, ts: Date.now(), ...e } as unknown as CoreEvent);

function mount(runs: SessionView[]): void {
  render(<DeskHappening runs={runs} runsShown navigate={() => {}} now={Date.now()} title={(v) => v.session.id} pathOf={(id) => `/s/${id}`} agentName={(c) => c} />);
}

describe('Happening now words (codex r3)', () => {
  beforeEach(() => { resetDeskStream(); resetHappeningBackfill(); events.mockReset(); events.mockResolvedValue({ events: [] }); });
  afterEach(() => { cleanup(); });

  it('deliberate wrapped routing is not called ungoverned; other fallbacks are', async () => {
    act(() => {
      useDeskStream.getState().ingest(ev({ type: 'acpFallback', cliKey: 'codex', reason: 'r', fallbackKind: 'read_only_requires_wrapped', ord: 1 }));
      useDeskStream.getState().ingest(ev({ type: 'acpFallback', cliKey: 'pi', reason: 'r', fallbackKind: 'session_died', ord: 2 }));
    });
    mount([run('a')]);
    const text = (await screen.findByTestId('desk-stream')).textContent ?? '';
    expect(text).toContain('codex ran');
    expect(text).toContain('single-shot, as its checks require');
    expect(text).not.toContain('ungoverned');
    expect(text).toContain('pi lost its live session');
    expect(text).toContain('without per-action checks');
  });

  it('a seat benched for its account is said as left out, not as work that ran unchecked (codex r4)', async () => {
    act(() => { useDeskStream.getState().ingest(ev({ type: 'acpFallback', cliKey: 'pi', reason: 'r', fallbackKind: 'auth_failed', ord: 5 })); });
    mount([run('a')]);
    const text = (await screen.findByTestId('desk-stream')).textContent ?? '';
    expect(text).toContain('pi couldn’t sign in, so it was left out of this job');
    expect(text).not.toContain('single-shot');
  });

  it('an allowed gate says approved, never that checks passed', async () => {
    act(() => { useDeskStream.getState().ingest(ev({ type: 'gateDecided', allow: true, ord: 3 })); });
    mount([run('a')]);
    const text = (await screen.findByTestId('desk-stream')).textContent ?? '';
    expect(text).toContain('was approved');
    expect(text).not.toContain('passed its checks');
  });

  it('a backfill whose every read failed keeps its count and retry even when live events fill the list', async () => {
    events.mockRejectedValue(new Error('500'));
    act(() => { useDeskStream.getState().ingest(ev({ type: 'unitDone', ord: 4 })); });
    mount([run('a'), run('b')]);
    await waitFor(() => expect(screen.getByTestId('desk-stream-state')).toHaveTextContent('2 of 2 jobs not read'));
    expect(screen.getByTestId('desk-stream-retry')).toBeInTheDocument();
  });
});

describe('Runs: All time (codex r3)', () => {
  const runs = [
    deskRun('recent'),
    deskRun('old', { created_at: (NOW - 200 * DAY) / 1000 }),
    deskRun('undated', { created_at: undefined as unknown as number }),
    deskRun('archived', { archived_at: (NOW - DAY) / 1000 } as Partial<SessionView['session']>),
  ];
  it('says how many more jobs All time holds, then shows older, undated and archived ones', () => {
    const opts = { group: 'finished' as const, status: 'all' as const, query: '', now: NOW, title, names };
    const win = runsView(runs, DEFAULT_REFINE, opts);
    expect(win.rows.map((r) => r.id)).toEqual(['recent']);
    expect(win.beyond).toBe(3);
    const all = runsView(runs, DEFAULT_REFINE, { ...opts, allTime: true });
    expect(all.rows.map((r) => r.id).sort()).toEqual(['archived', 'old', 'recent', 'undated']);
    expect(all.beyond).toBe(0);
    expect(all.stats.ended).toBe(4);
  });
});
