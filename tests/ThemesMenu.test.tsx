// The Themes control on the version strip — DES-UXFIX-001 §2.6 rule 4 / V19,
// CORRECTED by issue #65.
//
// What is asserted here is the honest contract: the control is named "Themes", it
// EXPLAINS itself in one line the moment it opens, and the popover offers the ONE
// capability the real bridge has — learn a look for THIS document, which then sticks
// server-side. There is no list and no picking, because the "theme library" those
// implied was an invented wire (`GET /api/themes` never existed on the bridge); a
// mock of that route here would be the bug reproduced, so the mock below speaks the
// corrected themeWire seam and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemesMenu, THEMES_EXPLAINER, THEMES_STICKS } from '../src/components/ThemesMenu.js';

const PROJECT = 'proj-abc';
const DOC = 'q3-report';

const learnThemeFromThread = vi.fn();

vi.mock('../src/interactive/themeWire.js', async (importOriginal) => {
  // The pure helpers (learnReady, LEARN_KINDS, LEARN_LABEL) are the real ones — only
  // the submission seam is stubbed, at the CORRECTED wire's module boundary.
  const real = await importOriginal<typeof import('../src/interactive/themeWire.js')>();
  return { ...real, learnThemeFromThread: (...a: unknown[]) => learnThemeFromThread(...a) };
});

function mount(): ReturnType<typeof render> {
  return render(<ThemesMenu projectId={PROJECT} docId={DOC} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  learnThemeFromThread.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('Themes — named, placed, and explained (V19), speaking the real capability (#65)', () => {
  it('AC: the control reads "Themes" and opening it reveals the ONE-LINE explanation', async () => {
    const user = userEvent.setup();
    mount();

    const open = screen.getByTestId('themes-open');
    expect(open).toHaveTextContent('Themes');
    // Nothing explained until the user asks (the old pill's sin was the reverse:
    // always on screen, never explained).
    expect(screen.queryByTestId('themes-explanation')).toBeNull();

    await user.click(open);
    expect(screen.getByTestId('themes-explanation')).toHaveTextContent(THEMES_EXPLAINER);
    expect(screen.getByTestId('themes-explanation')).toHaveTextContent(
      'Borrow a look from a site, PDF, or image.',
    );
  });

  it('AC: NO spelling of "theme library" survives — testid or copy — and no list is offered', async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await user.click(screen.getByTestId('themes-open'));

    expect(container.querySelectorAll('[data-testid*="theme-library"]')).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/theme library/i);
    // The invented library's rows are gone with the wire that fed them.
    expect(container.querySelectorAll('[data-testid="theme-row"]')).toHaveLength(0);
  });

  it('AC: the popover SAYS the real model — the learned look sticks to this document', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));
    expect(screen.getByTestId('themes-sticks')).toHaveTextContent(THEMES_STICKS);
    expect(screen.getByTestId('themes-sticks')).toHaveTextContent(/sticks to this document/i);
  });

  it('submitting a URL learns it FOR THIS DOCUMENT through the corrected seam', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));
    await user.type(screen.getByTestId('themes-input'), 'https://acme.example/brand');
    await user.click(screen.getByTestId('themes-submit'));

    expect(learnThemeFromThread).toHaveBeenCalledWith({
      projectId: PROJECT, docId: DOC, kind: 'url', value: 'https://acme.example/brand',
    });
    // A queued learn closes the popover — the outcome already narrates in the thread.
    expect(screen.queryByTestId('themes-panel')).toBeNull();
  });

  it('the local kinds submit a PATH and say the no-upload guarantee in the UI', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));
    await user.click(screen.getByText('pdf'));

    expect(screen.getByTestId('themes-no-upload')).toHaveTextContent(/not uploaded/i);
    await user.type(screen.getByTestId('themes-input'), '/brand/guide.pdf');
    await user.click(screen.getByTestId('themes-submit'));
    expect(learnThemeFromThread).toHaveBeenCalledWith({
      projectId: PROJECT, docId: DOC, kind: 'pdf', value: '/brand/guide.pdf',
    });
  });

  it('an unsubmittable source never fires the wire — readiness is the same shape check', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));
    await user.type(screen.getByTestId('themes-input'), 'stripe.com'); // no scheme
    expect(screen.getByTestId('themes-submit')).toBeDisabled();
    expect(learnThemeFromThread).not.toHaveBeenCalled();
  });

  it('a refused learn keeps the popover open — the thread carries the reason', async () => {
    learnThemeFromThread.mockResolvedValue({ ok: false, reason: 'unknown doc' });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId('themes-open'));
    await user.type(screen.getByTestId('themes-input'), 'https://acme.example');
    await user.click(screen.getByTestId('themes-submit'));

    expect(screen.getByTestId('themes-panel')).toBeInTheDocument();
    // The value survives so the user can correct rather than retype.
    expect(screen.getByTestId('themes-input')).toHaveValue('https://acme.example');
  });
});
