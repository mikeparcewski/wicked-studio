import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chordMatches, registerShortcuts, type ShortcutEntry } from '../src/hooks/useGlobalShortcuts.js';

/**
 * The rail's ASK entry (the app-wide ask feature): BELOW Notifications, ABOVE Projects,
 * and its OWN idiom — an accent-dressed action button (`data-idiom="ask"`), not a nav
 * heading row and not a bell sibling. Its chord (Ctrl/⌘+Shift+A) registers in the ONE
 * shortcut registry, so the '?' overlay documents it for free.
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

function rail(onOpenAsk?: () => void): void {
  render(
    <LeftSidebar
      runs={[]}
      navigate={() => undefined}
      pathname="/"
      {...(onOpenAsk !== undefined ? { onOpenAsk } : {})}
    />,
  );
}

beforeEach(() => {
  cleanup();
});

describe('the Ask rail entry — placement + idiom', () => {
  it('sits BELOW the notification bell and ABOVE the Projects heading', () => {
    rail(() => undefined);
    const ask = screen.getByTestId('rail-ask');
    const bell = screen.getByTitle('Notifications'); // the bell trigger
    const projects = screen.getByTestId('rail-heading-projects');
    // DOM order is the rail order: bell → ask → projects.
    expect(bell.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ask.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is its OWN idiom: an accent button, not a heading row and not a bell sibling', () => {
    rail(() => undefined);
    const ask = screen.getByTestId('rail-ask');
    expect(ask.tagName).toBe('BUTTON');
    expect(ask).toHaveAttribute('data-idiom', 'ask');
    // Not a nav heading: no chevron, no aria-expanded, none of the heading testids.
    expect(ask).not.toHaveAttribute('aria-expanded');
    expect(ask.querySelector('[data-testid="rail-chevron"]')).toBeNull();
    // Accent-dressed — visually distinct from the muted nav rows.
    expect(ask.style.border).toContain('var(--accent)');
    // The chord is declared on the control for a11y + at-a-glance discovery.
    expect(ask.getAttribute('aria-keyshortcuts')).toContain('Shift+A');
  });

  it('clicking it fires onOpenAsk', async () => {
    const onOpenAsk = vi.fn();
    rail(onOpenAsk);
    await userEvent.setup().click(screen.getByTestId('rail-ask'));
    expect(onOpenAsk).toHaveBeenCalledTimes(1);
  });

  it('renders NO Ask entry when the app has not wired one (no dead door)', () => {
    rail(undefined);
    expect(screen.queryByTestId('rail-ask')).toBeNull();
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
