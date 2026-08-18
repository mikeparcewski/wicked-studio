// Batch → ONE message, and §7.7's two writes — DES-MERGE-001 §4.3, §7.7, slices 11+12.
//
// The load-bearing claim of this file is a COUNT: N comments produce exactly one thread
// message and exactly one bus event. Sending each comment separately would produce N
// regenerations and N versions for what the user experienced as one round of edits (§4.3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_EVENT, composeBatchMessage, retryBatchInject, submitFeedbackBatch,
} from '../src/interactive/feedbackBatch.js';
import { threadKey, useDocThreadStore, type FeedbackItem } from '../src/store/docThread.js';

const postEvent = vi.fn();
const injectDocMessage = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
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

function messages() {
  return useDocThreadStore.getState().messages[KEY] ?? [];
}

beforeEach(() => {
  useDocThreadStore.getState().clear(KEY);
  postEvent.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  injectDocMessage.mockResolvedValue({ ok: true, event_id: 'e2', correlation_id: 'c1' });
});
afterEach(() => { vi.clearAllMocks(); });

describe('composeBatchMessage — N targets, one line of conversation', () => {
  it('names every item and tags each with the wid its deep-link resolves through', () => {
    const text = composeBatchMessage(ITEMS);
    expect(text).toBe([
      'Feedback on 2 places in this document:',
      '1. [slide-2-heading-1] make this title punchier',
      '2. [slide-4-body-2] cut this paragraph in half',
    ].join('\n'));
  });

  it('reads correctly for a single comment — no "1 places"', () => {
    expect(composeBatchMessage([ITEMS[0]!])).toContain('Feedback on 1 place in this document:');
  });
});

describe('submitFeedbackBatch — §7.7: the client authors BOTH writes', () => {
  it('AC: two comments submit as ONE thread message containing BOTH items', async () => {
    await submitFeedbackBatch({ projectId: PROJECT, docId: DOC, version: 3, items: ITEMS });

    const user = messages().filter((m) => m.kind === 'user');
    expect(user).toHaveLength(1);
    expect(user[0]!.text).toContain('make this title punchier');
    expect(user[0]!.text).toContain('cut this paragraph in half');
    // The items ride ON the message, which is what makes each one deep-linkable (§4.3).
    expect(user[0]!.kind === 'user' && user[0]!.items).toEqual(ITEMS);
  });

  it('write 1 is the bus event, carrying the version and every target', async () => {
    await submitFeedbackBatch({ projectId: PROJECT, docId: DOC, version: 3, items: ITEMS });

    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(postEvent).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      event_type: FEEDBACK_EVENT,
      payload: expect.objectContaining({
        document_id: DOC,
        version: 3,
        items: [
          { wid: 'slide-2-heading-1', comment: 'make this title punchier' },
          { wid: 'slide-4-body-2',    comment: 'cut this paragraph in half' },
        ],
      }),
    }));
  });

  it('write 2 is ONE inject carrying the same text and the message id as anchor', async () => {
    const { msgId, text } = await submitFeedbackBatch({
      projectId: PROJECT, docId: DOC, version: 3, items: ITEMS,
    });

    expect(injectDocMessage).toHaveBeenCalledTimes(1);
    expect(injectDocMessage).toHaveBeenCalledWith(PROJECT, DOC, text, msgId);
    // §7.6: the same id is the pending version anchor, so the version this feedback
    // produces tags the message that asked for it.
    expect(useDocThreadStore.getState().anchor[KEY]).toBe(msgId);
  });

  it('a batch of one is still one message and one event', async () => {
    await submitFeedbackBatch({ projectId: PROJECT, docId: DOC, version: 1, items: [ITEMS[0]!] });
    expect(messages().filter((m) => m.kind === 'user')).toHaveLength(1);
    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(injectDocMessage).toHaveBeenCalledTimes(1);
  });
});

describe('submitFeedbackBatch — failures (§7.7, §3.3)', () => {
  it('AC: a failed inject does NOT block the batch — the message stays, chip-flagged', async () => {
    injectDocMessage.mockRejectedValue(new Error('API 500: run not found'));

    const result = await submitFeedbackBatch({
      projectId: PROJECT, docId: DOC, version: 3, items: ITEMS,
    });

    // It did not throw: the document is already regenerating off the bus event.
    expect(result.recorded).toBe(false);
    expect(postEvent).toHaveBeenCalledTimes(1);
    const user = messages().find((m) => m.kind === 'user');
    expect(user?.kind === 'user' && user.notRecorded).toBe(true);
    expect(user?.text).toContain('make this title punchier');
  });

  it('a failed BUS EVENT throws and writes nothing — nothing was submitted', async () => {
    postEvent.mockRejectedValue(new Error('API 503: bridge_unavailable'));

    await expect(submitFeedbackBatch({
      projectId: PROJECT, docId: DOC, version: 3, items: ITEMS,
    })).rejects.toThrow(/503/);

    expect(messages()).toHaveLength(0);
    expect(injectDocMessage).not.toHaveBeenCalled();
  });

  it('the chip is RETRYABLE — the same message id, not a second message', async () => {
    injectDocMessage.mockRejectedValueOnce(new Error('API 500: run not found'));
    const { msgId, text } = await submitFeedbackBatch({
      projectId: PROJECT, docId: DOC, version: 3, items: ITEMS,
    });

    await retryBatchInject(PROJECT, DOC, msgId, text);

    expect(injectDocMessage).toHaveBeenCalledTimes(2);
    expect(injectDocMessage).toHaveBeenLastCalledWith(PROJECT, DOC, text, msgId);
    expect(messages().filter((m) => m.kind === 'user')).toHaveLength(1);
    const user = messages().find((m) => m.kind === 'user');
    expect(user?.kind === 'user' && user.notRecorded).toBe(false);
  });

  it('a retry that fails again leaves the chip up rather than clearing it', async () => {
    injectDocMessage.mockRejectedValue(new Error('API 500: still gone'));
    const { msgId, text } = await submitFeedbackBatch({
      projectId: PROJECT, docId: DOC, version: 3, items: ITEMS,
    });

    await expect(retryBatchInject(PROJECT, DOC, msgId, text)).rejects.toThrow(/still gone/);

    const user = messages().find((m) => m.kind === 'user');
    expect(user?.kind === 'user' && user.notRecorded).toBe(true);
  });
});
