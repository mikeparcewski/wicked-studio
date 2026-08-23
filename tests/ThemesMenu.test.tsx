// The Themes control on the version strip — DES-UXFIX-001 §2.6 rule 4 / V19,
// CORRECTED by issue #65, grown the DES-UX-001 §7.2 lifecycle (B5, EC37).
//
// What is asserted here is the honest contract: the control is named "Themes", it
// EXPLAINS itself in one line the moment it opens, and the popover offers the ONE
// capability the real bridge has — learn a look for THIS document, which then sticks
// server-side. §7.2 adds the point-of-action answers: an in-flight state while the
// bridge works, the bridge's own error sentence VERBATIM when a learn fails (the
// probe-4 truth: one doc-scoped status.posted {state:"error"}), and a bounded
// timeout with honest retry copy — never an unresolved "Grabbing…" past it.
//
// The submission seam (themeWire), the readback (getLearnedTheme) and the bounded
// poll (learnPoll) are stubbed at their module boundaries; the poll's own schedule
// arithmetic is pinned in learnPoll.test.ts — here the claim is what the POPOVER
// says for each outcome, plus the exact deps the component wires into the poll
// (the stale-readback guard and the error-identity watch).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LEARN_DONE_COPY, LEARN_TIMEOUT_COPY, ThemesMenu, THEMES_EXPLAINER, THEMES_STICKS,
} from '../src/components/ThemesMenu.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';
import type { LearnPollDeps, LearnPollOutcome } from '../src/theming/learnPoll.js';

const PROJECT = 'proj-abc';
const DOC = 'q3-report';
const KEY = threadKey(PROJECT, DOC);

const learnThemeFromThread = vi.fn();
const getLearnedTheme = vi.fn();
const pollLearnedTheme = vi.fn();

vi.mock('../src/interactive/themeWire.js', async (importOriginal) => {
  // The pure helpers (learnReady, LEARN_KINDS, LEARN_LABEL) are the real ones — only
  // the submission seam is stubbed, at the CORRECTED wire's module boundary.
  const real = await importOriginal<typeof import('../src/interactive/themeWire.js')>();
  return { ...real, learnThemeFromThread: (...a: unknown[]) => learnThemeFromThread(...a) };
});
vi.mock('../src/api/interactive.js', () => ({
  getLearnedTheme: (...a: unknown[]) => getLearnedTheme(...a),
  // themeWire (loaded REAL below) names these at import time; none fire here —
  // the submission seam itself is stubbed.
  requestThemeLearn: vi.fn(),
  attachSource: vi.fn(),
  ServiceHintError: class extends Error {},
}));
vi.mock('../src/theming/learnPoll.js', () => ({
  pollLearnedTheme: (...a: unknown[]) => pollLearnedTheme(...a),
}));

function mount(): ReturnType<typeof render> {
  return render(<ThemesMenu projectId={PROJECT} docId={DOC} />);
}

/** Open the popover, type a URL, submit — the shared gesture under every outcome. */
async function submitUrl(user: ReturnType<typeof userEvent.setup>, url = 'https://acme.example/brand'): Promise<void> {
  await user.click(screen.getByTestId('themes-open'));
  await user.type(screen.getByTestId('themes-input'), url);
  await user.click(screen.getByTestId('themes-submit'));
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {}, lastError: {} });
  learnThemeFromThread.mockResolvedValue({ ok: true });
  getLearnedTheme.mockResolvedValue(null); // no previous learn on this doc
  pollLearnedTheme.mockResolvedValue({ kind: 'learned', result: { document_id: DOC, learned_at: 'T2', tokens: {} } });
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
    await submitUrl(user);

    expect(learnThemeFromThread).toHaveBeenCalledWith({
      projectId: PROJECT, docId: DOC, kind: 'url', value: 'https://acme.example/brand',
    });
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
});

