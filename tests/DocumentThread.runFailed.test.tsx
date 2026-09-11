// F-4R2-014 — the crew run-failure line rendered for a human: one sentence, a link to the run
// page (never a quoted GET), a Retry that re-sends the SAME ask, and the raw dump behind a
// collapsed details fold. Plus F-4R2-005's folded narration row and F-4R2-006's bound-run chip.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CoreEvent } from '../src/api/types.js';

const postEvent = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  UNFILED_MOUNT: 'default',
  createDoc: vi.fn(),
  docBinding: () => ({}),
  postFork: vi.fn(),
  postEvent: (...a: unknown[]) => postEvent(...a),
  injectDocMessage: (p: string, d: string, text: string, id: string) =>
    postEvent(p, {
      event_type: 'wicked.interactive.chat.posted',
      payload: { role: 'user', text, document_id: d, source_message_id: id },
    }),
  getVersions: vi.fn(),
  interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjectMembers: async () => ({ members: [] }),
    listRepos: async () => ({ repos: [] }),
    listRuns: async () => ({ runs: [] }),
  },
}));

const { DocumentThread, fmtSpan } = await import('../src/components/DocumentThread.js');
const { threadKey, useDocThreadStore } = await import('../src/store/docThread.js');
const { useRunEventStore } = await import('../src/store/events.js');

const PROJECT = 'proj-abc';
const DOC = 'brochure';
const KEY = threadKey(PROJECT, DOC);
const RUN = '37f020cc-e42c-48aa-b3ec-aa18ec6f9f63';
const ASK = 'Design change only — replace the violet accent with a deep teal.';
const LINE =
  `The crew run answering your ask failed (run ${RUN}). Reason: [wicked-crew] deliverable floor: this phase declared 1 artifact(s). ` +
  `[wicked-crew] EXPECTED: /w5/state/interactive-chats/${DOC}-m-dmsg-7/revised.html [wicked-crew] FOUND: (nothing) ` +
  `[wicked-crew] DELIVERABLE FLOOR FAILED — the run reported done without producing the artifact(s) it was launched to produce. ` +
  `Inspect it via the crew API (GET /api/v1/runs/${RUN}), then resend the message.`;

function status(message: string, state = 'working'): CoreEvent {
  return {
    type: 'interactiveEvent',
    event: { event_type: 'wicked.interactive.status.posted', payload: { project_id: PROJECT, document_id: DOC, state, message } },
  } as unknown as CoreEvent;
}

const navigate = vi.fn();

function mount(): void {
  render(<DocumentThread projectId={PROJECT} docId={DOC} selectedVersion={null} navigate={navigate} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  postEvent.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {}, lastSignalAt: {}, boundRun: {} });
  useRunEventStore.setState({ byRun: {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the run-failed card (F-4R2-014)', () => {
  it('renders the customer sentence, links the run page, folds the raw dump, and Retry re-sends the same ask', async () => {
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'm-1', ASK);
    store.setGenState(KEY, 'generating');
    store.ingest(status(LINE, 'error'));
    mount();

    const card = screen.getByTestId('doc-run-failed');
    expect(card).toHaveAttribute('data-run-id', RUN);
    expect(within(card).getByTestId('doc-run-failed-summary')).toHaveTextContent(
      'The revise step produced no file, so this turn did not land — nothing changed in your document.');
    // The link is a real anchor to the run page — the raw GET is not in the visible copy.
    const link = within(card).getByTestId('doc-run-failed-run');
    expect(link).toHaveAttribute('href', `/runs/${RUN}/timeline`);
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith(`/runs/${RUN}/timeline`);
    const details = within(card).getByTestId('doc-run-failed-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByTestId('doc-run-failed-raw')).toHaveTextContent('/w5/state/interactive-chats');
    // The visible (non-details) copy carries no absolute path and no API URL.
    const visible = Array.from(card.childNodes)
      .filter((n) => !(n instanceof HTMLElement && n.tagName === 'DETAILS'))
      .map((n) => n.textContent).join(' ');
    expect(visible).not.toContain('/w5/state');
    expect(visible).not.toContain('GET /api/v1/runs');

    // Retry — the SAME ask goes out again as a new send on the inject wire.
    const retry = within(card).getByTestId('doc-actionable-retry');
    expect(retry).toHaveAttribute('data-kind', 'resend');
    await act(async () => { fireEvent.click(retry); });
    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(postEvent.mock.calls[0]![1]).toMatchObject({
      event_type: 'wicked.interactive.chat.posted',
      payload: { role: 'user', text: ASK, document_id: DOC },
    });
    const users = useDocThreadStore.getState().messages[KEY]!.filter((m) => m.kind === 'user');
    expect(users).toHaveLength(2);
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'generating');
  });

  it('a restored card with no user line above it offers the link but no Retry (nothing to resend)', () => {
    useDocThreadStore.getState().hydrate(KEY, [{ role: 'agent', text: LINE, ts: 2, state: 'error' }], []);
    mount();
    const card = screen.getByTestId('doc-run-failed');
    expect(within(card).getByTestId('doc-run-failed-run')).toBeInTheDocument();
    expect(within(card).queryByTestId('doc-actionable-retry')).toBeNull();
  });
});

describe('the folded narration row (F-4R2-005)', () => {
  it('seven heartbeats render ONE doc-narration row with a live elapsed counter while generating', () => {
    vi.useFakeTimers({ now: 10_000_000 });
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'm-1', 'a brochure');
    for (let i = 0; i < 7; i += 1) {
      store.ingest(status('Convening a 5-seat council to pick who writes the draft…'));
      vi.advanceTimersByTime(15_000);
    }
    mount();
    const rows = screen.getAllByTestId('doc-narration');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-repeats', '6');
    const elapsed = within(rows[0]!).getByTestId('doc-narration-elapsed');
    expect(elapsed.textContent).toContain('for ');
    const before = elapsed.textContent;
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(within(rows[0]!).getByTestId('doc-narration-elapsed').textContent).not.toBe(before);
  });

  it('fmtSpan reads in words', () => {
    expect(fmtSpan(48_000)).toBe('48s');
    expect(fmtSpan(135_000)).toBe('2m 15s');
    expect(fmtSpan(3_840_000)).toBe('1h 04m');
  });
});

describe('the bound run (F-4R2-006)', () => {
  it('a live bound run keeps the composer generating with an "open run" link, and its lifecycle frame ends it', () => {
    useDocThreadStore.getState().adoptRun(KEY, {
      session: { id: RUN, status: 'executing', extra_write_roots: [] }, units: [],
    } as never);
    mount();
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'generating');
    const chip = screen.getByTestId('steering-chip');
    expect(chip.textContent).toContain('steering the live document run');
    const link = within(chip).getByTestId('doc-bound-run');
    expect(link).toHaveAttribute('href', `/runs/${RUN}/timeline`);
    expect(link).toHaveAttribute('data-run-status', 'executing');

    act(() => {
      useRunEventStore.getState().ingest({ type: 'sessionCompleted', session: RUN } as unknown as CoreEvent);
    });
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'terminal');
    expect(useDocThreadStore.getState().boundRun[KEY]).toEqual({ runId: RUN, status: 'completed' });
  });
});
