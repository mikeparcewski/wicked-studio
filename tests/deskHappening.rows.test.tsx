import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { getRunEvents: (...a: unknown[]) => events(...a) }, apiBase: () => 'http://x/api/v1' }));

import { DeskHappening, resetHappeningBackfill } from '../src/components/desk/DeskHappening.js';
import { resetDeskStream, useDeskStream } from '../src/store/deskStream.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';

/**
 * Happening now as structured items (2026-10-26, "looks like a mainframe screen"): one row per run of a
 * job's events = a mark in its tone, the job's title as the one link, its age, and ONE line with the newest
 * event in plain words. A run of several events keeps every one behind a disclosure on that line; nothing is
 * joined into a "Title · N events: a, b, c, …" sentence.
 */
const run = (id: string, problem: string): SessionView => ({ session: { id, status: 'running', created_at: 1_700_000_000, problem }, units: [] } as unknown as SessionView);
const T0 = Date.now() - 60_000;
const ev = (e: Record<string, unknown>): CoreEvent => ({ session: 'a', ...e } as unknown as CoreEvent);

function mount(runs: SessionView[], navigate = vi.fn()): ReturnType<typeof vi.fn> {
  render(<DeskHappening runs={runs} runsShown navigate={navigate} now={Date.now()} title={(v) => (v.session as { problem: string }).problem} pathOf={(id) => `/s/${id}`} agentName={(c) => c} />);
  return navigate;
}

describe('Happening now rows', () => {
  beforeEach(() => { resetDeskStream(); resetHappeningBackfill(); events.mockReset(); events.mockResolvedValue({ events: [] }); });
  afterEach(() => { cleanup(); });

  it('a run of events is one item: title link, the newest event as its line, every event behind a disclosure', async () => {
    act(() => {
      useDeskStream.getState().backfill([
        ev({ type: 'unitDone', ord: 1, seq: 1, ts: T0 }),
        ev({ type: 'gateEscalated', ord: 2, seq: 2, ts: T0 + 1000 }),
        ev({ type: 'stepFailed', ord: 3, seq: 3, ts: T0 + 2000 }),
      ]);
    });
    const navigate = mount([run('a', 'Fix the parser')]);
    const items = await screen.findAllByTestId('desk-stream-item');
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.dataset.count).toBe('3');
    // The worst tone marks the row, said for a screen reader.
    expect(item.dataset.tone).toBe('fail');
    expect(within(item).getByRole('img', { name: 'Problem' })).toBeInTheDocument();
    // The title is the one action: it opens the job.
    const open = within(item).getByTestId('desk-stream-open');
    expect(open).toHaveTextContent('Fix the parser');
    expect(within(item).getAllByRole('link')).toHaveLength(1);
    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith('/s/a');
    // ONE line: the newest event, and the count as the disclosure; never a joined run-on sentence.
    const summary = within(item).getByTestId('desk-stream-expand');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary).toHaveTextContent('Step 3 failed');
    expect(summary).toHaveTextContent('3 events');
    expect(item.textContent).not.toMatch(/events:/);
    expect(item.textContent).not.toContain('…');
    // Every event stays reachable, newest first, behind the disclosure.
    const each = within(item).getByRole('list', { name: /Every event/ });
    expect([...each.querySelectorAll('li')].map((li) => li.querySelector('.wk-stream-sub-text')?.textContent)).toEqual(['Step 3 failed', 'Step 2 needs a person to decide', 'An agent finished step 1']);
  });

  it('a single event is a plain line (no disclosure), and a decision is marked as one', async () => {
    act(() => { useDeskStream.getState().backfill([ev({ type: 'awaitingHuman', ord: 4, seq: 1, ts: T0 })]); });
    mount([run('a', 'Ship it')]);
    const item = (await screen.findAllByTestId('desk-stream-item'))[0]!;
    expect(within(item).queryByTestId('desk-stream-expand')).toBeNull();
    expect(item).toHaveTextContent('Asked you to decide at step 4');
    expect(within(item).getByRole('img', { name: 'Needs a decision' })).toBeInTheDocument();
  });

  it('a job no longer listed says so and has no link', async () => {
    act(() => { useDeskStream.getState().backfill([ev({ session: 'gone', type: 'sessionCompleted', seq: 1, ts: T0 })]); });
    mount([run('a', 'Other')]);
    const item = (await screen.findAllByTestId('desk-stream-item'))[0]!;
    expect(item).toHaveTextContent('A job no longer listed');
    expect(item).toHaveTextContent('Job finished');
    expect(within(item).queryByRole('link')).toBeNull();
  });
});
