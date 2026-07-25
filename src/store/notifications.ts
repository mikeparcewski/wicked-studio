import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/**
 * A global notification kind discriminating what triggered the notification.
 *
 * - `gate`            — a run is awaiting a human decision
 * - `run_failed`      — a run terminated with a failure
 * - `steer_requested` — an agent sent an `agentMessage` asking for direction
 */
export type NotifKind = 'gate' | 'run_failed' | 'steer_requested';

/** One notification entry. `id` and `ts` are generated on ingestion. */
interface Notification {
  id: string;
  kind: NotifKind;
  runId: string;
  message: string;
  ts: number;
  read: boolean;
}

const MAX_NOTIFICATIONS = 10;

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Array.from({ length: 36 }, (_, i) =>
    [8, 13, 18, 23].includes(i) ? '-' : Math.floor(Math.random() * 16).toString(16),
  ).join('');
}

interface NotificationStore {
  notifications: Notification[];
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Fold one CoreEvent into the notification list (same entry-point pattern as gates.ingest). */
  ingest: (event: CoreEvent) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  markRead: (id) =>
    set((s) => {
      const idx = s.notifications.findIndex((n) => n.id === id);
      if (idx === -1) return s;
      const target = s.notifications[idx];
      if (!target || target.read) return s;
      const next = [...s.notifications];
      next[idx] = { ...target, read: true };
      return { notifications: next };
    }),

  markAllRead: () =>
    set((s) => {
      if (s.notifications.every((n) => n.read)) return s;
      return { notifications: s.notifications.map((n) => ({ ...n, read: true })) };
    }),

  ingest: (event) => {
    const session = typeof event.session === 'string' ? event.session : undefined;
    if (session === undefined) return;

    set((s) => {
      switch (event.type) {
        case 'awaitingHuman': {
          const entry: Notification = {
            id: uuid(),
            kind: 'gate',
            runId: session,
            message:
              typeof event.prompt === 'string' && event.prompt
                ? event.prompt
                : 'Run is awaiting human review',
            ts: Date.now(),
            read: false,
          };
          return { notifications: [entry, ...s.notifications].slice(0, MAX_NOTIFICATIONS) };
        }
        case 'sessionFailed': {
          const entry: Notification = {
            id: uuid(),
            kind: 'run_failed',
            runId: session,
            message:
              typeof event.message === 'string' && event.message
                ? event.message
                : 'Run failed',
            ts: Date.now(),
            read: false,
          };
          return { notifications: [entry, ...s.notifications].slice(0, MAX_NOTIFICATIONS) };
        }
        case 'agentMessage': {
          const entry: Notification = {
            id: uuid(),
            kind: 'steer_requested',
            runId: session,
            message:
              typeof event.message === 'string' && event.message
                ? event.message
                : 'Agent is requesting direction',
            ts: Date.now(),
            read: false,
          };
          return { notifications: [entry, ...s.notifications].slice(0, MAX_NOTIFICATIONS) };
        }
        default:
          return s;
      }
    });
  },
}));
