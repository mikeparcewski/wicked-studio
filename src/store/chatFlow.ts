import { create } from 'zustand';
import { useSessionDrafts } from './sessionDrafts.js';

/**
 * THE CHAT FLOW (operator 2026-10-16: "it should bring to chat flow"; "No option in new job modal for
 * just starting with chat"). A chat lives on its own session page, `/s/<chatId>` — the same page every
 * chat has once it is going — so starting one goes THERE, not to the Ask side dock.
 *
 * `openChatFlow` is the one way in: New job's "Start with chat" card, the "Don't show this again —
 * start in chat" box, and a New job while that choice is saved. It mints the chat's id up front and
 * marks it FRESH (no message yet, nothing opened on the daemon); App navigates to its page. The
 * session page shows a fresh chat as "New chat" with its composer; the first Send opens the chat on
 * the daemon under that same id (AskDock's send, `sendOpenChatId`), so the address never changes, and
 * `chatOpened` retires the mark. Words the opener brings wait in the composer, unsent.
 *
 * Fresh marks live in sessionStorage too, so a reload of the empty page is still a new chat.
 */
export interface FreshChat {
  /** The project the chat starts in; null = not in a project. */
  projectId: string | null;
}

export interface ChatFlowRequest {
  nonce: number;
  chatId: string;
}

interface ChatFlowStore {
  /** The latest open: App navigates to its page once per nonce. */
  request: ChatFlowRequest | null;
  fresh: Readonly<Record<string, FreshChat>>;
  /** Fresh chats whose first Send is being opened on the daemon (codex r1: one open per chat — a second
   *  Send waits for it). In memory only: a reload forgets an open in flight. */
  opening: Readonly<Record<string, true>>;
}

const FRESH_KEY = 'studio.chat.fresh';

function readFresh(): Record<string, FreshChat> {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(FRESH_KEY) ?? '{}');
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, FreshChat> = {};
    for (const [id, f] of Object.entries(v as Record<string, unknown>)) {
      const p = (f as { projectId?: unknown } | null)?.projectId;
      out[id] = { projectId: typeof p === 'string' && p !== '' ? p : null };
    }
    return out;
  } catch { return {}; }
}

function writeFresh(fresh: Record<string, FreshChat>): void {
  try { sessionStorage.setItem(FRESH_KEY, JSON.stringify(fresh)); } catch { /* private mode: this tab only */ }
}

export const useChatFlow = create<ChatFlowStore>(() => ({ request: null, fresh: readFresh(), opening: {} }));

function newChatId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Start a chat on its own page: a new chat id, marked fresh, and App goes to `/s/<id>`. */
export function openChatFlow(opts: { projectId?: string | null; seedText?: string } = {}): string {
  const chatId = newChatId();
  const projectId = opts.projectId !== undefined && opts.projectId !== null && opts.projectId !== '' && opts.projectId !== 'default' ? opts.projectId : null;
  const fresh = { ...useChatFlow.getState().fresh, [chatId]: { projectId } };
  writeFresh(fresh);
  const seed = opts.seedText ?? '';
  if (seed.trim() !== '') useSessionDrafts.getState().setDraft(chatId, seed);
  useChatFlow.setState((s) => ({ fresh, request: { nonce: (s.request?.nonce ?? 0) + 1, chatId } }));
  return chatId;
}

/** The fresh chat this id names (opened by `openChatFlow`, no message sent yet), or null. */
export function freshChat(chatId: string): FreshChat | null {
  return useChatFlow.getState().fresh[chatId] ?? null;
}

/** A fresh chat's first Send was handed over: its open is in flight. False when one already is. */
export function beginChatOpen(chatId: string): boolean {
  if (useChatFlow.getState().opening[chatId] === true) return false;
  useChatFlow.setState((s) => ({ opening: { ...s.opening, [chatId]: true } }));
  return true;
}

/** The open failed (the Ask panel says why): the page's Send is free again. */
export function chatOpenFailed(chatId: string): void {
  if (useChatFlow.getState().opening[chatId] !== true) return;
  useChatFlow.setState((s) => { const opening = { ...s.opening }; delete opening[chatId]; return { opening }; });
}

/** The daemon opened the chat (or a read found it live): it is an ordinary chat from here on. */
export function chatOpened(chatId: string): void {
  const { fresh: cur, opening: busy } = useChatFlow.getState();
  if (!(chatId in cur) && busy[chatId] !== true) return;
  const fresh = { ...cur };
  delete fresh[chatId];
  const opening = { ...busy };
  delete opening[chatId];
  writeFresh(fresh);
  useChatFlow.setState({ fresh, opening });
}

/** Test hook. */
export function resetChatFlow(): void {
  writeFresh({});
  useChatFlow.setState({ request: null, fresh: {}, opening: {} });
}
