import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeView } from './factories.js';

/**
 * The /chats dashboard (DES-FEEDBACK-003 §4.3, slice P): the page's derived
 * numbers promoted into the tile band, above the untouched list. Pinned here:
 * the three §4.3 tiles with their named questions (EC19/EC28), the partition
 * invariant (the list is exactly the isChatRun set), the attach-clock honesty
 * of the chats-over-time tile, gate scoping to the chat partition, the
 * preserved search/time-range/list affordances, and the zero-requests-on-
 * mount discipline (the page reads props + loaded stores only).
 */

const { ChatsPage, isChatRun } = await import('../src/components/ChatsPage.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useMembershipStore } = await import('../src/store/membership.js');

const NOW = Date.now();

/** 3 chat runs (one active, one legacy-unstamped, one done) + 2 build runs. */
const RUNS = [
  makeView({ id: 'c-live', workflow_id: 'chat', status: 'executing', problem: 'talk through the uploader' }),
  makeView({ id: 'c-gated', workflow_id: 'chat', status: 'awaiting_human', problem: 'which auth flow?' }),
  makeView({ id: 'c-legacy', workflow_id: undefined as unknown as string, status: 'completed', problem: 'old thread' }),
  makeView({ id: 'b-build', workflow_id: 'wf-w2', status: 'executing', problem: 'build the thing' }),
  makeView({ id: 'b-gated', workflow_id: 'wf-w2', status: 'awaiting_human', problem: 'approve the plan?' }),
];

function gate(runId: string, prompt: string, receivedAt: number): void {
  useGateStore.getState().setGate({ runId, ord: 0, prompt, lifecycle: 'open', receivedAt });
}

function page(onSelect: (id: string) => void = () => {}): ReturnType<typeof render> {
  return render(<ChatsPage runs={RUNS} onSelect={onSelect} navigate={() => {}} />);
}

beforeEach(() => {
  useGateStore.setState({ gates: {} });
  useMembershipStore.setState({
    projectNameByRun: {},
    // c-live placed 2h ago, c-gated 3 days ago; c-legacy has NO attach clock
    // (unfiled) — the tile must exclude it honestly, never invent a time.
    attachedAtByRun: { 'c-live': NOW - 2 * 3_600_000, 'c-gated': NOW - 3 * 86_400_000 },
  });
});
afterEach(() => cleanup());

describe('the tile band (§4.3, EC19/EC28)', () => {
  it('renders the three tiles with their named questions, above the untouched list', () => {
    page();
    const band = screen.getByTestId('chats-dashboard-tiles');
    const q = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-question') ?? null;
    expect(q('chats-over-time-tile')).toBe('Is conversation increasing or drying up?');
    expect(q('chats-active-tile')).toBe('How many threads are warm?');
    expect(q('chats-gates-tile')).toBe('Did a conversation stall on me?');
    const list = screen.getByTestId('chats-list');
    expect(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('buckets chats on the attach clock and reports the clockless honestly', () => {
    page();
    const tile = screen.getByTestId('chats-over-time-tile');
    // c-live + c-gated placed; c-legacy has no clock → unplaced, not painted.
    expect(tile.getAttribute('data-total')).toBe('2');
    expect(tile.getAttribute('data-unplaced')).toBe('1');
  });

  it('counts warm threads off the existing active derivation', () => {
    page();
    const tile = screen.getByTestId('chats-active-tile');
    expect(tile.getAttribute('data-count')).toBe('2'); // c-live + c-gated
  });

  it('scopes the gates tile to the chat partition — a build gate never counts', () => {
    gate('c-gated', 'which auth flow?', NOW - 5 * 60_000);
    gate('b-gated', 'approve the plan?', NOW - 60 * 60_000);
    page();
    const tile = screen.getByTestId('chats-gates-tile');
    expect(tile.getAttribute('data-count')).toBe('1');
    expect(tile.textContent).toContain('1 waiting');
    expect(tile.textContent).toContain('oldest 5m');
    expect(tile.textContent).toContain('which auth flow?');
    expect(tile.textContent).not.toContain('approve the plan?');
  });

  it('says "none waiting" honestly when no chat gate is open', () => {
    gate('b-gated', 'approve the plan?', NOW - 60_000);
    page();
    expect(screen.getByTestId('chats-gates-tile').textContent).toContain('none waiting');
  });
});

describe('the register below (§4.3: "the list below is the existing ChatsPage list, untouched")', () => {
  it('lists exactly the chat partition — the verbatim isChatRun set', () => {
    page();
    const ids = screen.getAllByTestId('chat-row').map((r) => r.getAttribute('data-run-id'));
    const expected = RUNS.filter(isChatRun).map((v) => v.session.id);
    expect(new Set(ids)).toEqual(new Set(expected));
    for (const v of RUNS) expect(ids.includes(v.session.id)).toBe(isChatRun(v));
  });

  it('preserves search, the time-range selector, New Chat, and row navigation', () => {
    const onSelect = vi.fn();
    page(onSelect);
    expect(screen.getByPlaceholderText('Search chats…')).toBeInTheDocument();
    expect(screen.getByText('New Chat')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Time range' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search chats…'), { target: { value: 'auth' } });
    const rows = screen.getAllByTestId('chat-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-run-id')).toBe('c-gated');
    fireEvent.click(rows[0]!);
    expect(onSelect).toHaveBeenCalledWith('c-gated');
  });

  it('fires exactly ONE declared request on mount — GET /chats, the §7.9-5 live-session listing (re-scoped by DES-UX-001 slice AB)', async () => {
    // Pre-slice-AB this page read props + loaded stores only. Slice AB adds the
    // ONE named exception (the §3.3-style declared fetch): the live-session
    // listing rides the /chats navigation so warm seats are findable (the
    // zombie-cleanup wire, FINDING-027's GET /chats). Nothing else may fire.
    const spy = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', spy);
    page();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const url = String(spy.mock.calls[0]?.[0] ?? '');
    expect(url.endsWith('/api/v1/chats')).toBe(true);
    // An unreachable daemon keeps the band absent — the page still renders.
    expect(screen.queryByTestId('live-chats')).toBeNull();
    vi.unstubAllGlobals();
  });
});
