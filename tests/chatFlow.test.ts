/**
 * The chat flow (operator 2026-10-16): New job's "Start with chat" and "start in chat" open a new chat on
 * its own page. `openChatFlow` mints the page's chat id, marks it fresh (also in sessionStorage, so a
 * reload of the empty page is still a new chat), puts the opener's words in its composer unsent, and
 * asks App to go there; `chatOpened` retires the mark once the daemon opened the chat.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { chatOpened, freshChat, openChatFlow, resetChatFlow, useChatFlow } from '../src/store/chatFlow.js';
import { useSessionDrafts } from '../src/store/sessionDrafts.js';
import { sessionPath } from '../src/board/sessionModel.js';
import { parseRoute } from '../src/hooks/useRoute.js';

beforeEach(() => { resetChatFlow(); sessionStorage.clear(); });

describe('openChatFlow', () => {
  it('mints a new chat for each open, fresh in its project, with the words waiting in its composer', () => {
    const a = openChatFlow({ projectId: 'p1', seedText: 'why is login slow?' });
    const b = openChatFlow({});
    expect(a).not.toBe(b);
    expect(freshChat(a)).toEqual({ projectId: 'p1' });
    expect(freshChat(b)).toEqual({ projectId: null });
    expect(useSessionDrafts.getState().drafts[a]).toBe('why is login slow?');
    expect(useSessionDrafts.getState().drafts[b] ?? '').toBe('');
    expect(useChatFlow.getState().request).toMatchObject({ chatId: b, nonce: 2 });
  });

  it('"Not in a project" (default) and an empty project are no project', () => {
    expect(freshChat(openChatFlow({ projectId: 'default' }))).toEqual({ projectId: null });
    expect(freshChat(openChatFlow({ projectId: '' }))).toEqual({ projectId: null });
  });

  it('goes to the chat\'s own session page — a real route, never the dock', () => {
    const id = openChatFlow({});
    const r = parseRoute(sessionPath(id));
    expect(r.panel).toBe('session');
    expect(r.artifactId).toBe(id);
  });

  it('keeps the fresh mark in sessionStorage, and chatOpened retires it there too', () => {
    const id = openChatFlow({ projectId: 'p2' });
    expect(JSON.parse(sessionStorage.getItem('studio.chat.fresh') ?? '{}')[id]).toEqual({ projectId: 'p2' });
    chatOpened(id);
    expect(freshChat(id)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('studio.chat.fresh') ?? '{}')[id]).toBeUndefined();
    chatOpened(id); // idempotent
    expect(freshChat(id)).toBeNull();
  });
});
