import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

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
}

interface LiveChatsState {
  sessions: Record<string, LiveChatSession>;
  /** Authoritative deposit — a session this client opened or rejoined. */
  upsert: (chatId: string, seats: string[]) => void;
  /** The session was ended (Close / End) or the daemon said chatClosed. */
  remove: (chatId: string) => void;
  /** Fold one /ws frame — chat frames announce and retire sessions. */
  ingest: (event: CoreEvent) => void;
}

const CHAT_FRAME_TYPES = new Set(['chatSessionReady', 'chatDelta', 'chatReply']);

export const useLiveChatsStore = create<LiveChatsState>((set) => ({
  sessions: {},
  upsert: (chatId, seats) =>
    set((s) => {
      const prev = s.sessions[chatId];
      const merged = prev ? [...prev.seats] : [];
      for (const k of seats) if (!merged.includes(k)) merged.push(k);
      return {
        sessions: {
          ...s.sessions,
          [chatId]: { chatId, seats: merged, lastSeenAt: Date.now() },
        },
      };
    }),
  remove: (chatId) =>
    set((s) => {
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
          [frame.chat]: { chatId: frame.chat, seats, lastSeenAt: Date.now() },
        },
      };
    }),
}));
