import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { makeView } from './factories.js';

/**
 * The /chats landing as a COMMAND SURFACE (lane B, the 0.4.6 treatment).
 * Pinned here: the KPI band under the three operator questions with honest
 * window deltas ("—" when no full prior bucket exists), the partition
 * invariant (the grid is exactly the isChatRun set), needs-you-first
 * ordering + the gate jump, derived titles + seat chips off the wire's own
 * fields, the first-class FilterStrip, and the fetch budget — exactly ONE
 * declared GET /chats on mount, nothing else.
 */

const { ChatsPage, isChatRun } = await import('../src/components/ChatsPage.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useMembershipStore } = await import('../src/store/membership.js');

const NOW = Date.now();

/** 3 chat runs (one gated, one active, one legacy-unstamped done, one failed)
 *  + 2 build runs the partition must exclude. */
const RUNS = [
  makeView({ id: 'c-live', workflow_id: 'chat', status: 'executing', problem: 'talk through the uploader', clis: ['claude', 'codex'] }),
  makeView({ id: 'c-gated', workflow_id: 'chat', status: 'awaiting_human', problem: 'which auth flow?', clis: ['claude'] }),
  makeView({ id: 'c-legacy', workflow_id: undefined as unknown as string, status: 'completed', problem: 'old thread' }),
  makeView({ id: 'c-broken', workflow_id: 'chat', status: 'failed', problem: 'the flaky session' }),
  makeView({ id: 'b-build', workflow_id: 'wf-w2', status: 'executing', problem: 'build the thing' }),
  makeView({ id: 'b-gated', workflow_id: 'wf-w2', status: 'awaiting_human', problem: 'approve the plan?' }),
];

function gate(runId: string, prompt: string, receivedAt: number): void {
  useGateStore.getState().setGate({ runId, ord: 0, prompt, lifecycle: 'open', receivedAt });
}

function page(
  onSelect: (id: string) => void = () => {},
  navigate: (path: string) => void = () => {},
): ReturnType<typeof render> {
  return render(<ChatsPage runs={RUNS} onSelect={onSelect} navigate={navigate} />);
}

beforeEach(() => {
  useGateStore.setState({ gates: {} });
  useMembershipStore.setState({
    projectNameByRun: {},
    projectIdByRun: { 'c-gated': 'p-auth' },
    // c-live placed 2h ago, c-gated 3 days ago; the rest have NO attach clock
    // (unfiled) — the sparkline excludes them honestly, never invents a time.
    attachedAtByRun: { 'c-live': NOW - 2 * 3_600_000, 'c-gated': NOW - 3 * 86_400_000 },
  });
});
afterEach(() => cleanup());

describe('the KPI band — performance / pipeline / risk', () => {
  it('renders the six tiles above the grid with live values', () => {
    page();
    const band = screen.getByTestId('chats-kpis');
    const value = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-value') ?? null;
    expect(value('stat-chats')).toBe('4');       // the windowed chat partition
    expect(value('stat-live-seats')).toBe('0');  // GET /chats unmocked → no live pool
    expect(value('stat-active')).toBe('1');      // c-live moving
    expect(value('stat-gates')).toBe('1');       // c-gated waiting
    expect(value('stat-failed')).toBe('1');      // c-broken
    expect(value('stat-stalled')).toBe('0');
    // The band precedes the grid in DOM order.
    const list = screen.getByTestId('chats-list');
    expect(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('4 chats against a 30-run window has NO prior bucket — the delta reads "—", never 0%', () => {
    page();
    expect(screen.getByTestId('stat-chats').getAttribute('data-delta')).toBe('none');
    expect(within(screen.getByTestId('stat-chats')).getByTestId('stat-delta')).toHaveTextContent('—');
    expect(screen.getByTestId('stat-chats').textContent).toContain('no prior window');
  });

  it('the gates tile scopes to the CHAT partition and doors into the needs-you filter', () => {
    gate('c-gated', 'which auth flow?', NOW - 5 * 60_000);
    gate('b-gated', 'approve the plan?', NOW - 60 * 60_000); // a build gate never counts
    page();
    const tile = screen.getByTestId('stat-gates');
    expect(tile.getAttribute('data-value')).toBe('1');
    expect(tile.textContent).toContain('oldest waiting 5m'); // c-gated's clock, not b-gated's
    fireEvent.click(tile);
    expect(screen.getByTestId('chats-filter').getAttribute('data-filter')).toBe('needs-you');
    expect(screen.getAllByTestId('chat-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['c-gated']);
  });

  it('the failed tile wears the fail token and doors into the failed filter', () => {
    page();
    const failed = screen.getByTestId('stat-failed');
    expect((within(failed).getByTestId('stat-value') as HTMLElement).style.color).toBe('var(--status-fail)');
    fireEvent.click(failed);
    expect(screen.getAllByTestId('chat-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['c-broken']);
  });
});

describe('the grid — the partition invariant, needs-you first, cards are doors', () => {
  it('lists exactly the chat partition — the verbatim isChatRun set', () => {
    page();
    const ids = screen.getAllByTestId('chat-row').map((r) => r.getAttribute('data-run-id'));
    const expected = RUNS.filter(isChatRun).map((v) => v.session.id);
    expect(new Set(ids)).toEqual(new Set(expected));
    for (const v of RUNS) expect(ids.includes(v.session.id)).toBe(isChatRun(v));
  });

  it('needs-you FIRST, then active, then terminal; titles derived, seats chipped off the wire', () => {
    page();
    const rows = screen.getAllByTestId('chat-row');
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(
      ['c-gated', 'c-live', 'c-legacy', 'c-broken'], // gated → active → terminal
    );
    // Derived title on the row; the raw prompt only on the hover title.
    const title = within(rows[0]!).getByTestId('chat-run-title');
    expect(title.textContent).toBe('which auth flow?');
    expect(title.getAttribute('title')).toBe('which auth flow?');
    // Seat chips are the DTO's own clis.
    const seats = within(rows[1]!).getAllByTestId('chat-seat').map((c) => c.getAttribute('data-seat'));
    expect(seats).toEqual(['claude', 'codex']);
  });

  it('a card is a door: clicking it opens the run', () => {
    const onSelect = vi.fn();
    page(onSelect);
    const row = screen.getAllByTestId('chat-row').find((r) => r.getAttribute('data-run-id') === 'c-live')!;
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('c-live');
  });

  it('the needs-you badge jumps STRAIGHT to the gate (project known ⇒ the thread AT the gate)', () => {
    const onSelect = vi.fn();
    const navigate = vi.fn();
    page(onSelect, navigate);
    const jump = screen.getByTestId('chat-needs-you');
    expect(jump.getAttribute('data-run-id')).toBe('c-gated');
    fireEvent.click(jump);
    expect(navigate).toHaveBeenCalledWith('/p/p-auth/build/c-gated#gate');
    expect(onSelect).not.toHaveBeenCalled(); // no card navigation leaked
  });
});

describe('the FilterStrip drives the grid', () => {
  it('status chips narrow the cards; clear-filters restores everything', () => {
    page();
    const chip = (id: string) => screen.getAllByTestId('chats-filter-chip')
      .find((c) => c.getAttribute('data-chip') === id)!;
    fireEvent.click(chip('done'));
    expect(screen.getAllByTestId('chat-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['c-legacy']);
    fireEvent.click(chip('live'));
    expect(screen.queryAllByTestId('chat-row')).toHaveLength(0); // no live pool here
    expect(screen.getByTestId('chats-empty-filter')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chats-clear-filters'));
    expect(screen.getAllByTestId('chat-row')).toHaveLength(4);
  });

  it('search narrows by derived title and seat name', () => {
    page();
    fireEvent.change(screen.getByTestId('chats-filter-search'), { target: { value: 'uploader' } });
    expect(screen.getAllByTestId('chat-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['c-live']);
    fireEvent.change(screen.getByTestId('chats-filter-search'), { target: { value: 'codex' } });
    expect(screen.getAllByTestId('chat-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['c-live']);
  });
});

describe('full width, the creation verb, the empty state', () => {
  it('the grid is a real CSS grid with no maxWidth; New Chat lives on the header', () => {
    const navigate = vi.fn();
    page(() => {}, navigate);
    const grid = screen.getByTestId('chats-list') as HTMLElement;
    expect(grid.style.maxWidth).toBe('');
    expect(grid.style.gridTemplateColumns).toContain('auto-fill');
    fireEvent.click(screen.getByTestId('chats-new'));
    expect(navigate).toHaveBeenCalledWith('/chat/new');
  });

  it('with nothing at all, the empty state carries the New Chat CTA', () => {
    cleanup();
    const navigate = vi.fn();
    render(<ChatsPage runs={[]} onSelect={() => {}} navigate={navigate} />);
    const empty = screen.getByTestId('chats-empty');
    expect(empty).toHaveTextContent('No chat sessions yet');
    fireEvent.click(within(empty).getByText('Click New Chat to start'));
    expect(navigate).toHaveBeenCalledWith('/chat/new');
  });

  it('fires exactly ONE declared request on mount — GET /chats, the §7.9-5 live-session listing', async () => {
    // The band and grid read props + loaded stores; the one named exception is
    // the live-session listing riding the /chats navigation (FINDING-027's
    // zombie-cleanup wire). Nothing else may fire.
    const spy = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', spy);
    page();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const url = String(spy.mock.calls[0]?.[0] ?? '');
    expect(url.endsWith('/api/v1/chats')).toBe(true);
    // An unreachable daemon keeps the live cards absent — the page still renders.
    expect(screen.queryAllByTestId('live-chat-row')).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
