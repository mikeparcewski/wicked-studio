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
  resetToastLedger,
  TOAST_DWELL_MS,
} from '../src/components/GateNotifications.js';
import { useGateStore } from '../src/store/gates.js';
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

describe('GateNotifications — dismiss (§7.1)', () => {
  it('every card contains a toast-dismiss, and dismissing hides the card but never the gate', async () => {
    seed(gate('r-one'), gate('r-two'));
    render(<GateNotifications onSelect={() => {}} />);

    const cards = screen.getAllByTestId('gate-notification');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.querySelector('[data-testid="toast-dismiss"]')).not.toBeNull();
    }

    const first = cards[0]!;
    await userEvent.click(first.querySelector('[data-testid="toast-dismiss"]')!);

    expect(screen.getAllByTestId('gate-notification')).toHaveLength(1);
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
  it('the layer reserves no pointer surface; only cards accept clicks; the stack is capped', () => {
    seed(gate('r-1'), gate('r-2'), gate('r-3'), gate('r-4'), gate('r-5'));
    render(<GateNotifications onSelect={() => {}} />);

    const layer = screen.getByTestId('gate-notification-layer');
    expect(layer.style.pointerEvents).toBe('none');

    const cards = screen.getAllByTestId('gate-notification');
    expect(cards).toHaveLength(MAX_TOAST_CARDS);
    for (const card of cards) expect(card.style.pointerEvents).toBe('auto');

    const overflow = screen.getByTestId('gate-toast-overflow');
    expect(overflow.textContent).toContain(`+${5 - MAX_TOAST_CARDS} more waiting`);
    expect(overflow.style.pointerEvents).toBe('none');
  });
});

describe('GateNotifications — cross-project context (B4)', () => {
  it('inside a project shell, a KNOWN-foreign gate paints no card; own + unplaceable gates do', () => {
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
    expect(shown.sort()).toEqual(['r-mine', 'r-unknown']);
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
