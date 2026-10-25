import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatOpenBody, RosterSeat } from '../src/api/types.js';

/**
 * DES-SYSTEM-CHAT part 2: past chats, Close that keeps history, and uploads — each only on a crew
 * that says it can (`capabilities.chatList` / `.chatAttachments`); an older crew gets one line.
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getChat = vi.fn();
const listChatHistory = vi.fn();
const getChatMessages = vi.fn();
const endChat = vi.fn();
const closeChat = vi.fn();
const uploadChatAttachments = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    listChatHistory: (...a: unknown[]) => listChatHistory(...a),
    getChatMessages: (...a: unknown[]) => getChatMessages(...a),
    endChat: (...a: unknown[]) => endChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    uploadChatAttachments: (...a: unknown[]) => uploadChatAttachments(...a),
    getRoster: () => Promise.resolve({ roster: [] }),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { AskDock, PAST_CHATS_COLUMN_MIN_PX } = await import('../src/components/AskDock.js');
const { ChatChromeContext } = await import('../src/components/chat/ChatWindow.js');
const { ChatCliPicker } = await import('../src/components/chat/ChatCliPicker.js');
const { setCachedRoster, clearCachedRoster } = await import('../src/store/rosterCache.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useLiveChatsStore } = await import('../src/store/liveChats.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { endSystemChat, useAskDock } = await import('../src/store/askDock.js');
const { readAskSession, writeAskSession } = await import('../src/store/askSession.js');
const { resetChatWindow, useChatWindow } = await import('../src/store/chatWindow.js');
const { ApiError } = await import('../src/api/errors.js');

const ROSTER = [{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }] as unknown as RosterSeat[];
const ENTRY = (id: string, status: 'open' | 'closed', title = 'why is it held?') => ({
  id, title, startedOn: { route: '/s/run:r1', label: 'Fix the login' }, cli: 'claude',
  createdAt: '2026-10-25T10:00:00Z', updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  messageCount: 2, attachmentCount: 0, status,
});

function caps(on: boolean): void {
  useCapabilities.setState({ loaded: true, chatList: on, chatAttachments: on, askPath: false });
}
const dock = (pathname = '/'): ReturnType<typeof render> => render(<AskDock runs={[]} pathname={pathname} onClose={() => undefined} />);

beforeEach(() => {
  cleanup();
  for (const f of [openChat, sendChatMessage, getChat, listChatHistory, getChatMessages, endChat, closeChat, uploadChatAttachments, apiFetch]) f.mockReset();
  apiFetch.mockRejectedValue(new Error('no diagnostics in this rig'));
  clearCachedRoster();
  setCachedRoster(ROSTER);
  openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }] }));
  sendChatMessage.mockResolvedValue({ seats: ['claude'] });
  getChat.mockResolvedValue({ chatId: 'x', seats: ['claude'] });
  endChat.mockResolvedValue({ ok: true });
  useLiveChatsStore.setState({ sessions: {} });
  useProjectsStore.setState({ projects: [], loading: false, error: null });
  localStorage.clear();
  sessionStorage.clear();
  resetChatWindow();
  caps(true);
});

describe('an older crew (no chatList / chatAttachments)', () => {
  it('hides past chats and upload behind one line, and sends neither startedOn nor anything new', async () => {
    caps(false);
    const user = userEvent.setup();
    dock();
    expect(screen.getByTestId('assist-notice')).toHaveTextContent('Past chats and file uploads need a newer wicked-crew.');
    expect(screen.queryByTestId('chat-history-toggle')).toBeNull();
    expect(screen.queryByTestId('assist-attach')).toBeNull();
    await user.type(screen.getByTestId('assist-input'), 'hi');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect('startedOn' in (openChat.mock.calls[0]![0] as object)).toBe(false);
    // Close forgets the chat here, and sends nothing (no history route to keep it).
    endSystemChat();
    expect(endChat).not.toHaveBeenCalled();
    expect(closeChat).not.toHaveBeenCalled();
  });
});

describe('past chats (chatList)', () => {
  it('the clock toggles the rail; it lists crew\'s chats with where they started and their age', async () => {
    listChatHistory.mockResolvedValue({ chats: [], items: [ENTRY('c-1', 'closed'), ENTRY('c-2', 'open', 'what changed?')], nextCursor: 'k2' });
    const user = userEvent.setup();
    dock();
    expect(screen.queryByTestId('assist-notice')).toBeNull();
    await user.click(screen.getByTestId('chat-history-toggle'));
    const rows = await screen.findAllByTestId('chat-history-entry');
    expect(rows.map((r) => r.getAttribute('data-chat-id'))).toEqual(['c-1', 'c-2']);
    expect(rows[0]).toHaveTextContent('why is it held?');
    expect(rows[0]).toHaveTextContent('Fix the login · 5 min · ended');
    expect(listChatHistory).toHaveBeenCalledWith({ limit: 20, cursor: null });
    listChatHistory.mockResolvedValue({ chats: [], items: [ENTRY('c-3', 'closed', 'older')], nextCursor: null });
    await user.click(screen.getByTestId('chat-history-more'));
    await waitFor(() => expect(screen.getAllByTestId('chat-history-entry')).toHaveLength(3));
    expect(listChatHistory).toHaveBeenLastCalledWith({ limit: 20, cursor: 'k2' });
    expect(screen.queryByTestId('chat-history-more')).toBeNull();
    await user.click(screen.getByTestId('chat-history-close'));
    expect(screen.queryByTestId('chat-history')).toBeNull();
  });

  it('clicking an entry reopens it: it becomes the stored session and the dock remounts to resume it', async () => {
    listChatHistory.mockResolvedValue({ chats: [], items: [ENTRY('c-9', 'closed')], nextCursor: null });
    const user = userEvent.setup();
    const before = useAskDock.getState().request?.nonce ?? 0;
    dock();
    await user.click(screen.getByTestId('chat-history-toggle'));
    await user.click(await screen.findByTestId('chat-history-entry'));
    expect(readAskSession()).toMatchObject({ chatId: 'c-9', title: 'why is it held?', seeded: true, cli: 'claude' });
    expect(useAskDock.getState().request).toMatchObject({ nonce: before + 1, fresh: false, projectId: null });
  });

  it('a reopened ENDED chat shows its kept messages read-only, and the next question opens a new chat', async () => {
    writeAskSession({ chatId: 'c-9', title: 'why is it held?', seeded: true, cli: 'claude' });
    getChatMessages.mockResolvedValue({
      chat: ENTRY('c-9', 'closed'),
      messages: [
        { at: 1, turnId: 't1', kind: 'user', text: 'what is in this screenshot?', seats: ['claude'], attachments: [{ id: 'a1', name: 'shot.png' }] },
        { at: 2, turnId: 't1', kind: 'seat', cliKey: 'claude', text: 'A login form with an error banner.', ok: true, usage: null },
      ],
      attachments: [],
    });
    const user = userEvent.setup();
    dock();
    await waitFor(() => expect(screen.getAllByTestId('assist-chat-msg')).toHaveLength(2));
    expect(getChatMessages).toHaveBeenCalledWith('c-9');
    expect(getChat).not.toHaveBeenCalled();
    expect(screen.getByTestId('assist-chat-msg-files')).toHaveTextContent('shot.png');
    // A replayed answer names who answered, and claims no source count it does not have on record.
    expect(screen.getByTestId('assist-answer-footer').textContent).toBe('Answered by Claude Code');
    expect(screen.getAllByTestId('assist-note').some((n) => /This chat has ended/.test(n.textContent ?? ''))).toBe(true);
    expect(readAskSession()).toBeNull();
    await user.type(screen.getByTestId('assist-input'), 'and now?');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]![0] as ChatOpenBody).chatId).not.toBe('c-9');
  });

  it('a new chat says where it started (startedOn), and Close ends it with its history KEPT', async () => {
    const user = userEvent.setup();
    dock('/watch');
    await user.type(screen.getByTestId('assist-input'), 'what is stopping work?');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const body = openChat.mock.calls[0]![0] as ChatOpenBody & { startedOn?: unknown };
    expect(body.startedOn).toEqual({ route: '/watch', label: 'Nerve Center' });
    act(() => { useChatWindow.getState().open(); });
    endSystemChat();
    await waitFor(() => expect(endChat).toHaveBeenCalledWith(body.chatId));
    expect(closeChat).not.toHaveBeenCalled();
    expect(readAskSession()).toBeNull();
  });
});

describe('past chats beside the conversation (the approved mockup)', () => {
  const css = readFileSync(resolve(__dirname, '../src/styles/components.css'), 'utf8');
  /** The chat window's inner width, as the dock measures it (jsdom has no layout). */
  const atWidth = (px: number): void => { vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px); };
  const phoneDock = (): ReturnType<typeof render> => render(
    <ChatChromeContext.Provider value={{ dragProps: {}, controls: null, phone: true }}>
      <AskDock runs={[]} pathname="/" onClose={() => undefined} />
    </ChatChromeContext.Provider>,
  );
  beforeEach(() => { getChatMessages.mockResolvedValue({ chat: ENTRY('c-1', 'closed'), messages: [], attachments: [] }); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('in a wide window the column starts open and the conversation stays on screen beside it', async () => {
    listChatHistory.mockResolvedValue({ chats: [], items: [ENTRY('c-1', 'closed'), ENTRY('c-2', 'open', 'what changed?')], nextCursor: null });
    atWidth(600);
    const user = userEvent.setup();
    dock();
    // Open without a click, as a column (not lying over the chat), with the conversation still there.
    expect(await screen.findAllByTestId('chat-history-entry')).toHaveLength(2);
    expect(screen.getByTestId('system-chat')).toHaveAttribute('data-past-chats', 'column');
    expect(screen.getByTestId('chat-history-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('assist-dock')).toBeVisible();
    expect(screen.getByTestId('assist-input')).toBeVisible();
    // The column sits before the conversation (on its left) inside the chat's body.
    const body = screen.getByTestId('system-chat');
    expect(body.firstElementChild).toBe(screen.getByTestId('chat-history'));
    expect(screen.getByTestId('chat-history').nextElementSibling).toBe(screen.getByTestId('assist-dock'));
    // Picking a past chat keeps the column; the conversation is still there to show it.
    await user.click(screen.getAllByTestId('chat-history-entry')[0]!);
    expect(readAskSession()).toMatchObject({ chatId: 'c-1' });
    expect(screen.getByTestId('chat-history')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-history-entry').map((r) => r.getAttribute('aria-current'))).toEqual(['true', null]);
    expect(screen.getByTestId('assist-input')).toBeVisible();
    // The clock hides it, and a dock that remounts (a reopened chat) remembers that.
    await user.click(screen.getByTestId('chat-history-toggle'));
    expect(screen.queryByTestId('chat-history')).toBeNull();
    expect(useChatWindow.getState().pastChats).toBe(false);
    cleanup();
    dock();
    expect(screen.queryByTestId('chat-history')).toBeNull();
    expect(screen.getByTestId('chat-history-toggle')).toHaveAttribute('aria-pressed', 'false');
    // Shown again, the chat on screen (an ENDED one, replayed from its history) is still the one marked.
    await waitFor(() => expect(getChatMessages).toHaveBeenCalledWith('c-1'));
    await user.click(screen.getByTestId('chat-history-toggle'));
    await waitFor(() => expect(screen.getAllByTestId('chat-history-entry')[0]).toHaveAttribute('aria-current', 'true'));
  });

  it('in a narrow window (or on a phone) it starts closed, lies over the chat, and steps aside once a chat is picked', async () => {
    listChatHistory.mockResolvedValue({ chats: [], items: [ENTRY('c-1', 'closed')], nextCursor: null });
    atWidth(PAST_CHATS_COLUMN_MIN_PX - 1);
    const user = userEvent.setup();
    dock();
    expect(screen.queryByTestId('chat-history')).toBeNull();
    await user.click(screen.getByTestId('chat-history-toggle'));
    expect(screen.getByTestId('system-chat')).toHaveAttribute('data-past-chats', 'overlay');
    await user.click(await screen.findByTestId('chat-history-entry'));
    expect(screen.queryByTestId('chat-history')).toBeNull();
    // An overlay toggle is not a column preference.
    expect(useChatWindow.getState().pastChats).toBeNull();
    cleanup();
    atWidth(1200);
    phoneDock();
    expect(screen.queryByTestId('chat-history')).toBeNull();
    await user.click(screen.getByTestId('chat-history-toggle'));
    expect(screen.getByTestId('system-chat')).toHaveAttribute('data-past-chats', 'overlay');
  });

  it('a chat started beside the open column shows up in it, marked (review: agy P3)', async () => {
    let opened: string | null = null;
    listChatHistory.mockImplementation(() => Promise.resolve({
      chats: [], nextCursor: null,
      items: [...(opened !== null ? [ENTRY(opened, 'open', 'what is stopping work?')] : []), ENTRY('c-1', 'closed')],
    }));
    openChat.mockImplementation((body: ChatOpenBody) => { opened = body.chatId ?? null; return Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }] }); });
    atWidth(600);
    const user = userEvent.setup();
    dock();
    expect(await screen.findAllByTestId('chat-history-entry')).toHaveLength(1);
    await user.type(screen.getByTestId('assist-input'), 'what is stopping work?');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(screen.getAllByTestId('chat-history-entry')).toHaveLength(2));
    const rows = screen.getAllByTestId('chat-history-entry');
    expect(rows[0]).toHaveAttribute('data-chat-id', opened!);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    // Read again once for that chat, not on every render.
    expect(listChatHistory).toHaveBeenCalledTimes(2);
  });

  it('the CLI menu keeps inside a conversation narrowed by the column (review: codex P2)', async () => {
    const opts = [{ key: 'claude', label: 'Claude Code', ok: true, reason: null, signInPath: null, optIn: false }];
    // A 522px window: the dock starts 187px in, and the picker ends 413px in.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const x = this.dataset['testid'] === 'assist-dock' ? 187 : this.classList.contains('wk-chatcli') ? 313 : 0;
      const w = this.dataset['testid'] === 'assist-dock' ? 334 : this.classList.contains('wk-chatcli') ? 100 : 0;
      return { x, y: 0, left: x, top: 0, right: x + w, bottom: 26, width: w, height: 26, toJSON: () => ({}) } as DOMRect;
    });
    const user = userEvent.setup();
    const { unmount } = render(<div data-testid="assist-dock"><ChatCliPicker options={opts} value="claude" onChange={() => undefined} locked={false} /></div>);
    await user.click(screen.getByTestId('chat-cli'));
    // 413 - 187 - 8: the menu ends at the picker and starts 8px inside the dock.
    expect(screen.getByTestId('chat-cli-menu').style.width).toBe('218px');
    unmount();
    // With room for the whole menu it keeps the stylesheet's width.
    vi.restoreAllMocks();
    render(<div data-testid="assist-dock"><ChatCliPicker options={opts} value="claude" onChange={() => undefined} locked={false} /></div>);
    await user.click(screen.getByTestId('chat-cli'));
    expect(screen.getByTestId('chat-cli-menu').style.width).toBe('');
  });

  it('the stylesheet agrees: a 186px column, an overlay only below the column width and on a phone', () => {
    expect(PAST_CHATS_COLUMN_MIN_PX).toBe(520);
    const base = /\n\.wk-chathist \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).toContain('width: 186px');
    expect(base).not.toContain('position: absolute');
    const narrow = /@container \(max-width: ([\d.]+)px\) \{\s*\.wk-chathist \{([^}]*)\}/.exec(css);
    expect(Number(narrow?.[1])).toBeLessThan(PAST_CHATS_COLUMN_MIN_PX);
    expect(Number(narrow?.[1])).toBeGreaterThan(PAST_CHATS_COLUMN_MIN_PX - 1);
    expect(narrow?.[2]).toContain('position: absolute');
    expect(css).toMatch(/\.wk-chatwin--phone \.wk-chathist \{[^}]*position: absolute/);
  });
});

