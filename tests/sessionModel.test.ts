// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import {
  conversationOf,
  groupSessions,
  ORPHANED_LINE,
  orphanedOf,
  parseSessionId,
  SINCE_IDLE_MS,
  sessionIdOf,
  sessionPath,
  sessionTitle,
  sinceYouLeft,
} from '../src/board/sessionModel.js';

/**
 * Sessions (DES-STUDIO-REBUILD-001 §5.2, slice S6a): a chat plus the runs launched from it, grouped
 * by the run's `chat_id` (C1) — and, when the daemon does not say `capabilities.runChatId`, each
 * run is its own session `run:<id>` (§7 "chat_id absent").
 */

function run(id: string, status: string, extra: Record<string, unknown> = {}): SessionView {
  return { session: { id, status, problem: `do ${id}`, unit_ix: 0, ...extra }, units: [] } as unknown as SessionView;
}

describe('session ids', () => {
  it('a run with a chat is that chat\'s session only when the daemon says runChatId', () => {
    const v = run('r1', 'executing', { chat_id: 'chat-7' });
    expect(sessionIdOf(v, true)).toBe('chat-7');
    expect(sessionIdOf(v, false)).toBe('run:r1');
    expect(sessionIdOf(run('r2', 'executing'), true)).toBe('run:r2');
  });
  it('parses both kinds and round-trips through the path', () => {
    expect(parseSessionId('run:r1')).toEqual({ kind: 'run', runId: 'r1' });
    expect(parseSessionId('chat-7')).toEqual({ kind: 'chat', chatId: 'chat-7' });
    expect(sessionPath('run:r1')).toBe('/s/run%3Ar1');
  });
});

describe('groupSessions', () => {
  const runs = [
    run('r1', 'completed', { chat_id: 'chat-pay', created_at: 100, ended_at: 200 }),
    run('r2', 'awaiting_human', { chat_id: 'chat-pay', created_at: 300 }),
    run('r3', 'executing', { created_at: 150 }),
  ];
  it('groups runs by chat_id, oldest run first, and sums the badges', () => {
    const s = groupSessions(runs, { runChatId: true, badges: { r2: 1 } });
    const pay = s.find((x) => x.id === 'chat-pay')!;
    expect(pay.runIds).toEqual(['r1', 'r2']);
    expect(pay.badge).toBe(1);
    expect(pay.state).toBe('waiting');
    expect(pay.title).toBe('do r1');
    expect(s.find((x) => x.id === 'run:r3')!.runIds).toEqual(['r3']);
    expect(s).toHaveLength(2);
  });
  it('without runChatId every run is its own session', () => {
    const s = groupSessions(runs, { runChatId: false, badges: {} });
    expect(s.map((x) => x.id).sort()).toEqual(['run:r1', 'run:r2', 'run:r3']);
  });
  it('progress never carries "checked" without check_state', () => {
    const s = groupSessions(runs, { runChatId: true, badges: {} });
    for (const x of s) expect(x.progress.checked).toBeNull();
  });
  it('a session\'s last change is its newest run clock', () => {
    const pay = groupSessions(runs, { runChatId: true, badges: {} }).find((x) => x.id === 'chat-pay')!;
    expect(pay.lastChangeAt).toBe(300_000);
  });
});

describe('the goal sentence and the conversation', () => {
  it('the chat\'s first operator turn wins, else the first run\'s intent', () => {
    const msgs = [
      { kind: 'seat', text: 'hello', at: 1 },
      { kind: 'user', text: 'fix the double charge on checkout, then show me', at: 2 },
      { kind: 'user', text: 'and the refund', at: 3 },
    ];
    expect(sessionTitle(msgs as never, [run('r1', 'completed')])).toBe('fix the double charge on checkout, then show me');
    expect(sessionTitle([], [run('r1', 'completed')])).toBe('do r1');
  });
  it('a chat this daemon reclaimed (scope null, no messages) is closed; a run session has none', () => {
    expect(conversationOf({ kind: 'chat', chatId: 'c' }, { scope: null, messages: [] })).toBe('closed');
    expect(conversationOf({ kind: 'chat', chatId: 'c' }, { scope: { kind: 'none' }, messages: [] })).toBe('live');
    expect(conversationOf({ kind: 'chat', chatId: 'c' }, { scope: null, messages: [{ kind: 'user', text: 'x' }] })).toBe('live');
    expect(conversationOf({ kind: 'chat', chatId: 'c' }, null)).toBe('closed');
    expect(conversationOf({ kind: 'run', runId: 'r' }, null)).toBe('none');
  });

  it('an ask run (its problem is crew\'s chat-scope statement) is titled by the chat\'s question, never "# Chat scope" (studio#540)', () => {
    const statement = '# Chat scope\n\nThis directory is the scratch root of wicked-crew chat `c-1`. It is the ONLY place you may write.\n\n## Repositories in scope (READ-ONLY)\n\n- **wicked-platform** (`r-9`): `/srv/repos/wicked-platform`\n\nExplore and answer questions.\n';
    const ask = run('r-ask', 'executing', { problem: statement, chat_id: 'c-1' });
    const msgs = [{ kind: 'user', text: 'why does greet() not trim?', at: 1 }];
    expect(sessionTitle(msgs as never, [ask])).toBe('why does greet() not trim?');
    // A question that merely opens with the heading is the operator's words, kept (codex r1 #1).
    expect(sessionTitle([{ kind: 'user', text: '# Chat scope\nwhich repos can this chat see?', at: 1 }] as never, [ask])).toBe('# Chat scope');
    // No transcript at hand (the rail, a late join): the statement says what the chat is about.
    expect(sessionTitle([], [ask])).toBe('A conversation about wicked-platform');
    expect(sessionTitle([], [ask])).not.toMatch(/Chat scope/);
  });
});

