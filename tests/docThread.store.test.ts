// The Document-mode transcript store — DES-MERGE-001 §6.3 slice 10.
//
// Four concerns, one per AC:
//   1. Composer state mapping: the four §2.2 states, derived from the relayed stream.
//   2. The whimsy filter (§3.2): filler never becomes a message, at either altitude.
//   3. Authorship (§2.5): review verdicts and export completions are ORDINARY messages.
//   4. Version anchors (§7.6, client half): a landed version tags the message that
//      triggered it, so slice 9's strip has something to scroll to.
import { beforeEach, describe, expect, it } from 'vitest';
import { nextMsgId, threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';
import { isWhimsy } from '../src/store/narration.js';
import { docActivityOf } from '../src/store/runtime.js';
import type { CoreEvent } from '../src/api/types.js';

const PROJECT = 'proj-abc';
const DOC = 'launch-deck';
const KEY = threadKey(PROJECT, DOC);

/** One frame as crew relays it (slice 3's envelope). */
function frame(eventType: string, payload: Record<string, unknown>): CoreEvent {
  return {
    type: 'interactiveEvent',
    event: { event_type: eventType, payload: { project_id: PROJECT, document_id: DOC, ...payload } },
  } as unknown as CoreEvent;
}

function ingest(event: CoreEvent): void {
  useDocThreadStore.getState().ingest(event);
}

function messages(): DocMsg[] {
  return useDocThreadStore.getState().messages[KEY] ?? [];
}

function texts(): string[] {
  return messages().flatMap((m) => ('text' in m ? [m.text] : []));
}

function state(): string | undefined {
  return useDocThreadStore.getState().genState[KEY];
}

beforeEach(() => {
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {} });
});

describe('composer state mapping (§2.2)', () => {
  it('a status while working puts the thread in GENERATING', () => {
    ingest(frame('wicked.interactive.status.posted', { state: 'working', message: 'Planning 4 slides' }));
    expect(state()).toBe('generating');
    expect(texts()).toEqual(['Planning 4 slides']);
  });

  it('state:"asking" is a GATE, answerable in the thread with its options', () => {
    ingest(frame('wicked.interactive.status.posted', {
      state: 'asking', request_id: 'req-7', question: 'Deck or one-pager?', options: ['Deck', 'One-pager'],
    }));
    expect(state()).toBe('gated');
    expect(messages()[0]).toMatchObject({
      kind: 'gate', requestId: 'req-7', question: 'Deck or one-pager?',
      options: ['Deck', 'One-pager'],
    });
  });

  it('a status arriving DURING a gate narrates without clearing the gate', () => {
    ingest(frame('wicked.interactive.status.posted', { state: 'asking', request_id: 'r1', question: 'Which theme?' }));
    ingest(frame('wicked.interactive.status.posted', { state: 'working', message: 'Waiting on your answer' }));
    expect(state()).toBe('gated');
  });

  it('state:"complete" and state:"error" are both TERMINAL — the composer continues', () => {
    ingest(frame('wicked.interactive.status.posted', { state: 'working', message: 'Drafting' }));
    ingest(frame('wicked.interactive.status.posted', { state: 'complete', message: 'Draft landed' }));
    expect(state()).toBe('terminal');
    ingest(frame('wicked.interactive.status.posted', { state: 'error', message: 'Could not read the source file' }));
    expect(state()).toBe('terminal');
  });

  it('a generated version ends the working state; a fork does not', () => {
    useDocThreadStore.getState().setGenState(KEY, 'generating');
    ingest(frame('wicked.interactive.version.created', { version: 4, parent: 3, kind: 'fork' }));
    expect(state()).toBe('generating');
    ingest(frame('wicked.interactive.version.created', { version: 5, parent: 4, kind: 'generated' }));
    expect(state()).toBe('terminal');
  });

  it('ignores frames that are not relayed interactive events, and unkeyable ones', () => {
    ingest({ type: 'unitOutputDelta', session: 's1', ord: 0, text: 'hi' } as unknown as CoreEvent);
    ingest({
      type: 'interactiveEvent',
      event: { event_type: 'wicked.interactive.status.posted', payload: { message: 'no ids here' } },
    } as unknown as CoreEvent);
    expect(useDocThreadStore.getState().messages).toEqual({});
  });
});

