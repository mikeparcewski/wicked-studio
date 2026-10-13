import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/errors.js';

/**
 * P-D1 — a deck op through the `interactive-doc` adapter: the engine's own route (`POST /d/:doc/api/deck`)
 * answers with the version, so there is no feedback event and no polling. `expect_head` is the base; a
 * moved head, an op the version can't take, a non-deck and an engine without the route each say so.
 */
const api = vi.hoisted(() => ({
  posted: [] as unknown[],
  answer: null as unknown,
  events: [] as unknown[],
}));

vi.mock('../src/api/interactive.js', () => {
  class HeadMovedError extends Error { head: number; constructor(head: number) { super('head_moved'); this.head = head; } }
  return {
    HeadMovedError,
    getVersions: vi.fn(async () => ({ head: 1, versions: [{ version: 1, parent: null, feedback_file: null, html_file: 'v1', created_at: '' }] })),
    interactiveDocUrl: () => '/x',
    postEvent: vi.fn(async (_p: string, evt: unknown) => { api.events.push(evt); return { ok: true }; }),
    postFork: vi.fn(),
    postDeckOp: vi.fn(async (_p: string, _d: string, expectHead: number, op: unknown) => {
      api.posted.push({ expectHead, op });
      const a = api.answer;
      if (a instanceof Error) throw a;
      if (typeof a === 'object' && a !== null && 'headMoved' in a) throw new HeadMovedError((a as { headMoved: number }).headMoved);
      return a;
    }),
  };
});

import { InteractiveDocAdapter } from '../src/editors/interactiveDocAdapter.js';

const move = { selector: 's-a', type: 'deck' as const, op: { type: 'slide-move' as const, slide: 's-a', after: 's-c' } };

beforeEach(() => { api.posted = []; api.answer = null; api.events = []; });

describe('InteractiveDocAdapter: deck ops', () => {
  it('posts the op with expect_head = base; the version it answers is the write, undoable', async () => {
    const heads: number[] = [];
    const a = new InteractiveDocAdapter('notes', 'q3', 'Q3', 'deck', (h) => heads.push(h));
    await a.refresh();
    api.answer = { version: 2, parent: 1 };
    expect(await a.write(1, [move])).toStrictEqual({ version: 2 });
    expect(api.posted).toStrictEqual([{ expectHead: 1, op: { type: 'slide-move', slide: 's-a', after: 's-c' } }]);
    expect(api.events).toStrictEqual([]);
    expect(a.head).toBe(2);
    expect(a.writes.get(2)).toBe(1);
    expect(a.artifact().kind).toBe('deck');
    expect(heads).toStrictEqual([1, 2]);
  });
  it('codex r1: a head already past the write follows the manifest and is announced as moved; a lost reply is an unknown outcome', async () => {
    const a = new InteractiveDocAdapter('notes', 'q3', 'Q3', 'deck');
    await a.refresh();
    const iapi = await import('../src/api/interactive.js');
    vi.mocked(iapi.getVersions).mockResolvedValueOnce({ head: 3, versions: [] } as never);
    api.answer = { version: 2, parent: 1 };
    expect(await a.write(1, [move])).toMatchObject({ version: 2, moved: { head: 3 } });
    expect(a.head).toBe(3);
    expect(a.writes.get(2)).toBe(1);
    api.answer = new TypeError('Failed to fetch');
    expect(await a.write(3, [move])).toMatchObject({ error: 'unavailable', message: expect.stringMatching(/^Whether the slide change landed is not known/) });
    // codex r2: a gateway's 502 after posting is an unknown outcome too
    api.answer = new ApiError(502, 'Bad Gateway', undefined);
    expect(await a.write(3, [move])).toMatchObject({ error: 'unavailable', message: expect.stringMatching(/^Whether the slide change landed is not known/) });
  });
  it('a moved head is head_moved (nothing written), and the head follows', async () => {
    const a = new InteractiveDocAdapter('notes', 'q3', 'Q3', 'deck');
    await a.refresh();
    api.answer = { headMoved: 5 };
    expect(await a.write(1, [move])).toMatchObject({ error: 'head_moved', head: 5, moved: { head: 5 } });
    expect(a.head).toBe(5);
  });
  it('unchanged, an op the version cannot take, not a deck, and an engine without the route', async () => {
    const a = new InteractiveDocAdapter('notes', 'q3', 'Q3', 'deck');
    await a.refresh();
    api.answer = { unchanged: true, head: 1 };
    expect(await a.write(1, [move])).toStrictEqual({ error: 'refused', message: 'Nothing changed: the slide is already there.' });
    api.answer = new ApiError(422, 'refused', { error: 'refused', reason: 'slide-not-found', head: 1 });
    expect(await a.write(1, [move])).toStrictEqual({ error: 'refused', message: 'Not changed: that slide is not in this version.' });
    api.answer = new ApiError(409, 'not_a_deck', { error: 'not_a_deck' });
    expect(await a.write(1, [move])).toMatchObject({ error: 'unsupported', message: 'This document is not a deck.' });
    api.answer = new ApiError(404, 'Cannot POST /api/deck', undefined);
    expect(await a.write(1, [move])).toMatchObject({ error: 'unsupported', message: expect.stringMatching(/update wicked-interactive/) });
    expect(a.head).toBe(1);
  });
});
