import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { SessionView } from '../src/api/types.js';

/**
 * Wave 2a, behaviour 3: P peeks the top gate in place (URL untouched), G jumps to it and
 * remembers where you were, B puts you back — route, scroll, focus, open panel. All three
 * live in the one registry, so the '?' overlay lists them.
 */

vi.mock('../src/api/client.js', () => ({
  api: { getRunEvents: vi.fn().mockResolvedValue({ events: [] }) },
}));

const { usePeekJump } = await import('../src/hooks/usePeekJump.js');
const { usePlacePanel } = await import('../src/hooks/usePlacePanel.js');
const { PeekCard } = await import('../src/components/PeekCard.js');
const { listShortcuts } = await import('../src/hooks/useGlobalShortcuts.js');
const { overlayRows } = await import('../src/components/ShortcutOverlay.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useLayerStore } = await import('../src/store/layers.js');
const { useMembershipStore } = await import('../src/store/membership.js');
const { useReturnPlace } = await import('../src/store/place.js');

const run = (id: string, status: string): SessionView =>
  ({ session: { id, status, problem: `problem ${id}`, archived_at: null }, units: [] }) as unknown as SessionView;

const RUNS = [run('r1', 'executing'), run('b1', 'awaiting_human')];

function Harness({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  const view = usePeekJump(RUNS, navigate);
  const [panel, setPanel] = useState(false);
  usePlacePanel('test.panel', panel, setPanel);
  return (
    <div>
      <button type="button" data-testid="focus-me">focus me</button>
      <button type="button" data-testid="toggle-panel" onClick={() => setPanel((v) => !v)}>
        {panel ? 'panel open' : 'panel closed'}
      </button>
      <div data-testid="feed" data-place-scroll="feed" style={{ overflowY: 'auto', height: 100 }} />
      <PeekCard view={view} />
    </div>
  );
}

const press = (key: string): void => {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
};

beforeEach(() => {
  window.history.replaceState(null, '', '/p/gamma/build/r1');
  useLayerStore.setState({ peekOpen: false, shortcutOverlayOpen: false, bellOpen: false, modalIds: [] });
  useReturnPlace.setState({ place: null });
  useGateStore.setState({
    gates: { b1: { runId: 'b1', ord: 3, prompt: 'Approve unit 3?', lifecycle: 'open', receivedAt: 1_000 } },
  });
  useMembershipStore.setState({ projectIdByRun: { r1: 'gamma', b1: 'beta' }, attachedAtByRun: {} });
});

describe('peek', () => {
  it('P shows the top gate in place and leaves the URL alone; P again closes', () => {
    const navigate = vi.fn();
    render(<Harness navigate={navigate} />);
    press('p');
    const card = screen.getByTestId('peek-card');
    expect(card.getAttribute('data-run-id')).toBe('b1');
    expect(screen.getByTestId('peek-prompt').textContent).toBe('Approve unit 3?');
    expect(window.location.pathname).toBe('/p/gamma/build/r1');
    expect(navigate).not.toHaveBeenCalled();
    press('p');
    expect(screen.queryByTestId('peek-card')).toBeNull();
  });

  it('Escape closes the peek card', () => {
    render(<Harness navigate={vi.fn()} />);
    press('p');
    press('Escape');
    expect(screen.queryByTestId('peek-card')).toBeNull();
  });
});

describe('jump and back', () => {
  it('G goes to the gate; B navigates back and restores focus, scroll, and the open panel', async () => {
    const navigate = vi.fn((path: string) => window.history.pushState(null, '', path));
    render(<Harness navigate={navigate} />);
    const feed = screen.getByTestId('feed');
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, value: 100 });
    feed.scrollTop = 420;
    act(() => { screen.getByTestId('toggle-panel').click(); });
    screen.getByTestId('focus-me').focus();

    press('g');
    expect(navigate).toHaveBeenLastCalledWith('/p/beta/build/b1#gate');
    expect(useReturnPlace.getState().place).toMatchObject({
      href: '/p/gamma/build/r1', scroll: { feed: 420 }, focus: '[data-testid="focus-me"]',
      panels: { 'test.panel': true },
    });

    // The jumped-to route disturbs everything.
    feed.scrollTop = 0;
    act(() => { screen.getByTestId('toggle-panel').click(); });
    (document.activeElement as HTMLElement | null)?.blur();

    press('b');
    expect(navigate).toHaveBeenLastCalledWith('/p/gamma/build/r1');
    await vi.waitFor(() => {
      expect(feed.scrollTop).toBe(420);
      expect(document.activeElement).toBe(screen.getByTestId('focus-me'));
      expect(screen.getByTestId('toggle-panel').textContent).toBe('panel open');
    });
    expect(useReturnPlace.getState().place).toBeNull();
  });

  it('B yields when there is nowhere to go back to', () => {
    const navigate = vi.fn();
    useGateStore.setState({ gates: {} });
    render(<Harness navigate={navigate} />);
    press('b');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('the ? overlay', () => {
  it('lists peek, jump and back under their own section', () => {
    render(<Harness navigate={vi.fn()} />);
    const groups = overlayRows(listShortcuts());
    const nav = groups.find((g) => g.group === 'navigate');
    expect(nav?.rows.map((r) => [r.keys.join(','), r.description])).toEqual([
      ['P', 'Peek at the top item that needs you (the URL stays put)'],
      ['G', 'Jump to the top item that needs you'],
      ['B', 'Back to exactly where you were before the jump'],
      ['Esc', 'Close the peek card'],
    ]);
  });
});

describe('round 3', () => {
  it('P, G and B stand down while a modal or the ? overlay owns the keyboard', () => {
    const navigate = vi.fn();
    render(<Harness navigate={navigate} />);
    useLayerStore.setState({ modalIds: [7] });
    press('p');
    expect(screen.queryByTestId('peek-card')).toBeNull();
    press('g');
    expect(navigate).not.toHaveBeenCalled();
    useLayerStore.setState({ modalIds: [], shortcutOverlayOpen: true });
    press('p');
    expect(screen.queryByTestId('peek-card')).toBeNull();
  });

  it('a gate with a queued decision is not peeked again', async () => {
    const { decideGate } = await import('../src/board/gateActions.js');
    render(<Harness navigate={vi.fn()} />);
    act(() => { void decideGate('b1', { approve: true }); });
    press('p');
    expect(screen.getByTestId('peek-empty')).toBeTruthy();
  });

  it('B after chained jumps returns to the FIRST origin', () => {
    const navigate = vi.fn((path: string) => window.history.pushState(null, '', path));
    render(<Harness navigate={navigate} />);
    press('g'); // r1 → b1's gate
    expect(window.location.pathname).toBe('/p/beta/build/b1');
    // the thread consumes #gate; the operator wanders, then jumps again
    window.history.pushState(null, '', '/p/alpha/chat');
    press('g');
    expect(window.location.pathname).toBe('/p/beta/build/b1');
    press('b');
    expect(navigate).toHaveBeenLastCalledWith('/p/gamma/build/r1');
  });
});

