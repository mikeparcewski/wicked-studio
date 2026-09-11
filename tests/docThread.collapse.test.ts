// F-4R2-005 + F-4R2-014 at the store seam.
//
// Crew's seams re-emit the CURRENT narration on a ≤15 s heartbeat — the phase4-r2 draft thread
// carried 39 narration rows for one draft ("Crew phase 2/3: writing the draft (draft)…" ×16).
// A repeat of the NEWEST narration folds into it (one row, a repeat count, a span); a line
// that differs is a new row; the same words after something else happened are a new phase.
// And the crew run-failure line becomes the actionable `run-failed` kind, live and restored.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationEntry } from '../src/api/interactive.js';
import type { CoreEvent } from '../src/api/types.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

const PROJECT = 'proj-abc';
const DOC = 'brochure';
const KEY = threadKey(PROJECT, DOC);
const RUN = 'bb28ad5a-febb-411f-b8db-aed1dee8e515';

function status(message: string, state = 'working'): CoreEvent {
  return {
    type: 'interactiveEvent',
    event: { event_type: 'wicked.interactive.status.posted', payload: { project_id: PROJECT, document_id: DOC, state, message } },
  } as unknown as CoreEvent;
}

const ingest = (e: CoreEvent): void => useDocThreadStore.getState().ingest(e);
const messages = (): DocMsg[] => useDocThreadStore.getState().messages[KEY] ?? [];
const texts = (): string[] => messages().map((m) => ('text' in m ? m.text : m.kind));

const CONVENE = 'Convening a 5-seat council to pick who writes the draft…';
const PHASE2 = 'Crew phase 2/3: writing the draft (draft)…';

beforeEach(() => {
  useDocThreadStore.setState({
    messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {}, lastError: {},
    lastSignalAt: {}, expectedDividers: {}, bindings: {}, held: {}, boundRun: {},
  });
  vi.useRealTimers();
});

describe('heartbeat repeats fold into ONE narration row (F-4R2-005)', () => {
  it('seven identical heartbeats are one row carrying repeats=6 and the span they covered', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    ingest(status(CONVENE));
    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(15_000);
      ingest(status(CONVENE));
    }
    expect(texts()).toEqual([CONVENE]);
    const row = messages()[0] as Extract<DocMsg, { kind: 'narration' }>;
    expect(row.repeats).toBe(6);
    expect(row.firstAt).toBe(1_000_000);
    expect(row.lastAt).toBe(1_000_000 + 6 * 15_000);
    // The state transition each heartbeat rode in on still applies.
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
    vi.useRealTimers();
  });

  it('a different line is a new row; the same words after another line are a NEW phase, not a fold', () => {
    ingest(status(CONVENE));
    ingest(status(CONVENE));
    ingest(status('Council picked claude for draft…'));
    ingest(status(PHASE2));
    ingest(status(PHASE2));
    ingest(status(PHASE2));
    ingest(status('Gate approved draft — moving on…'));
    ingest(status(PHASE2)); // said again after the gate: a new row, not folded into the earlier one
    expect(texts()).toEqual([
      CONVENE, 'Council picked claude for draft…', PHASE2, 'Gate approved draft — moving on…', PHASE2,
    ]);
    const rows = messages() as Extract<DocMsg, { kind: 'narration' }>[];
    expect(rows[0]!.repeats).toBe(1);
    expect(rows[2]!.repeats).toBe(2);
    expect(rows[4]!.repeats).toBeUndefined();
  });

  it('a terminal line (complete / error) never folds into the working line it repeats', () => {
    ingest(status('Landing the draft…'));
    ingest(status('Landing the draft…', 'complete'));
    expect(texts()).toEqual(['Landing the draft…', 'Landing the draft…']);
    expect(useDocThreadStore.getState().genState[KEY]).toBe('terminal');
  });

  it('the restored transcript folds the same way — 16 repeated rows come back as one', () => {
    const entries: ConversationEntry[] = [
      { role: 'user', text: 'a brochure', ts: 1_000 },
      { role: 'agent', text: 'A governed crew picked up your brief — planning the draft…', ts: 2_000 },
      ...Array.from({ length: 16 }, (_, i) => ({ role: 'agent', text: PHASE2, ts: 3_000 + i * 15_000 })),
      { role: 'agent', text: 'Gate approved draft — moving on…', ts: 300_000 },
    ];
    useDocThreadStore.getState().hydrate(KEY, entries, []);
    expect(texts()).toEqual([
      'a brochure', 'A governed crew picked up your brief — planning the draft…', PHASE2, 'Gate approved draft — moving on…',
    ]);
    const folded = messages()[2] as Extract<DocMsg, { kind: 'narration' }>;
    expect(folded.repeats).toBe(15);
    expect(folded.firstAt).toBe(3_000);
    expect(folded.lastAt).toBe(3_000 + 15 * 15_000);
  });
});

describe('the crew run-failure line becomes the actionable run-failed kind (F-4R2-014)', () => {
  const LINE =
    `The crew run answering your ask failed (run ${RUN}). Reason: [wicked-crew] deliverable floor: this phase declared 1 artifact(s). ` +
    `[wicked-crew] EXPECTED: /w5/state/interactive-chats/${DOC}-m-dmsg-7/revised.html [wicked-crew] FOUND: (nothing) ` +
    `[wicked-crew] DELIVERABLE FLOOR FAILED — the run reported done without producing the artifact(s). ` +
    `Inspect it via the crew API (GET /api/v1/runs/${RUN}), then resend the message.`;

  it('live: the error frame lands as run-failed with the run id, the summary and the raw text; the send fails visibly', () => {
    useDocThreadStore.getState().addUserMsg(KEY, 'm-1', 'make the palette teal');
    useDocThreadStore.getState().setGenState(KEY, 'generating');
    ingest(status(LINE, 'error'));
    const card = messages().find((m) => m.kind === 'run-failed') as Extract<DocMsg, { kind: 'run-failed' }>;
    expect(card).toBeDefined();
    expect(card.runId).toBe(RUN);
    expect(card.summary).toBe('The revise step produced no file, so this turn did not land — nothing changed in your document.');
    expect(card.text).toBe(LINE);
    expect(useDocThreadStore.getState().genState[KEY]).toBe('terminal');
    expect((messages()[0] as Extract<DocMsg, { kind: 'user' }>).failed).toBe(true);
    // The error is still indexed as the thread's newest failure (the brand-learn poll reads it).
    expect(useDocThreadStore.getState().lastError[KEY]?.text).toBe(LINE);
  });

  it('a bound run that the seam reports failed is recorded as such', () => {
    useDocThreadStore.getState().adoptRun(KEY, {
      session: { id: RUN, status: 'executing' } as never, units: [],
    } as never);
    ingest(status(LINE, 'error'));
    expect(useDocThreadStore.getState().boundRun[KEY]).toEqual({ runId: RUN, status: 'failed' });
  });

  it('restored: the transcript\'s error line comes back as the same card', () => {
    useDocThreadStore.getState().hydrate(KEY, [
      { role: 'user', text: 'make the palette teal', ts: 1 },
      { role: 'agent', text: LINE, ts: 2, state: 'error' },
    ], []);
    const card = messages()[1] as Extract<DocMsg, { kind: 'run-failed' }>;
    expect(card.kind).toBe('run-failed');
    expect(card.runId).toBe(RUN);
  });
});
