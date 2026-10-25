import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const { AskDock } = await import('../src/components/AskDock.js');
const { setCachedRoster, clearCachedRoster } = await import('../src/store/rosterCache.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useLiveChatsStore } = await import('../src/store/liveChats.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { endSystemChat, useAskDock } = await import('../src/store/askDock.js');
const { readAskSession, writeAskSession } = await import('../src/store/askSession.js');
const { resetChatWindow, useChatWindow } = await import('../src/store/chatWindow.js');

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
    fireEvent.paste(input, { clipboardData: { files: [file('image.png', 'image/png')] } });
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
