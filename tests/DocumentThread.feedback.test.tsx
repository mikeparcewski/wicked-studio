// The thread's half of point-and-comment — DES-MERGE-001 §4.3, §7.7, slices 11+12.
//
// The batch lands in the transcript as ONE ordinary user message (§2.3: non-text inputs
// are messages too). What makes it more than text is that each item still knows which
// element it came from — clicking one asks the frame to bring that element back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentThread } from '../src/components/DocumentThread.js';
import { registerWidScroller } from '../src/interactive/widScroller.js';
import { threadKey, useDocThreadStore, type FeedbackItem } from '../src/store/docThread.js';

const postEvent = vi.fn();
const injectDocMessage = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  createDoc: vi.fn(),
  postFork: vi.fn(),
  getVersions: vi.fn(),
  interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
  postEvent: (...a: unknown[]) => postEvent(...a),
  injectDocMessage: (...a: unknown[]) => injectDocMessage(...a),
}));

const PROJECT = 'proj-abc-123';
const DOC = 'q3-report';
const KEY = threadKey(PROJECT, DOC);
const ITEMS: FeedbackItem[] = [
  { wid: 'slide-2-heading-1', text: 'make this title punchier' },
  { wid: 'slide-4-body-2',    text: 'cut this paragraph in half' },
];
const TEXT = 'Feedback on 2 places in this document:\n1. [slide-2-heading-1] …\n2. [slide-4-body-2] …';

function mount(): void {
  render(<DocumentThread projectId={PROJECT} docId={DOC} selectedVersion={3} navigate={vi.fn()} />);
}

beforeEach(() => {
  useDocThreadStore.getState().clear(KEY);
  injectDocMessage.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('DocumentThread — a submitted feedback batch (§4.3)', () => {
  it('renders the batch as ONE message, not one per comment', () => {
    useDocThreadStore.getState().addUserMsg(KEY, 'dm-1', TEXT, ITEMS);
    mount();

    const messages = screen.getAllByTestId('doc-message');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveAttribute('data-items', '2');
  });

  it('AC: each item DEEP-LINKS back to its element through the protocol', async () => {
    const scrolled: string[] = [];
    const unregister = registerWidScroller((wid) => scrolled.push(wid));
    useDocThreadStore.getState().addUserMsg(KEY, 'dm-1', TEXT, ITEMS);
    mount();

    const links = screen.getAllByTestId('feedback-item-link');
    expect(links.map((l) => l.getAttribute('data-wid'))).toEqual(
      ['slide-2-heading-1', 'slide-4-body-2']);

    await userEvent.click(links[1]!);
    expect(scrolled).toEqual(['slide-4-body-2']);
    unregister();
  });

  it('a plain composer message carries no item links', () => {
    useDocThreadStore.getState().addUserMsg(KEY, 'dm-1', 'make the closing slide stronger');
    mount();

    expect(screen.getByTestId('doc-message')).not.toHaveAttribute('data-items');
    expect(screen.queryAllByTestId('feedback-item-link')).toHaveLength(0);
  });
});

describe('DocumentThread — the not-recorded chip (§7.7, §3.3)', () => {
  it('shows a RETRYABLE chip when the inject failed — the batch itself stands', () => {
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'dm-1', TEXT, ITEMS);
    store.markNotRecorded(KEY, 'dm-1', true);
    mount();

    // The message is still there: the document is already regenerating off the bus event.
    expect(screen.getByTestId('doc-message')).toHaveTextContent('Feedback on 2 places');
    expect(screen.getByTestId('feedback-not-recorded')).toHaveTextContent(/retry/i);
  });

  it('the retry re-sends the SAME message id and clears the chip on success', async () => {
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'dm-1', TEXT, ITEMS);
    store.markNotRecorded(KEY, 'dm-1', true);
    mount();

    await userEvent.click(screen.getByTestId('feedback-not-recorded'));

    await waitFor(() => expect(screen.queryByTestId('feedback-not-recorded')).toBeNull());
    expect(injectDocMessage).toHaveBeenCalledWith(PROJECT, DOC, TEXT, 'dm-1');
    // One message throughout — a retry is a retry, never a second message.
    expect(screen.getAllByTestId('doc-message')).toHaveLength(1);
  });

  it('a retry that fails again leaves the chip up', async () => {
    injectDocMessage.mockRejectedValue(new Error('API 500: run not found'));
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'dm-1', TEXT, ITEMS);
    store.markNotRecorded(KEY, 'dm-1', true);
    mount();

    await userEvent.click(screen.getByTestId('feedback-not-recorded'));

    await waitFor(() =>
      expect(screen.getByTestId('feedback-not-recorded')).toHaveTextContent(/retry/i));
    expect(screen.getByTestId('feedback-not-recorded')).toBeEnabled();
  });
});
