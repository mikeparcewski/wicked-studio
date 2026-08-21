// The Themes control on the version strip — DES-UXFIX-001 §2.6 rule 4 / V19 (slice 6).
//
// The audit's finding (F9): a "theme library" pill floating unexplained in the composer
// context. What is asserted here is the redesign's contract: the control is named
// "Themes", it EXPLAINS itself in one line the moment it opens, picking still lands in
// the docContext store (so the chip and the `theme_id` wire of slice 16 are untouched),
// and no spelling of "theme library" survives anywhere on the surface.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComposerContext } from '../src/components/ComposerContext.js';
import { ThemesMenu, THEMES_EXPLAINER } from '../src/components/ThemesMenu.js';
import { contextKey, useDocContextStore } from '../src/store/docContext.js';

const PROJECT = 'proj-abc';
const DOC = 'q3-report';
const KEY = contextKey(PROJECT, DOC);

const listThemes = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  listThemes: (...a: unknown[]) => listThemes(...a),
}));

const THEMES = [
  { name: 'stripe-ish', source: 'url' as const, learned_at: '2026-08-18T10:00:00Z' },
  { name: 'corporate', learned_at: undefined },
];

function mount(): ReturnType<typeof render> {
  return render(<ThemesMenu projectId={PROJECT} docId={DOC} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocContextStore.setState({ theme: {}, sources: {} });
  listThemes.mockResolvedValue(THEMES);
});
afterEach(cleanup);

describe('Themes — named, placed, and explained (V19)', () => {
  it('AC: the control reads "Themes" and opening it reveals the ONE-LINE explanation', async () => {
    const user = userEvent.setup();
    mount();

    const open = screen.getByTestId('themes-open');
    expect(open).toHaveTextContent('Themes');
    // Nothing fetched and nothing explained until the user asks (the pill's old sin
    // was the reverse: always on screen, never explained).
    expect(listThemes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('themes-explain')).toBeNull();

    await user.click(open);
    expect(screen.getByTestId('themes-explain')).toHaveTextContent(THEMES_EXPLAINER);
    expect(screen.getByTestId('themes-explain')).toHaveTextContent(
      'Borrow a look from a site, PDF, or image.',
    );
    expect(listThemes).toHaveBeenCalledWith(PROJECT);
  });

  it('AC: NO spelling of "theme library" survives — testid or copy', async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await user.click(screen.getByTestId('themes-open'));
    await screen.findAllByTestId('theme-row');

    expect(container.querySelectorAll('[data-testid*="theme-library"]')).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/theme library/i);
  });

  it('lists the themes and picking one lands in the docContext store (the slice-16 wire)', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));

    const rows = await screen.findAllByTestId('theme-row');
    expect(rows.map((r) => r.getAttribute('data-theme'))).toEqual(['stripe-ish', 'corporate']);

    await user.click(rows[0]!);
    // The pick is context for the NEXT generation — same store, same key, same chip.
    expect(useDocContextStore.getState().theme[KEY]).toBe('stripe-ish');
    // The menu closes and the control now NAMES what is in effect.
    expect(screen.queryByTestId('themes-panel')).toBeNull();
    expect(screen.getByTestId('themes-open')).toHaveTextContent('Themes: stripe-ish');
  });

  it('picking a second theme REPLACES the first — one theme at a time (§4.6)', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));
    await user.click((await screen.findAllByTestId('theme-row'))[0]!);
    await user.click(screen.getByTestId('themes-open'));
    await user.click((await screen.findAllByTestId('theme-row'))[1]!);

    expect(useDocContextStore.getState().theme[KEY]).toBe('corporate');
  });

  it('the pick still renders as the composer chip, and removing the chip clears it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemesMenu projectId={PROJECT} docId={DOC} />
        <ComposerContext projectId={PROJECT} docId={DOC} />
      </>,
    );
    await user.click(screen.getByTestId('themes-open'));
    await user.click((await screen.findAllByTestId('theme-row'))[0]!);

    const chip = await screen.findByTestId('context-chip');
    expect(chip).toHaveAttribute('data-chip-kind', 'theme');
    expect(chip).toHaveAttribute('data-chip-value', 'stripe-ish');

    await user.click(screen.getByTestId('context-chip-remove'));
    await waitFor(() => expect(screen.queryByTestId('context-chip')).toBeNull());
    expect(useDocContextStore.getState().theme[KEY]).toBeUndefined();
  });

  it('a list that cannot be read says so and picks NOTHING (§3.3)', async () => {
    listThemes.mockRejectedValue(new Error('API 503: bridge down'));
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));

    expect(await screen.findByTestId('themes-error')).toHaveTextContent('bridge down');
    expect(screen.getByTestId('themes-error')).toHaveTextContent('no theme was picked');
    expect(useDocContextStore.getState().theme[KEY]).toBeUndefined();
  });

  it('an empty list points at where themes come from, in one line', async () => {
    listThemes.mockResolvedValue([]);
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));

    expect(await screen.findByTestId('themes-empty')).toHaveTextContent(/learn one/i);
  });
});
