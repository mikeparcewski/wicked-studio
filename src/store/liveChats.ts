import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';
import { forgetAskSession } from './askSession.js';

/**
 * Live chat sessions THIS CLIENT knows about (BRIEF-UX-001 round 2, J4):
 * the sidebar's Chat accordion must never claim "no chats" beside a live
 * conversation — but the rail's zero-request budget forbids it a GET /chats
 * on mount. So the sessions the app already learned about for free are
 * event-sourced here:
 *
 *   - GroupChat deposits the session it MINTS or REJOINS (it made those
 *     wire calls anyway) and retracts on End;
 *   - the app-level /ws fold deposits sessions announced by their own
 *     frames (chatSessionReady / chatDelta / chatReply) and retracts on
 *     chatClosed — the same evidence ChatsPage folds into its live band.
 *
 * This is deliberately NOT a mirror of the daemon's pool (that is GET
 * /chats, read by /chats on navigation): a session another tab opened
 * before this page loaded stays invisible here until a frame arrives.
 * The rail therefore renders this store as "live now" evidence, never as
 * the complete census — /chats remains the census surface.
 */
export interface LiveChatSession {
  chatId: string;
  /** Seats observed for this session, first-seen order. */
  seats: string[];
  /** When this client last saw evidence of the session (ms epoch). */
  lastSeenAt: number;
  /** Which surface opened it (studio#323 R2) — absent when only a frame announced it. */
  origin?: LiveChatOrigin;
  /** A human handle — the first question asked — when the opener knew one. */
  title?: string;
}

export type LiveChatOrigin = 'ask' | 'chat';

export interface LiveChatMeta {
  origin?: LiveChatOrigin;
  title?: string;
}

interface LiveChatsState {
  sessions: Record<string, LiveChatSession>;
  /** Authoritative deposit — a session this client opened or rejoined. `meta`
   *  fills only what is not yet known (first write wins). */
  upsert: (chatId: string, seats: string[], meta?: LiveChatMeta) => void;
  /** The session was ended (Close / End) or the daemon said chatClosed. */
  remove: (chatId: string) => void;
  /** Fold one /ws frame — chat frames announce and retire sessions. */
  ingest: (event: CoreEvent) => void;
}

const CHAT_FRAME_TYPES = new Set(['chatSessionReady', 'chatDelta', 'chatReply']);

export const useLiveChatsStore = create<LiveChatsState>((set) => ({
  sessions: {},
  upsert: (chatId, seats, meta) =>
    set((s) => {
      const prev = s.sessions[chatId];
      const merged = prev ? [...prev.seats] : [];
      for (const k of seats) if (!merged.includes(k)) merged.push(k);
      // Meta is FIRST-WRITE-WINS: the surface that opened the session names it,
      // and a later deposit (a rejoin, a promote into the full chat, a frame)
      // never relabels an Ask chat as a Chat chat or swaps its first question.
      const origin = prev?.origin ?? meta?.origin;
      const title = prev?.title ?? meta?.title;
      return {
        sessions: {
          ...s.sessions,
          [chatId]: {
            chatId, seats: merged, lastSeenAt: Date.now(),
            ...(origin !== undefined ? { origin } : {}),
            ...(title !== undefined ? { title } : {}),
          },
        },
      };
    }),
  remove: (chatId) =>
    set((s) => {
      forgetAskSession(chatId);
      if (!(chatId in s.sessions)) return s;
      const next = { ...s.sessions };
      delete next[chatId];
      return { sessions: next };
    }),
  ingest: (event) =>
    set((s) => {
      const frame = event as { type: string; chat?: string; cliKey?: string };
      if (typeof frame.chat !== 'string' || frame.chat === '') return s;
      if (frame.type === 'chatClosed') {
        forgetAskSession(frame.chat);
        if (!(frame.chat in s.sessions)) return s;
        const next = { ...s.sessions };
        delete next[frame.chat];
        return { sessions: next };
      }
      if (!CHAT_FRAME_TYPES.has(frame.type)) return s;
      const prev = s.sessions[frame.chat];
      const seats = prev ? [...prev.seats] : [];
      if (frame.cliKey && !seats.includes(frame.cliKey)) seats.push(frame.cliKey);
      return {
        sessions: {
          ...s.sessions,
          [frame.chat]: { ...prev, chatId: frame.chat, seats, lastSeenAt: Date.now() },
        },
      };
    }),
}));
