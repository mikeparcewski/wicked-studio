import { create } from 'zustand';
import type { LaunchBodyWithDeliver } from '../api/types.js';
import type { LaunchAssuranceNotice } from '../board/launchModel.js';

/**
 * (studio#1239) A launch crew answered with an `assuranceNotice` (`POST /runs` → 201: the run started under full
 * assurance with no seat that can judge another's work, so it will hold at a gate that needs a judge). The composer and
 * the inline start go straight to the job's session, so the notice is kept here, by the sessions that show the run (its
 * own and the chat it went into), and that session page says it with the explicit, confirmed relaunch in reduced assurance.
 * Kept for this tab only: a reload drops it (the run's gate still says what it waits for).
 */
export interface LaunchNoticeEntry {
  runId: string;
  notice: LaunchAssuranceNotice;
  /** The launch as sent: the relaunch is this body merged with the notice's `retryWith`. */
  body: LaunchBodyWithDeliver;
}

interface LaunchNoticesStore {
  bySession: Record<string, LaunchNoticeEntry>;
  /** Runs whose relaunch is in flight: one relaunch per notice, across remounts and the run's two sessions. */
  relaunching: Record<string, true>;
  /** Claim a run's relaunch; false when one is already in flight. */
  beginRelaunch: (runId: string) => boolean;
  endRelaunch: (runId: string) => void;
  /** Keep a launch's notice for the sessions that show its run: its own (`run:<runId>`) and the chat it went into. */
  put: (entry: LaunchNoticeEntry, chatId?: string | null) => void;
  /** Drop a run's notice wherever it is kept (a newer launch's notice in the same chat stays). */
  drop: (runId: string) => void;
}

export const useLaunchNotices = create<LaunchNoticesStore>((set, get) => ({
  bySession: {},
  relaunching: {},
  beginRelaunch: (runId) => {
    if (get().relaunching[runId] === true) return false;
    set((s) => ({ relaunching: { ...s.relaunching, [runId]: true } }));
    return true;
  },
  endRelaunch: (runId) => set((s) => {
    const { [runId]: _done, ...rest } = s.relaunching;
    void _done;
    return { relaunching: rest };
  }),
  put: (entry, chatId) => set((s) => ({
    bySession: { ...s.bySession, [`run:${entry.runId}`]: entry, ...(typeof chatId === 'string' && chatId !== '' ? { [chatId]: entry } : {}) },
  })),
  drop: (runId) => set((s) => ({ bySession: Object.fromEntries(Object.entries(s.bySession).filter(([, e]) => e.runId !== runId)) })),
}));
