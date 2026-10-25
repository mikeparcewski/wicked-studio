import { create } from 'zustand';
import { chatChoices, forgetAskSession, readAskSession, writeAskSession } from './askSession.js';
import { useCapabilities } from './capabilities.js';
import { useChatWindow } from './chatWindow.js';

/**
 * Opening the Ask dock from anywhere (DES-frontdoor concept A: the Desk's composer is gone, so
 * "Chat", ⌘K "New chat", a project's "Chat in this project" and "New demo" open the one real chat,
 * the Ask dock, instead of seeding a Desk composer). A request carries the project the chat should
 * be scoped to (a fresh chat; `null` = the dock's own default) and words to put in its box, unsent.
 * App mounts the dock; it reads the request once per open (`nonce` remounts it).
 */
export interface AskRequest {
  nonce: number;
  /** A fresh chat scoped to this project; `null` = resume the dock's chat with its default scope. */
  projectId: string | null;
  /** Words placed in the dock's box, never sent. */
  seedText: string;
  /** A new chat even without a project (the Desk's Chat): the dock's stored chat is not resumed. */
  fresh: boolean;
}

interface AskDockStore {
  request: AskRequest | null;
  open: (opts?: { projectId?: string | null; seedText?: string; fresh?: boolean }) => void;
}

export const useAskDock = create<AskDockStore>((set, get) => ({
  request: null,
  open: (opts = {}) => set({
    request: { nonce: (get().request?.nonce ?? 0) + 1, projectId: opts.projectId ?? null, seedText: opts.seedText ?? '', fresh: opts.fresh === true || (opts.projectId ?? null) !== null },
  }),
}));

/** Open the Ask dock (a real chat); nothing is sent. */
export function openAskDock(opts?: { projectId?: string | null; seedText?: string; fresh?: boolean }): void {
  useAskDock.getState().open(opts);
}

// ── The system chat's lifecycle (DES-SYSTEM-CHAT §3) ──────────────────────────────────────────

let endEpoch = 0;
/** Bumped by every {@link endSystemChat}: a send that settles after its chat was ended must not
 *  re-persist the ended session (AskDock compares the epoch it mounted with). */
export function systemChatEpoch(): number {
  return endEpoch;
}

/**
 * The rail's Chat icon: a minimized chat comes back, an open one stays as it is, and a closed one
 * starts a NEW chat in the project on screen.
 */
export function openSystemChat(projectId: string | null): void {
  const win = useChatWindow.getState();
  if (win.mode === 'minimized') { win.restore(); return; }
  if (win.mode === 'floating' || win.mode === 'full') return;
  openAskDock({ fresh: true, projectId });
}

/**
 * Close: END the chat. The stored session is forgotten, so nothing resumes it — the next Chat starts a
 * new one — and the window closes. The conversation itself is not deleted: it stays on its session page
 * (and, on a crew with the chat list, in past chats).
 */
export function endSystemChat(): void {
  endEpoch += 1;
  const ending = readAskSession()?.chatId ?? null;
  forgetAskSession();
  useChatWindow.getState().close();
  // On a crew that keeps history (`chatList`), Close ENDS the chat there too — its seats released, its
  // history kept (`POST /chats/:id/close`, never DELETE, which also deletes it). An older crew is sent
  // nothing: its idle reaper ends the chat, and its session page keeps the conversation.
  if (ending !== null && useCapabilities.getState().chatList) {
    void import('../api/client.js').then(({ api }) => api.endChat(ending)).catch(() => undefined);
  }
}

/**
 * Past chats: reopen one. Its id becomes the stored session (seeded — its context already rode), and
 * the dock remounts to resume it; it replays from the kept history, an ended chat read-only.
 */
export function reopenSystemChat(entry: { id: string; title: string; cli: string | null }): void {
  // What this browser remembers of the chat's choices comes back with it; with no record, nothing is
  // claimed as chosen (the dock starts every chip off) and the next message carries a fresh pack.
  const known = chatChoices(entry.id);
  writeAskSession({
    chatId: entry.id, title: entry.title, seeded: true,
    ...(entry.cli !== null ? { cli: entry.cli } : {}),
    ...(known !== null ? known : { chipsUnknown: true as const }),
  });
  useAskDock.getState().open({});
}

/**
 * End a live chat for good from a list (Everything › live chats' End): the close route first, which
 * keeps its history; DELETE only where that route does not exist (404 — an older crew, where DELETE is
 * the only end there is). Never decided on a capability read that has not answered.
 */
export async function endChatKeepingHistory(chatId: string): Promise<void> {
  const { api } = await import('../api/client.js');
  const { apiStatus } = await import('../api/errors.js');
  await api.endChat(chatId).catch((e: unknown) => (apiStatus(e) === 404 ? api.closeChat(chatId) : Promise.reject(e)));
}