describe('whimsy filter (§3.2)', () => {
  const WHIMSY = [
    'Wiring the harness…', 'Pondering the loop…', 'Tightening the bolts…', 'Consulting the spine…',
    'Aligning the lanes…', 'Reticulating splines…', 'Checking the gates…',
  ];

  it('recognizes every line of interactive\'s WHIMSY list, ellipsis or not', () => {
    for (const line of WHIMSY) {
      expect(isWhimsy(line)).toBe(true);
      expect(isWhimsy(line.replace('…', ''))).toBe(true);
    }
  });

  it('keeps real narration that merely mentions a filler word', () => {
    expect(isWhimsy('Checking the gates on run 4 — 2 of 3 approved')).toBe(false);
    expect(isWhimsy('Rewriting slide 3 — tightening the headline')).toBe(false);
  });

  it('drops filler from the transcript while keeping the state it rode in on', () => {
    for (const line of WHIMSY) {
      ingest(frame('wicked.interactive.status.posted', { state: 'working', message: line }));
    }
    ingest(frame('wicked.interactive.status.posted', { state: 'working', message: 'Rewriting slide 3' }));
    expect(texts()).toEqual(['Rewriting slide 3']);
    expect(state()).toBe('generating');
  });

  it('drops filler from the board headline too — one rule, both altitudes (§3.4)', () => {
    expect(docActivityOf(frame('wicked.interactive.status.posted', { message: 'Reticulating splines…' }))).toBeNull();
    expect(docActivityOf(frame('wicked.interactive.status.posted', { message: 'Planning: 4 units' })))
      .toMatchObject({ projectId: PROJECT, activity: { message: 'Planning: 4 units' } });
  });
});

describe('ordinary messages, not toasts (§2.5 / §4.4)', () => {
  it('a review verdict is a message with its reviewer as the author', () => {
    ingest(frame('wicked.interactive.review.completed', { reviewer: 'a11y', verdict: 'Contrast fails on slide 2' }));
    expect(messages()[0]).toMatchObject({ kind: 'verdict', author: 'a11y', text: 'Contrast fails on slide 2' });
  });

  it('a chat line with role:"review" collapses into the same verdict shape', () => {
    ingest(frame('wicked.interactive.chat.posted', { role: 'review', reviewer: 'copy', text: 'Headline is vague' }));
    expect(messages()[0]).toMatchObject({ kind: 'verdict', author: 'copy', text: 'Headline is vague' });
  });

  it('an agent reply lands as an agent message; our own echoed user line does not', () => {
    ingest(frame('wicked.interactive.chat.posted', { role: 'agent', text: 'Reworked the intro' }));
    ingest(frame('wicked.interactive.chat.posted', { role: 'user', text: 'make it shorter' }));
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ kind: 'agent', text: 'Reworked the intro' });
  });

  it('a completed export lands in the thread as a downloadable message', () => {
    ingest(frame('wicked.interactive.export.generated', {
      version: 3, format: 'pdf', file: 'launch-deck_v3.pdf', download: '/d/launch-deck/api/download/launch-deck_v3.pdf',
    }));
    expect(messages()[0]).toMatchObject({
      kind: 'agent', author: 'export', text: 'PDF export ready — launch-deck_v3.pdf',
      href: '/d/launch-deck/api/download/launch-deck_v3.pdf',
    });
  });
});

describe('version anchors (§7.6, client half)', () => {
  it('tags the triggering user message with the version the generation landed', () => {
    const id = nextMsgId();
    useDocThreadStore.getState().addUserMsg(KEY, id, 'make the intro punchier');
    ingest(frame('wicked.interactive.version.created', { version: 7, parent: 6, kind: 'generated' }));
    expect(messages()[0]).toMatchObject({ kind: 'user', id, version: 7 });
  });

  // Re-scoped by DES-UX-001 slice T (§6.1 + §8.4.1 probe 1): the bridge QUEUES —
  // sends land durably in send order — and `version.created` carries no
  // source_message_id, so the anchor is an ORDER correlation: the oldest pending
  // send is what the next generated version answers, never the newest.
  it('correlates landings to sends FIFO: the OLDEST pending send is tagged first', () => {
    const first = nextMsgId();
    useDocThreadStore.getState().addUserMsg(KEY, first, 'first ask');
    const second = nextMsgId();
    useDocThreadStore.getState().addUserMsg(KEY, second, 'and then this');
    ingest(frame('wicked.interactive.version.created', { version: 2, parent: 1, kind: 'generated' }));
    let tagged = messages().filter((m) => m.kind === 'user' && m.version !== undefined);
    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toMatchObject({ id: first, version: 2 });
    // The queue is still working the second send, so the thread is not terminal…
    expect(state()).toBe('generating');
    // …and the NEXT landing answers it.
    ingest(frame('wicked.interactive.version.created', { version: 3, parent: 2, kind: 'generated' }));
    tagged = messages().filter((m) => m.kind === 'user' && m.version !== undefined);
    expect(tagged).toHaveLength(2);
    expect(tagged[1]).toMatchObject({ id: second, version: 3 });
    expect(state()).toBe('terminal');
  });

  it('a fork version tags the message but leaves it anchored for the generation to come', () => {
    const id = nextMsgId();
    useDocThreadStore.getState().addUserMsg(KEY, id, 'try a darker theme');
    ingest(frame('wicked.interactive.version.created', { version: 4, parent: 1, kind: 'fork' }));
    expect(messages()[0]).toMatchObject({ version: 4 });
    ingest(frame('wicked.interactive.version.created', { version: 5, parent: 4, kind: 'generated' }));
    expect(messages()[0]).toMatchObject({ version: 5 });
  });

  it('a version with no message behind it tags nothing and throws nothing', () => {
    ingest(frame('wicked.interactive.version.created', { version: 2, parent: 1, kind: 'generated' }));
    expect(messages()).toEqual([]);
  });
});

