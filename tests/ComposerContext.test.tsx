// The composer's context row — DES-MERGE-001 §4.6, §4.9, §2.3, CORRECTED by issue #65.
//
// What is asserted here is the SURFACE half: an attached folder becomes a chip and
// uploads nothing, a learn submission speaks the corrected doc-scoped wire, and a
// refusal from the service reaches the transcript with the service's own words in it.
// The wire half lives in `themeWire.test.ts`. The PICKED-THEME chip is gone with the
// invented library it picked from (no `GET /api/themes`, no `theme_id` — nothing ever
// consumed either).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComposerContext } from '../src/components/ComposerContext.js';
import { DocumentThread } from '../src/components/DocumentThread.js';
import { useDocContextStore } from '../src/store/docContext.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

const PROJECT = 'proj-abc';
const DOC = 'q3-report';
const KEY = threadKey(PROJECT, DOC);

const requestThemeLearn = vi.fn();
const attachSource = vi.fn();
const createDoc = vi.fn();
const postEvent = vi.fn();
const getVersions = vi.fn();
const postFork = vi.fn();

vi.mock('../src/api/interactive.js', async (importOriginal) => {
  // The error classes are real: `learnFix` narrows on `ServiceHintError`, and a stubbed
  // class would make that branch untestable.
  const actual = await importOriginal<typeof import('../src/api/interactive.js')>();
  return {
    ServiceHintError: actual.ServiceHintError,
    BridgeUnavailableError: actual.BridgeUnavailableError,
    requestThemeLearn: (...a: unknown[]) => requestThemeLearn(...a),
    attachSource: (...a: unknown[]) => attachSource(...a),
    createDoc: (...a: unknown[]) => createDoc(...a),
    postEvent: (...a: unknown[]) => postEvent(...a),
    getVersions: (...a: unknown[]) => getVersions(...a),
    postFork: (...a: unknown[]) => postFork(...a),
    injectDocMessage: (p: string, d: string, text: string, id: string) =>
      postEvent(p, {
        event_type: 'wicked.interactive.chat.posted',
        payload: { role: 'user', text, document_id: d, source_message_id: id },
      }),
    interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
  };
});

const navigate = vi.fn();

function mountContext(docId: string | null = DOC): ReturnType<typeof render> {
  return render(<ComposerContext projectId={PROJECT} docId={docId} />);
}

function mountThread(docId: string | null): void {
  render(<DocumentThread projectId={PROJECT} docId={docId} selectedVersion={null} navigate={navigate} />);
}

function thread(key = KEY): DocMsg[] {
  return useDocThreadStore.getState().messages[key] ?? [];
}

function chips(): HTMLElement[] {
  return screen.queryAllByTestId('context-chip');
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {} });
  useDocContextStore.setState({ sources: {} });
  requestThemeLearn.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  attachSource.mockResolvedValue({
    path: '/Users/me/finance/q3', note: '', status: 'indexing',
    added_at: '2026-08-18T10:00:00Z', indexed_at: null,
  });
  createDoc.mockResolvedValue({ name: DOC, head: 1 });
  postEvent.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  getVersions.mockResolvedValue({ head: 3, versions: [] });
  postFork.mockResolvedValue({ version: 4, parent: 3 });
});
afterEach(cleanup);

// ── AC (issue #65): the theme PICK is gone everywhere — there was nothing to pick ──

describe('no theme pick survives anywhere (issue #65)', () => {
  it('offers NO library pill, no "theme library" spelling, and no theme chip', () => {
    const { container } = mountContext();
    expect(screen.queryByTestId('context-library')).toBeNull();
    expect(container.querySelectorAll('[data-testid*="theme-library"]')).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/theme library/i);
    expect(container.querySelectorAll('[data-chip-kind="theme"]')).toHaveLength(0);
  });

  it('with NO document open the row offers nothing — both actions are messages', () => {
    mountContext(null);
    expect(screen.queryByTestId('context-learn')).toBeNull();
    expect(screen.queryByTestId('context-sources')).toBeNull();
    expect(screen.queryByTestId('context-library')).toBeNull();
  });

  it('case 1 — the create body carries NO theme field of any spelling', async () => {
    const user = userEvent.setup();
    mountThread(null);
    await user.type(screen.getByTestId('doc-composer'), 'a deck for the Q3 review');
    await user.click(screen.getByTestId('doc-composer-submit'));
    await waitFor(() => expect(createDoc).toHaveBeenCalled());
    expect(createDoc.mock.calls[0]![1]).not.toHaveProperty('theme_id');
  });

  it('case 2 — a steer carries NO theme field on the injected message', async () => {
    const user = userEvent.setup();
    useDocThreadStore.getState().setGenState(KEY, 'generating');
    mountThread(DOC);
    await user.type(screen.getByTestId('doc-composer'), 'make the headings tighter');
    await user.click(screen.getByTestId('doc-composer-submit'));
    await waitFor(() => expect(postEvent).toHaveBeenCalled());
    const payload = (postEvent.mock.calls[0]![1] as { payload: Record<string, unknown> }).payload;
    expect(payload).not.toHaveProperty('theme_id');
  });
});

// ── AC: sources attach → chip, and NOTHING uploads ──────────────────────────

