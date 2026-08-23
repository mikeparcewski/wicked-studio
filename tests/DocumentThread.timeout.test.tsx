// DES-UX-001 §6.1 honesty budget (the J3 re-review pin): the "generating — this
// message is being worked now" chip may spin only while the thread is actually
// hearing from the service. `GENERATING_SILENCE_BUDGET_MS` of silence flips it
// to a visible timeout state — honest copy + a working retry — never an eternal
// claim of work (the reproduced 28-minute pill with zero backend signal).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocumentThread, GENERATING_TIMEOUT_COPY } from '../src/components/DocumentThread.js';
import {
  GENERATING_SILENCE_BUDGET_MS, threadKey, useDocThreadStore,
} from '../src/store/docThread.js';
import type { CoreEvent } from '../src/api/types.js';

const PROJECT = 'proj-abc';
const DOC = 'launch-deck';
const KEY = threadKey(PROJECT, DOC);

const postEvent = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
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

function statusFrame(message: string): CoreEvent {
  return {
    type: 'interactiveEvent',
    event: {
      event_type: 'wicked.interactive.status.posted',
      payload: { project_id: PROJECT, document_id: DOC, state: 'working', message },
    },
  } as unknown as CoreEvent;
}

function versionFrame(version: number): CoreEvent {
  return {
    type: 'interactiveEvent',
    event: {
      event_type: 'wicked.interactive.version.created',
      payload: { project_id: PROJECT, document_id: DOC, version, parent: null, kind: 'generated' },
    },
  } as unknown as CoreEvent;
}

/** One in-flight send, exactly as the composer leaves it. */
function armSend(id = 'm-1'): void {
  const store = useDocThreadStore.getState();
  store.addUserMsg(KEY, id, 'a deck for the Q3 review');
  store.setGenState(KEY, 'generating');
}

function mount(): void {
  render(
    <DocumentThread projectId={PROJECT} docId={DOC} selectedVersion={null} navigate={vi.fn()} />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useDocThreadStore.setState({
    messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {}, lastSignalAt: {},
  });
  postEvent.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the generating chip has a bounded honesty budget', () => {
  it('keeps "being worked now" inside the budget, then flips to the visible timeout with retry', () => {
    armSend();
    mount();
    expect(screen.getByTestId('thread-generating')).toBeInTheDocument();
    expect(screen.getByTestId('steering-chip')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(GENERATING_SILENCE_BUDGET_MS - 1000); });
    expect(screen.getByTestId('thread-generating')).toBeInTheDocument();
    expect(screen.queryByTestId('thread-generating-timeout')).toBeNull();

    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByTestId('thread-generating')).toBeNull();
    const timeout = screen.getByTestId('thread-generating-timeout');
    expect(timeout).toHaveTextContent(GENERATING_TIMEOUT_COPY);
    expect(screen.getByTestId('thread-generating-retry')).toBeInTheDocument();
    // The composer's own chip stops claiming a live run too — one page, one truth.
    expect(screen.queryByTestId('steering-chip')).toBeNull();
    expect(screen.getByTestId('steering-stalled')).toBeInTheDocument();
  });

  it('re-arms the budget on ANY interactive signal for the thread', () => {
    armSend();
    mount();
    act(() => { vi.advanceTimersByTime(60_000); });
    act(() => { useDocThreadStore.getState().ingest(statusFrame('Planning the deck outline.')); });
    // 60s later the total silence-since-send exceeds the budget, but the signal
    // reset the clock — still honestly "being worked".
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId('thread-generating')).toBeInTheDocument();
    // …and a full budget of silence AFTER the last signal still times out.
    act(() => { vi.advanceTimersByTime(GENERATING_SILENCE_BUDGET_MS); });
    expect(screen.getByTestId('thread-generating-timeout')).toBeInTheDocument();
  });

  it('retry re-emits the send on the inject wire and restores the working claim', async () => {
    armSend('m-9');
    mount();
    act(() => { vi.advanceTimersByTime(GENERATING_SILENCE_BUDGET_MS + 1000); });
    expect(screen.getByTestId('thread-generating-timeout')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('thread-generating-retry'));
    await act(async () => { await Promise.resolve(); });
    expect(postEvent).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      event_type: 'wicked.interactive.chat.posted',
      payload: expect.objectContaining({ source_message_id: 'm-9' }),
    }));
    // The retry restarted the send's own clock: the chip claims work again…
    expect(screen.getByTestId('thread-generating')).toBeInTheDocument();
    expect(screen.queryByTestId('thread-generating-timeout')).toBeNull();
    // …and only for one more budget of silence.
    act(() => { vi.advanceTimersByTime(GENERATING_SILENCE_BUDGET_MS + 1000); });
    expect(screen.getByTestId('thread-generating-timeout')).toBeInTheDocument();
  });

  it('a landed version retires the timeout state entirely', () => {
    armSend();
    mount();
    act(() => { vi.advanceTimersByTime(GENERATING_SILENCE_BUDGET_MS + 1000); });
    expect(screen.getByTestId('thread-generating-timeout')).toBeInTheDocument();

    act(() => { useDocThreadStore.getState().ingest(versionFrame(1)); });
    expect(screen.queryByTestId('thread-generating-timeout')).toBeNull();
    expect(screen.queryByTestId('thread-generating')).toBeNull();
    expect(screen.getByTestId('version-marker')).toHaveAttribute('data-version', '1');
  });
});
