// Slice AA (DES-UX-001 §7.1, EC38, B4): the toast LIFECYCLE — dismiss, expiry,
// layout safety, and the cross-project context rule. The gate experience itself
// is §0-protected: every case here asserts the gate RECORD survives whatever
// happens to its announcement.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import {
  GateNotifications,
  MAX_TOAST_CARDS,
  leadCardOrder,
  resetToastLedger,
  TOAST_DWELL_MS,
} from '../src/components/GateNotifications.js';
import { beginGateRead, useGateStore } from '../src/store/gates.js';
import type { OpenGate } from '../src/store/gates.js';
import { useMembershipStore } from '../src/store/membership.js';
import { makeView } from './factories.js';

function gate(runId: string, over: Partial<OpenGate> = {}): OpenGate {
  return { runId, ord: 0, prompt: `gate for ${runId}`, lifecycle: 'open', receivedAt: Date.now(), ...over };
}

function seed(...gates: OpenGate[]): void {
  useGateStore.setState({
    gates: Object.fromEntries(gates.map((g) => [g.runId, g])),
  });
}

beforeEach(() => {
  resetToastLedger();
  useGateStore.setState({ gates: {} });
  useMembershipStore.setState({ projectIdByRun: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The pre-slice-AA scope contract (studio#10) — carried forward verbatim: the
// runId prop still means "only this run's toast".
describe('GateNotifications runId scope (studio#10)', () => {
  it('announces every gate when no runId is provided: one card, the rest as "+N" (UI-CONTRACT §3)', () => {
    seed(gate('run-1'), gate('run-2'));
    render(<GateNotifications onSelect={() => {}} />);
    expect(screen.getAllByTestId('gate-toast')).toHaveLength(1);
    expect(screen.getByTestId('gate-toast-overflow').textContent).toContain('+1 more waiting');
  });

  it('shows only the matching gate when runId is provided', () => {
    seed(gate('run-1'), gate('run-2'));
    render(<GateNotifications onSelect={() => {}} runId="run-1" />);
    const toasts = screen.getAllByTestId('gate-toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toHaveAttribute('data-run-id', 'run-1');
  });

  it('shows nothing when runId matches no gate', () => {
    seed(gate('run-1'), gate('run-2'));
    render(<GateNotifications onSelect={() => {}} runId="run-99" />);
    expect(screen.queryByTestId('gate-toast')).toBeNull();
  });

  it('shows nothing when store is empty', () => {
    render(<GateNotifications onSelect={() => {}} runId="run-1" />);
    expect(screen.queryByTestId('gate-notification')).toBeNull();
  });
});

describe('GateNotifications — dismiss (§7.1)', () => {
  it('every card contains a toast-dismiss, and dismissing hides the card but never the gate', async () => {
    seed(gate('r-one'), gate('r-two'));
    render(<GateNotifications onSelect={() => {}} />);

    const cards = screen.getAllByTestId('gate-notification');
    expect(cards).toHaveLength(1);
    const first = cards[0]!;
    expect(first.querySelector('[data-testid="toast-dismiss"]')).not.toBeNull();
    const firstRun = first.getAttribute('data-run-id');

    await userEvent.click(first.querySelector('[data-testid="toast-dismiss"]')!);

    // The next announcement takes the one card; the overflow line is gone.
    const next = screen.getAllByTestId('gate-notification');
    expect(next).toHaveLength(1);
    expect(next[0]!.getAttribute('data-run-id')).not.toBe(firstRun);
    expect(next[0]!.querySelector('[data-testid="toast-dismiss"]')).not.toBeNull();
    expect(screen.queryByTestId('gate-toast-overflow')).toBeNull();
    // §9: the toast lifecycle changes, never the gate — the record survives.
    expect(Object.keys(useGateStore.getState().gates)).toHaveLength(2);
  });

  it('a dismissed announcement stays dismissed across a remount (route change)', async () => {
    seed(gate('r-one'));
    const { unmount } = render(<GateNotifications onSelect={() => {}} />);
    await userEvent.click(screen.getByTestId('toast-dismiss'));
    unmount();

    render(<GateNotifications onSelect={() => {}} />);
    expect(screen.queryByTestId('gate-notification')).toBeNull();
  });

  it('a NEW arrival for the same run (new receivedAt) re-announces', async () => {
    const t0 = Date.now();
    seed(gate('r-one', { receivedAt: t0 }));
    render(<GateNotifications onSelect={() => {}} />);
    await userEvent.click(screen.getByTestId('toast-dismiss'));
    expect(screen.queryByTestId('gate-notification')).toBeNull();

    act(() => {
      useGateStore.getState().setGate(gate('r-one', { receivedAt: t0 + 1 }));
    });
    expect(screen.getByTestId('gate-notification')).toBeInTheDocument();
  });
});

describe('GateNotifications — expiry (§7.1)', () => {
  it('a toast self-expires after the bounded dwell; the gate record survives', () => {
    vi.useFakeTimers();
    seed(gate('r-one'));
    render(<GateNotifications onSelect={() => {}} />);
    expect(screen.getByTestId('gate-notification')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TOAST_DWELL_MS + 100);
    });
    expect(screen.queryByTestId('gate-notification')).toBeNull();
    expect(useGateStore.getState().gates['r-one']).toBeDefined();
  });

  it('the dwell clock is first-PAINT, not the wire receivedAt: a stale cached gate still announces', () => {
    vi.useFakeTimers();
    // A daemon-cached gate received 12 minutes ago (the reconcile path parses
    // the daemon's own clock) must still get its full dwell on this page.
    seed(gate('r-old', { receivedAt: Date.now() - 12 * 60_000 }));
    render(<GateNotifications onSelect={() => {}} />);
    expect(screen.getByTestId('gate-notification')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TOAST_DWELL_MS - 1_000);
    });
    expect(screen.getByTestId('gate-notification')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.queryByTestId('gate-notification')).toBeNull();
  });
});

describe('GateNotifications — layout safety (EC38)', () => {
  it('only cards accept clicks; the stack is capped', () => {
    seed(gate('r-1'), gate('r-2'), gate('r-3'), gate('r-4'), gate('r-5'));
    render(<GateNotifications onSelect={() => {}} />);

    // studio#722: the layer is an in-flow strip now — it covers nothing, so it needs no pass-through.
    expect(screen.getByTestId('gate-notification-layer')).toBeInTheDocument();

    const cards = screen.getAllByTestId('gate-notification');
    expect(cards).toHaveLength(MAX_TOAST_CARDS);
    for (const card of cards) expect(card.style.pointerEvents).toBe('auto');

    const overflow = screen.getByTestId('gate-toast-overflow');
    expect(overflow.textContent).toContain(`+${5 - MAX_TOAST_CARDS} more waiting`);
    expect(overflow.style.pointerEvents).toBe('none');
  });
});

describe('GateNotifications — cross-project context (B4)', () => {
  it('inside a project shell, a KNOWN-foreign gate paints no card; own + unplaceable gates do', async () => {
    seed(gate('r-mine'), gate('r-foreign'), gate('r-unknown'));
    render(
      <GateNotifications
        onSelect={() => {}}
        projectId="proj-a"
        runs={[
          makeView({ id: 'r-mine', status: 'awaiting_human', project_id: 'proj-a' }),
          makeView({ id: 'r-foreign', status: 'awaiting_human', project_id: 'proj-b' }),
          // r-unknown: pre-0.8.0 DTO (no project_id claim), no mirror row —
          // suppression requires KNOWING the gate is foreign, never assuming.
          makeView({ id: 'r-unknown', status: 'awaiting_human' }),
        ]}
      />,
    );
    const shown = screen.getAllByTestId('gate-notification').map((c) => c.getAttribute('data-run-id'));
    expect(shown).toHaveLength(1);
    expect(['r-mine', 'r-unknown']).toContain(shown[0]);
    // The foreign gate is not even counted in the "+N" line: 2 announced, 1 painted.
    expect(screen.getByTestId('gate-toast-overflow').textContent).toContain('+1 more waiting');
    // Dismissing it paints the OTHER permitted gate, never the foreign one.
    await userEvent.click(screen.getByTestId('toast-dismiss'));
    const next = screen.getAllByTestId('gate-notification').map((c) => c.getAttribute('data-run-id'));
    expect(next).toHaveLength(1);
    expect(['r-mine', 'r-unknown'].filter((x) => x !== shown[0])).toEqual(next);
    expect(screen.queryByTestId('gate-toast-overflow')).toBeNull();
  });

  it('falls back to the membership mirror when the DTO makes no claim', () => {
    seed(gate('r-legacy'));
    useMembershipStore.setState({ projectIdByRun: { 'r-legacy': 'proj-b' } });
    render(
      <GateNotifications
        onSelect={() => {}}
        projectId="proj-a"
        runs={[makeView({ id: 'r-legacy', status: 'awaiting_human' })]}
      />,
    );
    expect(screen.queryByTestId('gate-notification')).toBeNull();
  });

  it('the run-scoped view keeps its own gate card even inside a project shell', () => {
    seed(gate('r-mine'));
    render(
      <GateNotifications
        onSelect={() => {}}
        runId="r-mine"
        projectId="proj-a"
        runs={[makeView({ id: 'r-mine', status: 'awaiting_human', project_id: 'proj-a' })]}
      />,
    );
    expect(screen.getByTestId('gate-notification')).toBeInTheDocument();
  });
});

describe('studio#722: the announcement never covers content', () => {
  it('renders in the page flow (a strip above the page), never a fixed overlay', () => {
    seed(gate('run-1'), gate('run-2'));
    render(<GateNotifications onSelect={() => {}} />);
    const layer = screen.getByTestId('gate-notification-layer');
    expect(layer.className).toContain('wk-gate-strip');
    expect(layer.className).not.toMatch(/\bfixed\b/);
    expect(layer.getAttribute('style') ?? '').not.toMatch(/position|bottom/);
  });
});

// F31: the late-join gate reads run newest first and in parallel, so the store's insertion order no longer says
// which gate a page load leads with. A page load leads with the oldest waiting run, as on main; a gate that arrives
// live queues behind the card on screen, as on main, whatever its run's age or clock.
describe('GateNotifications lead card (F31)', () => {
  const T = 1_700_000_000_000;
  const read = (runId: string, over: Partial<OpenGate> = {}): OpenGate => gate(runId, { fromRead: true, ...over });
  const runs = [
    makeView({ id: 'run-new', status: 'awaiting_human', created_at: 2_000 } as never),
    makeView({ id: 'run-old', status: 'awaiting_human', created_at: 1_000 } as never),
  ];
  const lead = (): string | null => screen.getAllByTestId('gate-notification')[0]!.getAttribute('data-run-id');

  it('a page load leads with the oldest waiting run, whatever order the reads landed in and whenever each gate opened', () => {
    // The newer run's read landed first, and its gate opened EARLIER than the older run's.
    seed(read('run-new', { receivedAt: T }), read('run-old', { receivedAt: T + 60_000 }), read('run-unlisted', { receivedAt: T - 1 }));
    render(<GateNotifications onSelect={() => {}} runs={runs} />);
    expect(screen.getAllByTestId('gate-notification')).toHaveLength(1);
    expect(lead()).toBe('run-old');
  });

  it('a gate that arrives live for an OLDER run queues behind the card on screen: same clock tick or a skewed one', () => {
    for (const liveAt of [T, T - 5_000]) {
      cleanup();
      resetToastLedger();
      vi.useFakeTimers({ now: T });
      seed(read('run-new', { receivedAt: T }));
      const { rerender } = render(<GateNotifications onSelect={() => {}} runs={runs} />);
      expect(lead()).toBe('run-new');
      vi.setSystemTime(liveAt); // the browser's clock at the live frame: equal to, or behind, crew's
      act(() => {
        useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'run-old', ord: 1, prompt: 'gate for run-old' } as never);
      });
      rerender(<GateNotifications onSelect={() => {}} runs={runs} />);
      expect(screen.getAllByTestId('gate-notification')).toHaveLength(1);
      expect(lead(), `live at ${liveAt - T}`).toBe('run-new');
      vi.useRealTimers();
    }
  });

  it('a live frame for the gate a read put there (same ord) keeps its place; a refresh never promotes a live gate', async () => {
    // Read: run-old leads, run-new waits in "+1".
    useGateStore.getState().applyGateRead(beginGateRead('run-new'), gate('run-new', { ord: 2, receivedAt: T }));
    useGateStore.getState().applyGateRead(beginGateRead('run-old'), gate('run-old', { ord: 2, receivedAt: T }));
    const { rerender } = render(<GateNotifications onSelect={() => {}} runs={runs} />);
    expect(lead()).toBe('run-old');
    // The same gate arrives live (a replayed frame): it stays the lead.
    act(() => { useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'run-old', ord: 2, prompt: 'gate for run-old' } as never); });
    rerender(<GateNotifications onSelect={() => {}} runs={runs} />);
    expect(lead()).toBe('run-old');
    expect(useGateStore.getState().gates['run-old']).toMatchObject({ fromRead: true });
    // A live gate queued behind a read lead is re-read (a refresh after a 409): it stays live, behind.
    act(() => { useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'run-live', ord: 1, prompt: 'gate for run-live' } as never); });
    act(() => { useGateStore.getState().applyGateRead(beginGateRead('run-live'), gate('run-live', { ord: 1, receivedAt: T })); });
    expect(useGateStore.getState().gates['run-live']?.fromRead).toBeUndefined();
    expect(leadCardOrder(Object.values(useGateStore.getState().gates), runs).map((g) => g.runId)).toStrictEqual(['run-old', 'run-new', 'run-live']);
  });

  it('leadCardOrder: read gates by run age (unlisted after, ties in store order), then live gates in store order', () => {
    const order = leadCardOrder(
      [gate('live-1'), read('c'), read('x'), gate('live-0', { receivedAt: 0 }), read('a'), read('b'), read('y')],
      [makeView({ id: 'a', created_at: 1 } as never), makeView({ id: 'b', created_at: 1 } as never), makeView({ id: 'c', created_at: 3 } as never),
        makeView({ id: 'live-0', created_at: 0 } as never)],
    ).map((g) => g.runId);
    expect(order).toStrictEqual(['a', 'b', 'c', 'x', 'y', 'live-1', 'live-0']);
  });
});