describe('upload (chatAttachments)', () => {
  const file = (name: string, type: string, size = 10): File => new File([new Uint8Array(size)], name, { type });

  it('paperclip attaches as removable chips; the send uploads them to the chat and the message names their ids', async () => {
    uploadChatAttachments.mockResolvedValue({ attachments: [{ id: 'att-1', name: 'shot.png' }], limits: {} });
    // The picker's accept list is a hint to the OS dialog; the check that counts is the send's.
    const user = userEvent.setup({ applyAccept: false });
    dock();
    await user.upload(screen.getByTestId('assist-attach'), [file('shot.png', 'image/png'), file('notes.txt', 'text/plain')]);
    expect(screen.getAllByTestId('assist-file-chip').map((c) => c.textContent)).toEqual(['📎 shot.png×', '📎 notes.txt×']);
    await user.click(screen.getAllByTestId('assist-file-remove')[1]!);
    expect(screen.getAllByTestId('assist-file-chip')).toHaveLength(1);
    await user.type(screen.getByTestId('assist-input'), "what's in this screenshot?");
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const chatId = (openChat.mock.calls[0]![0] as ChatOpenBody).chatId;
    expect(uploadChatAttachments).toHaveBeenCalledWith(chatId, [expect.objectContaining({ name: 'shot.png' })]);
    expect(sendChatMessage.mock.calls[0]![3]).toEqual(['att-1']);
    expect(screen.queryByTestId('assist-file-chip')).toBeNull();
    expect(screen.getByTestId('assist-user-msg')).toHaveTextContent('📎 shot.png');
  });

  it('a pasted screenshot and a dropped file attach too', async () => {
    dock();
    const input = screen.getByTestId('assist-input');
    fireEvent.paste(input, { clipboardData: { files: [file('image.png', 'image/png')], getData: () => '' } });
    expect(screen.getAllByTestId('assist-file-chip')[0]).toHaveTextContent(/pasted-\d{6}\.png/);
    fireEvent.drop(screen.getByTestId('assist-dock'), { dataTransfer: { files: [file('trace.pdf', 'application/pdf')] } });
    expect(screen.getAllByTestId('assist-file-chip').map((c) => c.textContent)).toEqual([expect.stringMatching(/pasted-/), '📎 trace.pdf×']);
  });

  it('a file crew would refuse is refused before anything opens, in plain words; a crew refusal reads in its own', async () => {
    const user = userEvent.setup();
    dock();
    await user.upload(screen.getByTestId('assist-attach'), [file('huge.png', 'image/png', 11 * 1024 * 1024)]);
    await user.type(screen.getByTestId('assist-input'), 'look');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(screen.getAllByTestId('assist-note').some((n) => /huge\.png is 11 MB; one file can be at most 10 MB/.test(n.textContent ?? ''))).toBe(true));
    expect(openChat).not.toHaveBeenCalled();
    expect(uploadChatAttachments).not.toHaveBeenCalled();
  });
});

