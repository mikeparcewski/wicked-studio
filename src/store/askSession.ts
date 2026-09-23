/**
 * The Ask dock's ACTIVE chat session, persisted for the tab (studio#323 R3).
 *
 * The dock mounts only while open (App renders `{askOpen && <AskDock/>}`), so an
 * id held in a per-mount ref died on every close — the next open ran a fresh
 * `POST /chats` while the previous session stayed warm on the daemon, orphaned.
 * The id (plus the first question, the session's human handle on /chats) lives
 * in sessionStorage instead: closing and reopening Ask — or reloading the tab —
 * resumes the SAME session. Every access is wrapped: storage can be absent or
 * throw (private mode, blocked site data), and Ask must still work, just without
 * memory across a close.
 */

export interface AskSession {
  chatId: string;
  /** The first question asked in this session — its handle on the Chats page. */
  title: string;
  /** True once a message carrying the context pack LANDED — until then a resumed
   *  session still owes the pack to its next send. */
  seeded: boolean;
}

export const ASK_SESSION_KEY = 'wicked.ask.session';

export function readAskSession(): AskSession | null {
  try {
    const raw = sessionStorage.getItem(ASK_SESSION_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<AskSession> | null;
    if (parsed === null || typeof parsed.chatId !== 'string' || parsed.chatId === '') return null;
    return {
      chatId: parsed.chatId,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      seeded: parsed.seeded === true,
    };
  } catch {
    return null;
  }
}

export function writeAskSession(session: AskSession): void {
  try {
    sessionStorage.setItem(ASK_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — the session still works, it just is not resumable */
  }
}

/** Forget the persisted session — only when it IS `chatId` (absent ⇒ unconditionally). */
export function forgetAskSession(chatId?: string): void {
  try {
    if (chatId !== undefined && readAskSession()?.chatId !== chatId) return;
    sessionStorage.removeItem(ASK_SESSION_KEY);
  } catch {
    /* nothing to forget */
  }
}