describe('attaching a reference folder', () => {
  const PATH = '/Users/me/finance/q3';

  it('shows the path as a context chip and submits the PATH, not the files', async () => {
    const user = userEvent.setup();
    mountContext();
    await user.click(screen.getByTestId('context-sources'));
    await user.type(screen.getByTestId('source-input'), PATH);
    await user.click(screen.getByTestId('source-attach'));

    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(chips()[0]).toHaveAttribute('data-chip-kind', 'source');
    expect(chips()[0]).toHaveAttribute('data-chip-value', PATH);
    expect(attachSource).toHaveBeenCalledWith(PROJECT, DOC, PATH);
    // Every argument is a string. Nothing file-shaped is even constructed.
    for (const arg of attachSource.mock.calls[0]!) expect(typeof arg).toBe('string');
  });

  it('offers NO file input anywhere — there is nothing to upload from (§4.9)', async () => {
    const user = userEvent.setup();
    const { container } = mountContext();
    await user.click(screen.getByTestId('context-sources'));
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
    // …and the panel SAYS so, which §4.9 asks of the UI rather than just of the wire.
    expect(screen.getByTestId('source-no-upload')).toHaveTextContent('nothing is uploaded');

    await user.click(screen.getByTestId('context-learn'));
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it('the attach lands in the thread as a message (§2.3)', async () => {
    const user = userEvent.setup();
    mountContext();
    await user.click(screen.getByTestId('context-sources'));
    await user.type(screen.getByTestId('source-input'), PATH);
    await user.click(screen.getByTestId('source-attach'));

    await waitFor(() => expect(thread().length).toBeGreaterThan(0));
    expect(thread()[0]).toMatchObject({ kind: 'user', text: `Use ${PATH} as reference.` });
    expect(thread().some((m) => m.kind === 'narration' && m.text.includes('Nothing is uploaded'))).toBe(true);
  });

  it('a refused attach leaves NO chip — a chip would claim context the generation lacks', async () => {
    attachSource.mockRejectedValue(new Error('API 400: path is outside the project root'));
    const user = userEvent.setup();
    mountContext();
    await user.click(screen.getByTestId('context-sources'));
    await user.type(screen.getByTestId('source-input'), '/etc');
    await user.click(screen.getByTestId('source-attach'));

    await waitFor(() => expect(thread().some((m) => m.kind === 'actionable')).toBe(true));
    expect(chips()).toHaveLength(0);
  });
});

// ── AC: the service's refusal, surfaced verbatim, in the thread ─────────────

describe('learn-a-theme in the thread (the corrected doc-scoped wire, #65)', () => {
  const REASON = 'unknown doc';

  it('renders the SERVICE reason verbatim as an actionable message', async () => {
    requestThemeLearn.mockRejectedValue(new Error(`API 404: ${REASON}`));
    const user = userEvent.setup();
    mountThread(DOC);

    await user.click(screen.getByTestId('context-learn'));
    await user.type(screen.getByTestId('learn-input'), 'http://169.254.169.254/');
    await user.click(screen.getByTestId('learn-submit'));

    const actionable = await screen.findByTestId('doc-actionable');
    expect(actionable).toHaveTextContent(REASON);
    // The SPA submitted to the bridge and nowhere else — the guard is the only thing
    // that ever resolves that address (its refusal narrates async in the thread).
    expect(requestThemeLearn).toHaveBeenCalledWith(
      PROJECT, DOC, { kind: 'url', url: 'http://169.254.169.254/' });
    expect(screen.getByTestId('doc-actionable-hint').textContent?.trim()).not.toBe('');
  });

  it('submits the picked KIND: switching to PDF sends a path, and says nothing uploads', async () => {
    const user = userEvent.setup();
    mountThread(DOC);
    await user.click(screen.getByTestId('context-learn'));
    await user.click(screen.getByTestId('learn-input'));

    const pdf = screen.getAllByTestId('learn-kind').find((b) => b.getAttribute('data-kind') === 'pdf')!;
    await user.click(pdf);
    expect(screen.getByTestId('learn-no-upload')).toHaveTextContent('not uploaded');

    await user.type(screen.getByTestId('learn-input'), '/brand/guide.pdf');
    await user.click(screen.getByTestId('learn-submit'));
    await waitFor(() => expect(requestThemeLearn).toHaveBeenCalled());
    expect(requestThemeLearn).toHaveBeenCalledWith(
      PROJECT, DOC, { kind: 'pdf', path: '/brand/guide.pdf' });
  });

  it('a malformed URL is not submittable, but an address the GUARD owns is', async () => {
    const user = userEvent.setup();
    mountThread(DOC);
    await user.click(screen.getByTestId('context-learn'));
    await user.type(screen.getByTestId('learn-input'), 'stripe.com');
    expect(screen.getByTestId('learn-submit')).toBeDisabled();

    await user.clear(screen.getByTestId('learn-input'));
    await user.type(screen.getByTestId('learn-input'), 'http://169.254.169.254/');
    expect(screen.getByTestId('learn-submit')).toBeEnabled();
  });

  it('the context row is Document mode only — a demo looks like the site it records', () => {
    render(<DocumentThread projectId={PROJECT} docId={DOC} selectedVersion={null}
                           navigate={navigate} mode="video" />);
    expect(screen.queryByTestId('thread-context')).toBeNull();
  });
});