describe('the §7.2 lifecycle (B5, EC37): the popover answers where the click was', () => {
  it('AC: a submitted learn renders learn-inflight IN THE POPOVER — no silent close', async () => {
    let release: (v: LearnPollOutcome) => void = () => {};
    pollLearnedTheme.mockImplementation(() => new Promise((res) => { release = res; }));
    const user = userEvent.setup();
    mount();
    await submitUrl(user);

    // The popover STAYS, wearing the in-flight state (the old close-on-ack was
    // exactly the brief's act-and-nothing-happens).
    expect(screen.getByTestId('themes-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('learn-inflight')).toBeInTheDocument();
    expect(screen.getByTestId('themes-submit')).toBeDisabled();

    // Staged progress = the bridge's own newest status line, folded by the thread.
    act(() => { useDocThreadStore.getState().addNarration(KEY, 'Grabbing the page to read its design…'); });
    expect(screen.getByTestId('learn-stage')).toHaveTextContent('Grabbing the page');

    act(() => { release({ kind: 'learned', result: { document_id: DOC, learned_at: 'T2', tokens: {} } }); });
    await screen.findByTestId('learn-done');
  });

  it('AC: the readback landing resolves to learn-done with the sticks promise', async () => {
    const user = userEvent.setup();
    mount();
    await submitUrl(user);

    const done = await screen.findByTestId('learn-done');
    expect(done).toHaveTextContent(LEARN_DONE_COPY);
    // The source cleared — the ask completed; the popover is ready for the next one.
    expect(screen.getByTestId('themes-input')).toHaveValue('');
  });

  it('AC: a failed learn renders the bridge\'s OWN sentence verbatim, with a retry (probe 4)', async () => {
    pollLearnedTheme.mockResolvedValue({
      kind: 'bridge-error',
      reason: "Couldn't grab that URL: refusing to fetch 169.254.169.254: loopback, private and link-local addresses are blocked (SSRF guard)",
    });
    const user = userEvent.setup();
    mount();
    await submitUrl(user);

    const error = await screen.findByTestId('learn-error');
    expect(error).toHaveTextContent('SSRF guard'); // the guard's words, not a paraphrase
    expect(screen.getByTestId('learn-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('learn-timeout')).toBeNull(); // a REPORTED failure is not a timeout
  });

  it('AC: fixture-simulated silence resolves to learn-timeout with the honest retry copy', async () => {
    pollLearnedTheme.mockResolvedValue({ kind: 'timeout', attempts: 16, lastFetchError: null });
    const user = userEvent.setup();
    mount();
    await submitUrl(user);

    const timeout = await screen.findByTestId('learn-timeout');
    expect(timeout).toHaveTextContent(LEARN_TIMEOUT_COPY);
    expect(timeout).toHaveTextContent(/may still be working/);

    // Retry re-fires the SAME ask — the value survived the failure.
    learnThemeFromThread.mockClear();
    pollLearnedTheme.mockResolvedValue({ kind: 'learned', result: { document_id: DOC, learned_at: 'T3', tokens: {} } });
    await user.click(screen.getByTestId('learn-retry'));
    expect(learnThemeFromThread).toHaveBeenCalledWith({
      projectId: PROJECT, docId: DOC, kind: 'url', value: 'https://acme.example/brand',
    });
    await screen.findByTestId('learn-done');
  });

  it('a SYNC refusal (unknown doc, 403, 503) keeps the popover open with the reason and retry', async () => {
    learnThemeFromThread.mockResolvedValue({ ok: false, reason: 'unknown doc' });
    const user = userEvent.setup();
    mount();
    await submitUrl(user, 'https://acme.example');

    expect(await screen.findByTestId('learn-error')).toHaveTextContent('unknown doc');
    expect(screen.getByTestId('themes-panel')).toBeInTheDocument();
    // The value survives so the user can correct rather than retype.
    expect(screen.getByTestId('themes-input')).toHaveValue('https://acme.example');
    expect(pollLearnedTheme).not.toHaveBeenCalled(); // nothing was queued — nothing to watch
  });

  it('wires the poll honestly: the stale-readback guard and the error-identity watch', async () => {
    // A PREVIOUS learn already answers the readback (learned_at T1): the baseline.
    getLearnedTheme.mockResolvedValue({ document_id: DOC, learned_at: 'T1', tokens: {} });
    let deps: LearnPollDeps | null = null;
    pollLearnedTheme.mockImplementation((d: LearnPollDeps) => {
      deps = d;
      return new Promise(() => {}); // hold the poll open — the deps are the claim
    });
    const user = userEvent.setup();
    mount();
    await submitUrl(user);
    await waitFor(() => expect(deps).not.toBeNull());
    const d = deps as unknown as LearnPollDeps;

    // Stale readback: the SAME learned_at is NOT this learn landing.
    await expect(d.fetchLearned()).resolves.toBeNull();
    // A moved learned_at IS.
    getLearnedTheme.mockResolvedValue({ document_id: DOC, learned_at: 'T2', tokens: {} });
    await expect(d.fetchLearned()).resolves.toMatchObject({ learned_at: 'T2' });

    // Error identity: only an error that ARRIVED after the snapshot ends the learn.
    expect(d.bridgeError?.()).toBeNull();
    act(() => {
      useDocThreadStore.setState((s) => ({
        lastError: { ...s.lastError, [KEY]: { text: "Couldn't grab that URL: boom" } },
      }));
    });
    expect(d.bridgeError?.()).toBe("Couldn't grab that URL: boom");
  });
});
