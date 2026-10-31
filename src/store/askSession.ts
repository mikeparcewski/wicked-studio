import type { ChatScope } from '../api/types.js';
import type { ScopeChip } from '../board/chatScopes.js';

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
  /** The scope the daemon RESOLVED at open (studio#323 R4) — restated on reopen instead of a scope
   *  select. `null`/absent = not stated (a daemon predating scope, or a session saved before this
   *  field). */
  scope?: ChatScope | null;
  /** The system chat's scope chips at open (DES-SYSTEM-CHAT §6) — a reopened chat shows them. */
  chips?: ScopeChip[];
  /** The CLI that answers this chat (DES-SYSTEM-CHAT §5). */
  cli?: string;
  /** What the last pack that LANDED carried (its chips and page); absent = unknown, so the next
   *  message carries a fresh one. */
  packSig?: string;
  /** The diagnostics have ridden a pack that landed (they ride the first one carrying This page). */
  diagSent?: boolean;
  /** Reopened from past chats with no record of its choices in this browser: no chip is claimed. */
  chipsUnknown?: true;
}

export const ASK_SESSION_KEY = 'wicked.ask.session';

/** `key`: whose session — the system chat's ({@link ASK_SESSION_KEY}, the default) or a page chat's
 *  (`pageChatSessionKey`): each page keeps its own conversation. */
export function readAskSession(key: string = ASK_SESSION_KEY): AskSession | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<AskSession> | null;
    if (parsed === null || typeof parsed.chatId !== 'string' || parsed.chatId === '') return null;
    return {
      chatId: parsed.chatId,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      seeded: parsed.seeded === true,
      scope: isChatScope(parsed.scope) ? parsed.scope : null,
      ...(Array.isArray(parsed.chips) ? { chips: parsed.chips.filter(isChip) } : {}),
      ...(typeof parsed.cli === 'string' && parsed.cli !== '' ? { cli: parsed.cli } : {}),
      ...(typeof parsed.packSig === 'string' ? { packSig: parsed.packSig } : {}),
      ...(parsed.diagSent === true ? { diagSent: true } : {}),
      ...(parsed.chipsUnknown === true ? { chipsUnknown: true as const } : {}),
    };
  } catch {
    return null;
  }
}

export function writeAskSession(session: AskSession, key: string = ASK_SESSION_KEY): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    /* storage unavailable — the session still works, it just is not resumable */
  }
}

/** Forget the persisted session — only when it IS `chatId` (absent ⇒ unconditionally). */
export function forgetAskSession(chatId?: string, key: string = ASK_SESSION_KEY): void {
  try {
    if (chatId !== undefined && readAskSession(key)?.chatId !== chatId) return;
    sessionStorage.removeItem(key);
  } catch {
    /* nothing to forget */
  }
}

/** A stored scope is trusted only in its wire shape (a `kind` string and a `repos` array). */
function isChatScope(v: unknown): v is ChatScope {
  return v !== null && typeof v === 'object'
    && typeof (v as { kind?: unknown }).kind === 'string'
    && Array.isArray((v as { repos?: unknown }).repos);
}

function isChip(v: unknown): v is ScopeChip {
  const c = v as Partial<ScopeChip> | null;
  return c !== null && typeof c === 'object' && typeof c.key === 'string' && typeof c.kind === 'string'
    && typeof c.label === 'string' && typeof c.on === 'boolean';
}

// ── Per-chat choices (DES-SYSTEM-CHAT §4): a past chat reopened in this browser gets back what the user
// chose for it — its chips, resolved scope, CLI and what its last pack carried — not today's defaults.

export const CHAT_CHOICES_KEY = 'wicked.chat.choices.v1';
const CHOICES_CAP = 50;

export type ChatChoices = Pick<AskSession, 'chips' | 'scope' | 'cli' | 'packSig' | 'diagSent'>;

function readChoices(): Record<string, ChatChoices & { at: number }> {
  try {
    const raw = localStorage.getItem(CHAT_CHOICES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, ChatChoices & { at: number }> : {};
  } catch {
    return {};
  }
}

/** Remember one chat's choices (the newest 50 chats are kept). */
export function rememberChatChoices(chatId: string, choices: ChatChoices): void {
  try {
    const all = readChoices();
    all[chatId] = { ...choices, at: Date.now() };
    const keep = Object.entries(all).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, CHOICES_CAP);
    localStorage.setItem(CHAT_CHOICES_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* storage unavailable: a reopened chat starts with nothing claimed */
  }
}

/** One chat's remembered choices, or `null` when this browser never saw them. */
export function chatChoices(chatId: string): ChatChoices | null {
  const hit = readChoices()[chatId];
  if (hit === undefined) return null;
  const chips = Array.isArray(hit.chips) ? hit.chips.filter(isChip) : undefined;
  return {
    ...(chips !== undefined ? { chips } : {}),
    ...(isChatScope(hit.scope) ? { scope: hit.scope } : {}),
    ...(typeof hit.cli === 'string' ? { cli: hit.cli } : {}),
    ...(typeof hit.packSig === 'string' ? { packSig: hit.packSig } : {}),
    ...(hit.diagSent === true ? { diagSent: true } : {}),
  };
}
