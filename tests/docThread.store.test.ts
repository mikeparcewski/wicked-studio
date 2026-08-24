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
  useDocThreadStore.setState({
    messages: {}, genState: {}, pending: {}, hydrated: {},
    lastSignalAt: {}, expectedDividers: {},
  });
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

  // The docfb2 restore: materializeFeedback's model-free landing (`kind:
  // "deterministic"`) ANSWERS the feedback batch — it consumes the pending anchor
  // and ends the working state, exactly as a generated version answers a steer.
  // Before the fix the batch's message span "generating" forever.
  it('a DETERMINISTIC landing (a content-edit batch) answers the batch message', () => {
    const id = nextMsgId();
    useDocThreadStore.getState().addUserMsg(KEY, id, 'Feedback on 1 place…',
      [{ wid: 'headline', text: 'Q3: shipped', mode: 'change-text', before: 'Q3 review' }]);
    useDocThreadStore.getState().setGenState(KEY, 'generating');
    ingest(frame('wicked.interactive.version.created', { version: 2, parent: 1, kind: 'deterministic' }));
    expect(messages()[0]).toMatchObject({ kind: 'user', id, version: 2 });
    expect(state()).toBe('terminal');
    expect(useDocThreadStore.getState().pending[KEY]).toEqual([]);
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

  it('a COMPLETED run resolves the head send it was working — un-tagged (VIDEO-FB)', () => {
    // The stuck-badge shape: the agent ANSWERS IN CHAT and the run completes —
    // no version ever arrives to consume the anchor. Without the complete-side
    // consumption the message wears "generating — being worked now" forever.
    const store = useDocThreadStore.getState();
    const a = nextMsgId();
    const b = nextMsgId();
    store.addUserMsg(KEY, a, 'does the spec cover the cart?');
    store.addUserMsg(KEY, b, 'and the receipt page?');
    ingest(frame('wicked.interactive.chat.posted', { role: 'agent', text: 'It does — nothing to change.' }));
    ingest(frame('wicked.interactive.status.posted', { state: 'complete', message: 'Answered in the thread.' }));
    // The head send resolved; the one behind it is still awaiting its own run.
    expect(useDocThreadStore.getState().pending[KEY]).toEqual([b]);
    // No landing exists, so nothing is tagged — a marker never renders for a
    // version the wire has not shown (the EC36 gaslight pin holds).
    expect(messages().find((m) => m.kind === 'user' && m.id === a)).not.toHaveProperty('version');
    expect(state()).toBe('terminal');
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

// ── The J3 bookkeeping pin: deferred continuation dividers + the signal clock ──

describe('deferred dividers (§7.10, anchor-on-arrival)', () => {
  it('expectDivider renders NOTHING until the wire shows the version exists', () => {
    const store = useDocThreadStore.getState();
    store.expectDivider(KEY, 'm-1', 4);
    store.addUserMsg(KEY, 'm-1', 'make the closing slide stronger');
    expect(messages().map((m) => m.kind)).toEqual(['user']);

    // A lower version arriving is not that proof — the divider stays deferred.
    ingest(frame('wicked.interactive.version.created', { version: 3, parent: 2, kind: 'generated' }));
    expect(messages().some((m) => m.kind === 'divider')).toBe(false);

    // The arrival at (or past) the fork's version materializes it, ABOVE its message.
    ingest(frame('wicked.interactive.version.created', { version: 4, parent: 3, kind: 'generated' }));
    const kinds = messages().map((m) => m.kind);
    expect(kinds).toEqual(['divider', 'user']);
    const divider = messages().find((m) => m.kind === 'divider');
    expect(divider !== undefined && divider.kind === 'divider' && divider.version).toBe(4);
  });

  it('the divider lands immediately above its continuation message', () => {
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'm-1', 'the first ask');
    ingest(frame('wicked.interactive.version.created', { version: 1, parent: null, kind: 'generated' }));
    store.expectDivider(KEY, 'm-2', 2);
    store.addUserMsg(KEY, 'm-2', 'continue from here');
    expect(messages().some((m) => m.kind === 'divider')).toBe(false);
    ingest(frame('wicked.interactive.version.created', { version: 2, parent: 1, kind: 'generated' }));
    expect(messages().map((m) => m.kind)).toEqual(['user', 'divider', 'user']);
  });

  it('a continuation whose run never lands anything never grows a divider', () => {
    const store = useDocThreadStore.getState();
    store.expectDivider(KEY, 'm-1', 2);
    store.addUserMsg(KEY, 'm-1', 'continue');
    ingest(frame('wicked.interactive.status.posted', { state: 'working', message: 'Rewriting slide 2' }));
    expect(messages().some((m) => m.kind === 'divider')).toBe(false);
  });
});

describe('the signal clock (§6.1 honesty budget)', () => {
  it('every parsed frame stamps lastSignalAt for its thread', () => {
    expect(useDocThreadStore.getState().lastSignalAt[KEY]).toBeUndefined();
    ingest(frame('wicked.interactive.status.posted', { state: 'working', message: 'Planning' }));
    const first = useDocThreadStore.getState().lastSignalAt[KEY];
    expect(typeof first).toBe('number');
  });

  it('a frame naming no document stamps nothing', () => {
    ingest({ type: 'interactiveEvent', event: { event_type: 'wicked.interactive.status.posted',
             payload: { state: 'working' } } } as unknown as CoreEvent);
    expect(useDocThreadStore.getState().lastSignalAt[KEY]).toBeUndefined();
  });

  it('addUserMsg stamps sentAt; retrySend re-stamps it', () => {
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'm-1', 'the ask');
    const msg = messages().find((m) => m.kind === 'user');
    expect(msg !== undefined && msg.kind === 'user' && typeof msg.sentAt).toBe('number');
    store.retrySend(KEY, 'm-1');
    const retried = messages().find((m) => m.kind === 'user');
    expect(retried !== undefined && retried.kind === 'user' && typeof retried.sentAt).toBe('number');
  });
});

// ── Round-3 J3: unbound-doc frames key to the Unfiled mount ───────────────────

describe('unbound-doc frames (the round-2 first-generation fix)', () => {
  it('a doc-naming frame with NO project keys to the Unfiled (default) mount, never dropped', () => {
    const key = threadKey('default', DOC);
    ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.version.created',
        // The real bridge stamps project_id ONLY on bound docs (serviceEmit);
        // an Unfiled doc's payloads carry none — pre-fix these were dropped,
        // leaving the open canvas on the v0 placeholder after v1 landed.
        payload: { document_id: DOC, version: 1, parent: 0, kind: 'generated' },
      },
    } as unknown as CoreEvent);
    expect(useDocThreadStore.getState().landed[key]).toBe(1);
    expect(useDocThreadStore.getState().lastSignalAt[key]).toBeGreaterThan(0);
  });

  it('a frame naming no document is still dropped — the fallback never invents a doc', () => {
    const before = Object.keys(useDocThreadStore.getState().landed).sort();
    ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.version.created',
        payload: { version: 1, kind: 'generated' },
      },
    } as unknown as CoreEvent);
    expect(Object.keys(useDocThreadStore.getState().landed).sort()).toEqual(before);
  });
});

