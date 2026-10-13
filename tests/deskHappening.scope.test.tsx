import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { getRunEvents: (...a: unknown[]) => events(...a) }, apiBase: () => 'http://x/api/v1' }));

import { DeskHappening, resetHappeningBackfill } from '../src/components/desk/DeskHappening.js';
import { resetDeskStream, useDeskStream } from '../src/store/deskStream.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';

/** codex r1: a project's page shows only its runs' events, and a failed backfill is never "quiet". */
const run = (id: string): SessionView => ({ session: { id, status: 'running', created_at: 1_700_000_000, problem: id }, units: [] } as unknown as SessionView);
const frame = (session: string, n: number): CoreEvent => ({ type: 'unitDone', session, ord: n, ts: Date.now() + n } as unknown as CoreEvent);

function mount(runs: SessionView[], scope: ReadonlySet<string> | null = null): void {
  render(<DeskHappening runs={runs} runsShown navigate={() => {}} now={Date.now()} title={(v) => v.session.id} pathOf={(id) => `/s/${id}`} agentName={(c) => c} scope={scope} />);
}

describe('Happening now: scope and failed reads', () => {
  beforeEach(() => { resetDeskStream(); resetHappeningBackfill(); events.mockReset(); });
  afterEach(() => { cleanup(); });

  it('on a project page lists only that project’s runs', async () => {
    events.mockResolvedValue({ events: [] });
    act(() => { useDeskStream.getState().ingest(frame('mine', 1)); useDeskStream.getState().ingest(frame('theirs', 2)); });
    mount([run('mine')], new Set(['mine']));
    await waitFor(() => expect(screen.getByTestId('desk-stream')).toBeInTheDocument());
    expect(screen.getByTestId('desk-stream').textContent).toContain('mine');
    expect(screen.getByTestId('desk-stream').textContent).not.toContain('theirs');
  });

  it('says it could not read, never quiet, when every backfill read fails, and Retry reads again', async () => {
    events.mockRejectedValue(new Error('500'));
    mount([run('a'), run('b')]);
    await waitFor(() => expect(screen.getByTestId('desk-stream-unread')).toBeInTheDocument());
    expect(screen.queryByTestId('desk-stream-quiet')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-stream-state')).toHaveTextContent('not read');
    const before = events.mock.calls.length;
    events.mockResolvedValue({ events: [] });
    fireEvent.click(screen.getByTestId('desk-stream-retry'));
    await waitFor(() => expect(events.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId('desk-stream-quiet')).toBeInTheDocument());
  });

  it('names a partial failure in the header', async () => {
    events.mockImplementation(async (id: string) => { if (id === 'b') throw new Error('500'); return { events: [] }; });
    mount([run('a'), run('b')]);
    await waitFor(() => expect(screen.getByTestId('desk-stream-state')).toHaveTextContent('1 of 2 jobs not read'));
  });

  it('a second scope (another project) backfills its own runs after the Desk did', async () => {
    events.mockResolvedValue({ events: [] });
    const { unmount } = render(<DeskHappening runs={[run('a')]} runsShown navigate={() => {}} now={Date.now()} title={(v) => v.session.id} pathOf={(id) => `/s/${id}`} agentName={(c) => c} />);
    await waitFor(() => expect(events).toHaveBeenCalledWith('a', expect.any(Array)));
    unmount();
    render(<DeskHappening runs={[run('p1-run')]} runsShown navigate={() => {}} now={Date.now()} title={(v) => v.session.id} pathOf={(id) => `/s/${id}`} agentName={(c) => c} scope={new Set(['p1-run'])} scopeKey="p1" />);
    await waitFor(() => expect(events).toHaveBeenCalledWith('p1-run', expect.any(Array)));
  });

  it('keeps the failure when the run list updates while the read is in flight', async () => {
    let fail: (e: unknown) => void = () => undefined;
    events.mockImplementation(() => new Promise((_r, rej) => { fail = rej; }));
    const props = { runsShown: true, navigate: () => {}, now: Date.now(), title: (v: SessionView) => v.session.id, pathOf: (id: string) => `/s/${id}`, agentName: (c: string) => c };
    const { rerender } = render(<DeskHappening runs={[run('a')]} {...props} />);
    await waitFor(() => expect(events).toHaveBeenCalledTimes(1));
    rerender(<DeskHappening runs={[run('a'), run('b')]} {...props} />);
    await act(async () => { fail(new Error('500')); });
    await waitFor(() => expect(screen.getByTestId('desk-stream-unread')).toBeInTheDocument());
    expect(events).toHaveBeenCalledTimes(1);
  });
});