describe('since you left (R2: a session idle ≥ 4 h)', () => {
  const now = 10 * SINCE_IDLE_MS;
  const runs = [
    run('a', 'completed', { created_at: 1, ended_at: (now - 3_600_000) / 1000 }),
    run('b', 'failed', { created_at: 1, ended_at: (now - 1_800_000) / 1000 }),
    run('c', 'awaiting_human', { created_at: 1 }),
    run('d', 'completed', { created_at: 1, ended_at: (now - 9 * 3_600_000) / 1000 }),
  ];
  it('no card on a first visit, or when the last visit is under 4 h ago', () => {
    expect(sinceYouLeft(null, now, runs, {})).toBeNull();
    expect(sinceYouLeft(now - SINCE_IDLE_MS + 1, now, runs, {})).toBeNull();
  });
  it('after 4 h: what finished, what failed, what needs you — only since the last visit', () => {
    const card = sinceYouLeft(now - 5 * 3_600_000, now, runs, { c: 1 })!;
    expect(card.away).toBe('5 hours');
    expect(card.finished).toEqual(['a']);
    expect(card.failed).toEqual(['b']);
    expect(card.needsYou).toBe(1);
    expect(card.summary).toBe('1 finished · 1 stopped · 1 needs you');
  });
  it('nothing happened: still a card, saying so', () => {
    const card = sinceYouLeft(now - 2 * SINCE_IDLE_MS, now, [runs[3]!], {})!;
    expect(card.summary).toBe('Nothing changed');
  });
});

describe('orphanedOf — a run the daemon restart orphaned (studio#545 / crew#830)', () => {
  const started = { type: 'sessionStarted', ts: 1_000 };
  const dispatched = { type: 'unitDispatched', ord: 1, ts: 2_000 };
  const orphaned = { type: 'runOrphaned', ord: 1, ts: 9_000 };
  it('a trail whose newest dispatch-or-orphan frame is the report: orphaned, at the report\'s own clock', () => {
    expect(orphanedOf('executing', [started, dispatched, orphaned])).toEqual({ ord: 1, at: 9_000 });
    // Frames after the report that are not a dispatch (an audit line, a chat frame) change nothing.
    expect(orphanedOf('executing', [started, dispatched, orphaned, { type: 'gateDecided', ts: 9_500 }])).toEqual({ ord: 1, at: 9_000 });
    expect(ORPHANED_LINE).toBe('The daemon restarted while this step was running; nothing is working on it.');
  });
  it('a dispatch after the report (the daemon\'s boot resume, an operator\'s Resume) is a live run again', () => {
    expect(orphanedOf('executing', [started, dispatched, orphaned, { type: 'unitDispatched', ord: 1, ts: 10_000 }])).toBeNull();
  });
  it('no verdict without the evidence: a trail not read, a run that is not executing, a trail without the report', () => {
    expect(orphanedOf('executing', undefined)).toBeNull();
    expect(orphanedOf('awaiting_human', [started, dispatched, orphaned])).toBeNull();
    expect(orphanedOf('completed', [started, dispatched, orphaned])).toBeNull();
    expect(orphanedOf('executing', [started, dispatched])).toBeNull();
    expect(orphanedOf('executing', [])).toBeNull();
    // A report without a clock or ord is still a report.
    expect(orphanedOf('executing', [{ type: 'runOrphaned' }])).toEqual({ ord: null, at: null });
  });
});