describe('review round 1 (codex, agy) on part 2', () => {
  const file = (name: string, type: string, body = 'x'): File => new File([body], name, { type });

  it('Everything\'s End keeps history: the close route first, DELETE only where it does not exist (codex #1)', async () => {
    const { endChatKeepingHistory } = await import('../src/store/askDock.js');
    endChat.mockResolvedValueOnce({ ok: true });
    await endChatKeepingHistory('c-1');
    expect(closeChat).not.toHaveBeenCalled();
    endChat.mockRejectedValueOnce(new ApiError(404, 'Not Found'));
    closeChat.mockResolvedValueOnce({ ok: true });
    await endChatKeepingHistory('c-2');
    expect(closeChat).toHaveBeenCalledWith('c-2');
    endChat.mockRejectedValueOnce(new ApiError(500, 'boom'));
    await expect(endChatKeepingHistory('c-3')).rejects.toThrow('boom');
    expect(closeChat).toHaveBeenCalledTimes(1);
  });

  it('a past chat reopened in this browser gets its own chips back; one never seen here claims nothing (codex #2)', async () => {
    const { reopenSystemChat } = await import('../src/store/askDock.js');
    const user = userEvent.setup();
    // A chat opened here with This page and All repos OFF and Memory on.
    dock('/');
    await user.click(screen.getAllByTestId('chat-scope-chip').find((c) => c.getAttribute('data-key') === 'page')!);
    await user.click(screen.getAllByTestId('chat-scope-chip').find((c) => c.getAttribute('data-key') === 'all-repos')!);
    await user.click(screen.getAllByTestId('chat-scope-chip').find((c) => c.getAttribute('data-key') === 'memory')!);
    await user.type(screen.getByTestId('assist-input'), 'first');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const id = (openChat.mock.calls[0]![0] as ChatOpenBody).chatId!;
    cleanup();
    sessionStorage.clear();
    reopenSystemChat({ id, title: 'first', cli: 'claude' });
    getChatMessages.mockResolvedValue({ chat: ENTRY(id, 'open'), messages: [], attachments: [] });
    dock('/');
    const on = (): string[] => screen.getAllByTestId('chat-scope-chip').filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.getAttribute('data-key')!);
    expect(on()).toEqual(['memory']);
    cleanup();
    // Never seen in this browser: every chip off, and the next message claims nothing as chosen.
    reopenSystemChat({ id: 'elsewhere-1', title: 'from another browser', cli: 'claude' });
    getChatMessages.mockResolvedValue({ chat: ENTRY('elsewhere-1', 'open'), messages: [], attachments: [] });
    dock('/');
    expect(on()).toEqual([]);
    await user.type(screen.getByTestId('assist-input'), 'and?');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(sendChatMessage.mock.calls[1]![0]).toBe('elsewhere-1');
    expect(sendChatMessage.mock.calls[1]![1]).toContain('can see (chosen by the user): nothing beyond this message');
    expect(sendChatMessage.mock.calls[1]![1]).not.toContain('where:');
  });

  it('Close while the first open is in flight ends that chat and sends nothing into it (codex #3)', async () => {
    let release: (v: unknown) => void = () => undefined;
    openChat.mockImplementationOnce((body: ChatOpenBody) => new Promise((r) => { release = () => r({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }] }); }));
    const user = userEvent.setup();
    dock();
    await user.type(screen.getByTestId('assist-input'), 'hi');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    endSystemChat();
    await act(async () => { release(undefined); await Promise.resolve(); });
    const id = (openChat.mock.calls[0]![0] as ChatOpenBody).chatId!;
    await waitFor(() => expect(endChat).toHaveBeenCalledWith(id));
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(uploadChatAttachments).not.toHaveBeenCalled();
    expect(readAskSession()).toBeNull();
  });

  it('a file attached while a send is in flight stays for the next one; two files with one name and size are both kept (codex #4, #5)', async () => {
    let release: (v: unknown) => void = () => undefined;
    sendChatMessage.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    uploadChatAttachments.mockResolvedValue({ attachments: [{ id: 'att-1', name: 'a.txt' }], limits: {} });
    const user = userEvent.setup({ applyAccept: false });
    dock();
    await user.upload(screen.getByTestId('assist-attach'), [file('notes.txt', 'text/plain', 'AAAA')]);
    await user.upload(screen.getByTestId('assist-attach'), [file('notes.txt', 'text/plain', 'BBBB')]);
    expect(screen.getAllByTestId('assist-file-chip').map((c) => c.textContent)).toEqual(['📎 notes.txt×', '📎 notes-2.txt×']);
    await user.type(screen.getByTestId('assist-input'), 'read these');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect((uploadChatAttachments.mock.calls[0]![1] as File[]).length).toBe(2);
    fireEvent.drop(screen.getByTestId('assist-dock'), { dataTransfer: { files: [file('later.pdf', 'application/pdf')] } });
    await act(async () => { release({ seats: ['claude'] }); await Promise.resolve(); });
    await waitFor(() => expect(screen.getAllByTestId('assist-file-chip').map((c) => c.textContent)).toEqual(['📎 later.pdf×']));
  });

  it('pasted words with a preview image still type; a pasted screenshot alone attaches (agy #3)', () => {
    dock();
    const input = screen.getByTestId('assist-input');
    fireEvent.paste(input, { clipboardData: { files: [file('image.png', 'image/png')], getData: (t: string) => (t === 'text/plain' ? 'Q3 revenue' : '') } });
    expect(screen.queryByTestId('assist-file-chip')).toBeNull();
    fireEvent.paste(input, { clipboardData: { files: [file('image.png', 'image/png')], getData: () => '' } });
    expect(screen.getAllByTestId('assist-file-chip')).toHaveLength(1);
  });

  it('a past chat whose history replays but whose seats are gone has ENDED: the transcript stays (agy #1)', async () => {
    writeAskSession({ chatId: 'c-7', title: 'q', seeded: true });
    getChatMessages.mockResolvedValue({ chat: ENTRY('c-7', 'open'), messages: [{ at: 1, turnId: 't', kind: 'user', text: 'q', seats: [] }], attachments: [] });
    getChat.mockResolvedValue({ chatId: 'c-7', seats: [] });
    dock();
    await waitFor(() => expect(screen.getAllByTestId('assist-note').some((n) => /This chat has ended/.test(n.textContent ?? ''))).toBe(true));
    expect(screen.getAllByTestId('assist-chat-msg')).toHaveLength(1);
  });

  it('a history read that fails (not 404) says it could not tell and keeps the session (agy #1)', async () => {
    writeAskSession({ chatId: 'c-8', title: 'q', seeded: true });
    getChatMessages.mockRejectedValue(new ApiError(503, 'store busy'));
    dock();
    await waitFor(() => expect(screen.getAllByTestId('assist-note').some((n) => /Could not check your earlier session/.test(n.textContent ?? ''))).toBe(true));
    expect(getChat).not.toHaveBeenCalled();
    expect(readAskSession()?.chatId).toBe('c-8');
  });

  it('a crew refusal of an upload reads in crew\'s own words (agy #6)', async () => {
    uploadChatAttachments.mockRejectedValue(new ApiError(415, 'unsupported media type', { error: 'trace.bin is not an image, UTF-8 text or a pdf', code: 'attachment_type' }));
    const user = userEvent.setup({ applyAccept: false });
    dock();
    await user.upload(screen.getByTestId('assist-attach'), [file('trace.txt', 'text/plain')]);
    await user.type(screen.getByTestId('assist-input'), 'look');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(screen.getAllByTestId('assist-note').some((n) => (n.textContent ?? '').includes('The upload was refused — trace.bin is not an image, UTF-8 text or a pdf'))).toBe(true));
    expect(sendChatMessage).not.toHaveBeenCalled();
  });
});
