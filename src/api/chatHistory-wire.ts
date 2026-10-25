import type { ChatTranscriptRecord } from 'wicked-crew-api-types';

/**
 * The system chat's history, Close and attachments wire (DES-SYSTEM-CHAT "Crew"; wicked-crew#1140,
 * `wicked-crew-api-types` 0.137.0). A VERBATIM mirror of the contract block while studio's pin
 * (0.128.0) lags the release: when the pin moves, these become re-exports from the package (as
 * `skills-wire.ts` did) and this mirror goes. Gated by `GET /health.capabilities.chatList` /
 * `.chatAttachments`: an older daemon is never sent any of it.
 */

/** The page a chat was started on: studio's route and its human label ("Run 9b43ee44"). */
export interface ChatStartedOn {
  route: string;
  label: string;
}

/** One past or open system chat, as the history list shows it. */
export interface ChatHistoryEntry {
  /** The chat id: `GET /chats/:id/messages` reopens it, `POST /chats/:id/close` ends it. */
  id: string;
  /** The first operator message, whitespace-collapsed and cut at 80 characters (an ellipsis
   *  included); "New chat" before the first message. */
  title: string;
  /** Where the chat was started, when the opener said (`ChatOpenBody.startedOn`); else `null`. */
  startedOn: ChatStartedOn | null;
  /** The CLI that answers; `null` when none was seated. */
  cli: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601 of the newest message (or of the open, before any). */
  updatedAt: string;
  /** Operator messages plus seat replies. */
  messageCount: number;
  /** Files uploaded to the chat. */
  attachmentCount: number;
  /** `open`: live on this daemon; `closed`: ended (Close, idle, or a daemon restart), history kept. */
  status: 'open' | 'closed';
  /** ISO-8601 of the end; present with `status: 'closed'`. */
  closedAt?: string;
}

/** `GET /chats?limit=&cursor=&status=` → 200 (the live `chats` rows ride beside the page). */
export interface ChatHistoryPage {
  items?: ChatHistoryEntry[];
  nextCursor?: string | null;
}

/** What an attachment is to a seat: an image (png, jpeg, gif, webp), text (UTF-8), or a pdf. */
export type ChatAttachmentKind = 'image' | 'text' | 'pdf';

/** One uploaded file. */
export interface ChatAttachment {
  id: string;
  chatId: string;
  /** The uploaded file name, sanitized (no path). */
  name: string;
  /** The verified media type (`image/png`, `text/plain`, `application/pdf`, …). */
  mediaType: string;
  kind: ChatAttachmentKind;
  bytes: number;
  sha256: string;
  /** ISO-8601. */
  createdAt: string;
}

/** `GET /chats/:id/messages` → 200 (404 for an id with no history). */
export interface ChatMessagesResponse {
  chat: ChatHistoryEntry;
  messages: ChatTranscriptRecord[];
  attachments: ChatAttachment[];
}

/** `POST /chats/:id/close` → 200: ended, its history and attachments kept. Idempotent. */
export interface ChatCloseResponse {
  ok: true;
  chat: ChatHistoryEntry;
}

/** The caps an upload and a message are held to (also on every 413). */
export interface ChatAttachmentLimits {
  maxFileBytes: number;
  maxMessageBytes: number;
  maxFiles: number;
  mediaTypes: string[];
}

/** `POST /chats/:id/attachments` (multipart/form-data, one or more file parts) → 201. */
export interface ChatAttachmentUploadResponse {
  attachments: ChatAttachment[];
  limits: ChatAttachmentLimits;
}

/** An upload or a send refused over an attachment (413 / 415 / 404 / 400). */
export interface ChatAttachmentError {
  error: string;
  code: 'attachment_too_large' | 'attachments_too_large' | 'attachment_type' | 'attachment_unknown' | 'attachment_malformed';
  name?: string;
  bytes?: number;
  limits: ChatAttachmentLimits;
}

/** The documented caps, for the client's own check before an upload (the daemon still decides). */
export const CHAT_ATTACHMENT_LIMITS: ChatAttachmentLimits = {
  maxFileBytes: 10 * 1024 * 1024,
  maxMessageBytes: 20 * 1024 * 1024,
  maxFiles: 10,
  mediaTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/*', 'application/pdf'],
};
