import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chordMatches, registerShortcuts, type ShortcutEntry } from '../src/hooks/useGlobalShortcuts.js';

/**
 * The ASK entry (studio#323 R1): it LEFT the rail chrome — the `?` circle beside the
 * logo is gone — and is a floating chat bubble fixed bottom-right (AskLauncher), the
 * traditional help/chat-launcher position. The bubble toggles the Ask dock, which
 * floats as a panel anchored to it (an overlay, not a layout column). It clears the
 * runs bottom bar and, when a run is selected, the right panel. Its chord
 * (Ctrl/⌘+Shift+A) registers in the ONE shortcut registry, so the '?' overlay
 * documents it for free.
 */

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null }),
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.2.0', ping: 'pong' }),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
}));

const { LeftSidebar } = await import('../src/components/LeftSidebar.js');
const { AskLauncher } = await import('../src/components/AskLauncher.js');

function rail(): void {
  render(<LeftSidebar runs={[]} navigate={() => undefined} pathname="/" />);
}

beforeEach(() => {
  cleanup();
});

describe('the Ask entry — out of the rail chrome (studio#323 R1)', () => {
  it('the rail carries NO Ask entry, expanded or collapsed', async () => {
    rail();
    expect(screen.queryByTestId('rail-ask')).toBeNull();
    expect(screen.queryByTestId('ask-launcher')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByTestId('rail-ask')).toBeNull();
  });
});

describe('the Ask launcher — a floating chat bubble bottom-right (studio#323 R1)', () => {
  it('is fixed to the bottom-right corner, above the 28px runs bar', () => {
    render(<AskLauncher open={false} onToggle={() => undefined} />);
    const bubble = screen.getByTestId('ask-launcher');
    expect(bubble.style.position).toBe('fixed');
    expect(bubble.style.right).toBe('16px');
    expect(bubble.style.bottom).toBe('44px'); // 28px runs bar + 16px gutter
    expect(bubble.style.left).toBe('');
    expect(bubble.style.top).toBe('');
    expect(bubble.style.borderRadius).toBe('var(--radius-full)');
  });

  it('is a chat glyph, not a "?" — and keeps its own idiom + chord', () => {
    render(<AskLauncher open={false} onToggle={() => undefined} />);
    const bubble = screen.getByTestId('ask-launcher');
    expect(bubble.tagName).toBe('BUTTON');
    expect(bubble).toHaveAttribute('data-idiom', 'ask');
    expect(bubble).not.toHaveTextContent('?');
    expect(bubble.querySelector('svg')).not.toBeNull();
    expect(bubble.getAttribute('aria-keyshortcuts')).toContain('Shift+A');
    expect(bubble).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays clear of the right panel: shifts left by the offset App passes', () => {
    render(<AskLauncher open={false} onToggle={() => undefined} rightOffsetPx={288} />);
    expect(screen.getByTestId('ask-launcher').style.right).toBe('304px');
  });

  it('narrow viewport + right panel: the open panel stays fully on screen (left edge >= 0)', () => {
    const prev = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    try {
      render(<AskLauncher open onToggle={() => undefined} rightOffsetPx={288}><div /></AskLauncher>);
      const panel = screen.getByTestId('ask-panel');
      const bubble = screen.getByTestId('ask-launcher');
      const px = (v: string): number => Number(v.replace(/px$/, ''));
      const panelLeft = 375 - px(panel.style.right) - px(panel.style.width);
      expect(panelLeft).toBeGreaterThanOrEqual(0);
      expect(px(panel.style.right)).toBeGreaterThanOrEqual(0);
      // The bubble is on screen too.
      expect(375 - px(bubble.style.right) - 48).toBeGreaterThanOrEqual(0);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: prev });
    }
  });

  it('clicking it fires onToggle', async () => {
    const onToggle = vi.fn();
    render(<AskLauncher open={false} onToggle={onToggle} />);
    await userEvent.setup().click(screen.getByTestId('ask-launcher'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('closed: no panel; open: the dock floats in a fixed panel anchored ABOVE the bubble', () => {
    const { rerender } = render(
      <AskLauncher open={false} onToggle={() => undefined}><div data-testid="dock-child" /></AskLauncher>,
    );
    expect(screen.queryByTestId('ask-panel')).toBeNull();
    expect(screen.queryByTestId('dock-child')).toBeNull();

    rerender(<AskLauncher open onToggle={() => undefined}><div data-testid="dock-child" /></AskLauncher>);
    const panel = screen.getByTestId('ask-panel');
    expect(panel.style.position).toBe('fixed');
    expect(panel.style.right).toBe('16px');
    expect(panel.style.bottom).toBe('104px'); // bubble bottom 44 + 48 bubble + 12 gap
    expect(panel).toContainElement(screen.getByTestId('dock-child'));
    expect(screen.getByTestId('ask-launcher')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the Ask chord — Ctrl/⌘+Shift+A through the one registry', () => {
  it('matches exactly Ctrl/⌘+Shift+A and toggles through the registered handler', () => {
    let open = false;
    const entry: ShortcutEntry = {
      id: 'ask-dock',
      chord: { key: 'a', ctrlOrMeta: true, shift: true },
      group: 'panels',
      description: 'Ask — governed answers about your projects, repos, and this studio',
      handler: () => {
        open = !open;
      },
    };
    const unregister = registerShortcuts([entry]);
    try {
      // The exact chord (macOS reports 'A' with shift down — chordMatches lowercases).
      const hit = new KeyboardEvent('keydown', { key: 'A', metaKey: true, shiftKey: true });
      expect(chordMatches(hit, entry.chord)).toBe(true);
      window.dispatchEvent(hit);
      expect(open).toBe(true);
      // Near-misses stay inert: no shift, and a bare 'a'.
      expect(chordMatches(new KeyboardEvent('keydown', { key: 'a', metaKey: true }), entry.chord)).toBe(false);
      expect(chordMatches(new KeyboardEvent('keydown', { key: 'a' }), entry.chord)).toBe(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true }));
      expect(open).toBe(true);
    } finally {
      unregister();
    }
  });
});