// ── Round-3 J3 finding 4: unresolved sends survive the reload ─────────────────

describe('send-state persistence (round-3 finding 4)', () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it('an accepted-but-unanswered send persists as pending and resumes on hydrate — with its ORIGINAL clock', async () => {
    const { readSendStates } = await import('../src/interactive/threadStopgap.js');
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'dmsg-p1', 'make me a deck');
    const persisted = readSendStates(KEY);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ ord: 1, state: 'pending' });
    const sentAt = persisted[0]!.sentAt;
    expect(sentAt).toBeGreaterThan(0);

    // A fresh session (new store keys) hydrates the wire's text + the stopgap's sends.
    useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {} });
    useDocThreadStore.getState().hydrate(
      KEY, [{ role: 'user', text: 'make me a deck', ts: 't1' }], [], persisted, []);
    const msgs = messages();
    expect(msgs[0]).toMatchObject({ kind: 'user', restored: true, sentAt });
    expect(useDocThreadStore.getState().pending[KEY]).toHaveLength(1);
    // Unresolved sends mean the thread is still GENERATING — never quietly terminal.
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
  });

  it('a landing consumes the persisted pending record', () => {
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'dmsg-p2', 'make me a deck');
    ingest(frame('wicked.interactive.version.created', { version: 1, parent: null, kind: 'generated' }));
    return import('../src/interactive/threadStopgap.js').then(({ readSendStates }) => {
      expect(readSendStates(KEY)).toHaveLength(0);
    });
  });

  it('a REFUSED send persists its TEXT and re-renders failed (with retry) after hydrate', async () => {
    const { readSendStates } = await import('../src/interactive/threadStopgap.js');
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'dmsg-ok', 'the brief');           // accepted, then answered
    ingest(frame('wicked.interactive.version.created', { version: 1, parent: null, kind: 'generated' }));
    store.addUserMsg(KEY, 'dmsg-ref', 'add a closing slide'); // refused by the bridge
    store.markSendFailed(KEY, 'dmsg-ref', true);
    const persisted = readSendStates(KEY);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ ord: 1, state: 'failed', text: 'add a closing slide' });

    // The wire holds only the ACCEPTED line; the refused one re-renders from the stopgap.
    useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {} });
    useDocThreadStore.getState().hydrate(
      KEY, [{ role: 'user', text: 'the brief', ts: 't1' }], [{ ord: 1, version: 1 }], persisted, []);
    const users = messages().filter((m): m is Extract<DocMsg, { kind: 'user' }> => m.kind === 'user');
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({ text: 'the brief', version: 1 });
    expect(users[1]).toMatchObject({ text: 'add a closing slide', failed: true });
    // Nothing pending — a refused send is failed, not in flight.
    expect(useDocThreadStore.getState().pending[KEY] ?? []).toHaveLength(0);
  });

  it('the wire outranks a stale refusal: a "refused" send the wire ACCEPTED restores as ONE pending message', () => {
    // The reload-teardown shape: the in-flight fetch was aborted by the unload,
    // the catch persisted a refusal — but the bridge took the message (its line
    // is on the wire). Hydrate must not render a duplicated, fabricated failure:
    // the send restores from the wire line, PENDING, on its original clock.
    const stale = [{ ord: 1, state: 'failed' as const, sentAt: 12345, text: 'add a roadmap slide' }];
    useDocThreadStore.getState().hydrate(
      KEY,
      [{ role: 'user', text: 'the brief', ts: 't1' },
       { role: 'user', text: 'add a roadmap slide', ts: 't2' }],
      [{ ord: 1, version: 1 }], stale, []);
    const users = messages().filter((m): m is Extract<DocMsg, { kind: 'user' }> => m.kind === 'user');
    expect(users).toHaveLength(2); // no duplicate refused copy
    expect(users[1]).toMatchObject({ text: 'add a roadmap slide', sentAt: 12345 });
    expect(users[1]?.failed).not.toBe(true);
    // Accepted and still unanswered ⇒ pending, and the thread is generating.
    expect(useDocThreadStore.getState().pending[KEY] ?? []).toHaveLength(1);
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
  });

  it('an export entry persists and is restored at the transcript tail', () => {
    ingest(frame('wicked.interactive.export.generated', {
      format: 'pdf', file: 'deck_v1.pdf', download: '/d/launch-deck/api/export/file/deck_v1.pdf',
    }));
    return import('../src/interactive/threadStopgap.js').then(({ readExports }) => {
      const stored = readExports(KEY);
      expect(stored).toHaveLength(1);
      useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {} });
      useDocThreadStore.getState().hydrate(
        KEY, [{ role: 'user', text: 'the brief', ts: 't1' }], [], [], stored);
      const tail = messages()[messages().length - 1];
      expect(tail).toMatchObject({
        kind: 'agent', author: 'export',
        href: '/d/launch-deck/api/export/file/deck_v1.pdf', file: 'deck_v1.pdf',
      });
    });
  });
});
