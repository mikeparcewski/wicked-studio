// Submitting a point-and-comment batch (DES-MERGE-001 §4.3, §7.7, slices 11+12).
//
// §7.7 is explicit that THE CLIENT AUTHORS BOTH WRITES — no crew bus-listener is
// introduced — and it names their order of importance:
//
//   1. the bus event (`feedback.submitted`, contract unchanged) is what makes the
//      DOCUMENT update, so it goes first and its failure fails the submit;
//   2. the inject is what makes the batch VISIBLE IN THE THREAD as a user message.
//      A failed inject must not block the batch: the document is already regenerating,
//      so the message stays in the transcript wearing a retryable "not recorded" chip.
//
// The batch is ONE message with N targets, never N messages (§4.3): N submits would be
// N runs and N versions for what the user experienced as one round of edits.

import { injectDocMessage, postEvent } from '../api/interactive.js';
import { nextMsgId, threadKey, useDocThreadStore, type FeedbackItem } from '../store/docThread.js';

/** The bus event type interactive's `feedbackStore.js` has always emitted. Unchanged. */
export const FEEDBACK_EVENT = 'wicked.interactive.feedback.submitted';

/**
 * The batch, as the one line of conversation it is. The `[wid]` tag is not decoration:
 * it is the same anchor the item's deep-link resolves through, so the message a human
 * reads and the target the agent edits are provably the same element.
 */
export function composeBatchMessage(items: FeedbackItem[]): string {
  const where = items.length === 1 ? '1 place' : `${items.length} places`;
  return [
    `Feedback on ${where} in this document:`,
    ...items.map((item, i) => `${i + 1}. [${item.wid}] ${item.text}`),
  ].join('\n');
}

export interface SubmitBatchArgs {
  projectId: string;
  docId: string;
  version: number;
  items: FeedbackItem[];
}

export interface SubmitBatchResult {
  /** The thread message the batch landed as — also the version anchor (§7.6). */
  msgId: string;
  text: string;
  /** False when write 2 failed; the message carries the retryable chip instead. */
  recorded: boolean;
}

/** Write 1 then write 2. Throws only when write 1 fails — nothing was submitted then. */
export async function submitFeedbackBatch(
  { projectId, docId, version, items }: SubmitBatchArgs,
): Promise<SubmitBatchResult> {
  const text = composeBatchMessage(items);
  const msgId = nextMsgId();
  const key = threadKey(projectId, docId);

  await postEvent(projectId, {
    event_type: FEEDBACK_EVENT,
    payload: {
      document_id: docId,
      version,
      source_message_id: msgId,
      items: items.map((item) => ({ wid: item.wid, comment: item.text })),
    },
  });

  const store = useDocThreadStore.getState();
  store.addUserMsg(key, msgId, text, items);
  try {
    await injectDocMessage(projectId, docId, text, msgId);
    return { msgId, text, recorded: true };
  } catch {
    store.markNotRecorded(key, msgId, true);
    return { msgId, text, recorded: false };
  }
}

/** The chip's action. Same wire, same message id — a retry, not a second message. */
export async function retryBatchInject(
  projectId: string, docId: string, msgId: string, text: string,
): Promise<void> {
  await injectDocMessage(projectId, docId, text, msgId);
  useDocThreadStore.getState().markNotRecorded(threadKey(projectId, docId), msgId, false);
}
