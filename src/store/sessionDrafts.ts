import { create } from 'zustand';

/**
 * Per-session view state that must survive switching sessions and coming back (R4): the
 * composer's unsent draft and the thread's scroll position. In memory for the tab's life — a
 * reload starts clean, like every other composer in studio.
 */
interface SessionDraftsStore {
  drafts: Record<string, string>;
  scroll: Record<string, number>;
  setDraft: (sessionId: string, text: string) => void;
  setScroll: (sessionId: string, top: number) => void;
  /** Forget the saved place: the thread is back at its newest message and a later visit opens there. */
  clearScroll: (sessionId: string) => void;
}

export const useSessionDrafts = create<SessionDraftsStore>((set) => ({
  drafts: {},
  scroll: {},
  setDraft: (sessionId, text) => set((s) => ({ drafts: { ...s.drafts, [sessionId]: text } })),
  setScroll: (sessionId, top) => set((s) => ({ scroll: { ...s.scroll, [sessionId]: top } })),
  clearScroll: (sessionId) => set((s) => {
    if (!(sessionId in s.scroll)) return s;
    const rest = { ...s.scroll };
    delete rest[sessionId];
    return { scroll: rest };
  }),
}));