// ── DES-UX-001 slice T (§6.1): the send lifecycle — every send resolves visibly ──

describe('send lifecycle (§6.1, EC36)', () => {
  it('a refused send leaves the pending queue and wears the failed flag', () => {
    const store = useDocThreadStore.getState();
    const a = nextMsgId();
    const b = nextMsgId();
    store.addUserMsg(KEY, a, 'first');
    store.addUserMsg(KEY, b, 'second');
    store.markSendFailed(KEY, a);
    expect(useDocThreadStore.getState().pending[KEY]).toEqual([b]);
    expect(messages()[0]).toMatchObject({ id: a, failed: true });
    // A later landing answers the SURVIVING send, never the failed one.
    ingest(frame('wicked.interactive.version.created', { version: 2, parent: 1, kind: 'generated' }));
    expect(messages()[0]).not.toHaveProperty('version');
    expect(messages()[1]).toMatchObject({ id: b, version: 2 });
  });

  it('a retry re-enqueues at the TAIL — a new send in queue order', () => {
    const store = useDocThreadStore.getState();
    const a = nextMsgId();
    const b = nextMsgId();
    store.addUserMsg(KEY, a, 'first');
    store.addUserMsg(KEY, b, 'second');
    store.markSendFailed(KEY, a);
    store.retrySend(KEY, a);
    expect(useDocThreadStore.getState().pending[KEY]).toEqual([b, a]);
    expect(messages()[0]).toMatchObject({ id: a, failed: false });
  });

  it('a run death fails its whole backlog visibly — no chip generates forever', () => {
    const store = useDocThreadStore.getState();
    const a = nextMsgId();
    const b = nextMsgId();
    store.addUserMsg(KEY, a, 'first');
    store.addUserMsg(KEY, b, 'second');
    ingest(frame('wicked.interactive.status.posted', { state: 'error', message: 'theme file not found' }));
    expect(useDocThreadStore.getState().pending[KEY]).toEqual([]);
    const users = messages().filter((m) => m.kind === 'user');
    expect(users[0]).toMatchObject({ id: a, failed: true });
    expect(users[1]).toMatchObject({ id: b, failed: true });
    expect(state()).toBe('terminal');
  });
});

// ── DES-UX-001 slice T (§6.3): rehydration from GET /d/:doc/api/conversation ──

describe('rehydration (§6.3, BRIDGE-UX-1 probe 2)', () => {
  it('restores user text and agent narration in wire order, anchors by ordinal', () => {
    useDocThreadStore.getState().hydrate(KEY, [
      { role: 'user', text: 'a deck for the Q3 review', ts: 1 },
      { role: 'agent', text: 'Planning the deck — outline first.', ts: 2 },
      { role: 'user', text: 'tighten the headline', ts: 3 },
      { role: 'agent', text: 'Something broke', ts: 4, state: 'error' },
    ], [{ ord: 1, version: 1 }]);
    const restored = messages();
    expect(restored.map((m) => m.kind)).toEqual(['user', 'narration', 'user', 'narration']);
    // The 1st user message wears the session-observed anchor; the 2nd has the
    // honest gap — the wire carries no version anchors (§8.4.1).
    expect(restored[0]).toMatchObject({ text: 'a deck for the Q3 review', version: 1, restored: true });
    expect(restored[2]).not.toHaveProperty('version');
    expect(useDocThreadStore.getState().hydrated[KEY]).toBe(true);
  });

  it('never doubles a live projection, and runs once per thread', () => {
    useDocThreadStore.getState().addUserMsg(KEY, nextMsgId(), 'live message');
    useDocThreadStore.getState().hydrate(KEY, [{ role: 'user', text: 'from the wire' }], []);
    expect(messages()).toHaveLength(1);
    expect(useDocThreadStore.getState().hydrated[KEY]).toBe(true);
    // A second hydrate is a no-op even against an empty-ish store slot.
    useDocThreadStore.getState().hydrate(KEY, [{ role: 'user', text: 'again' }], []);
    expect(messages()).toHaveLength(1);
  });

  it('drops filler narration at the same seam live frames cross (§3.2)', () => {
    useDocThreadStore.getState().hydrate(KEY, [
      { role: 'agent', text: 'Reticulating splines…' },
      { role: 'agent', text: 'Rewriting slide 3' },
    ], []);
    expect(texts()).toEqual(['Rewriting slide 3']);
  });
});

// ── DES-UX-001 slice T (§6.3): the session-storage anchor stopgap ──

describe('anchor stopgap (threadStopgap)', () => {
  it('a landed version records its user-message ordinal, readable back', async () => {
    const { readAnchors } = await import('../src/interactive/threadStopgap.js');
    window.sessionStorage.clear();
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, nextMsgId(), 'the ask');
    ingest(frame('wicked.interactive.version.created', { version: 1, parent: null, kind: 'generated' }));
    expect(readAnchors(KEY)).toEqual([{ ord: 1, version: 1 }]);
  });
});
