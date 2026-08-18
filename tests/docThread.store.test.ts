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
  return messages().map((m) => ('text' in m ? m.text : `divider:v${m.version}`));
}

function state(): string | undefined {
  return useDocThreadStore.getState().genState[KEY];
}

beforeEach(() => {
  useDocThreadStore.setState({ messages: {}, genState: {}, anchor: {} });
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
    const gate = messages()[0];
    expect(gate).toMatchObject({ kind: 'gate', requestId: 'req-7', question: 'Deck or one-pager?' });
    expect(gate.kind === 'gate' && gate.options).toEqual(['Deck', 'One-pager']);
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

  it('tags the LAST user message before generation started, not an earlier one', () => {
    const first = nextMsgId();
    useDocThreadStore.getState().addUserMsg(KEY, first, 'first ask');
    const second = nextMsgId();
    useDocThreadStore.getState().addUserMsg(KEY, second, 'actually, do this instead');
    ingest(frame('wicked.interactive.version.created', { version: 2, parent: 1, kind: 'generated' }));
    const tagged = messages().filter((m) => m.kind === 'user' && m.version !== undefined);
    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toMatchObject({ id: second, version: 2 });
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
