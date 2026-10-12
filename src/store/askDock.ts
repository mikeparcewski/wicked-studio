import { create } from 'zustand';

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
}

interface AskDockStore {
  request: AskRequest | null;
  open: (opts?: { projectId?: string | null; seedText?: string }) => void;
}

export const useAskDock = create<AskDockStore>((set, get) => ({
  request: null,
  open: (opts = {}) => set({
    request: { nonce: (get().request?.nonce ?? 0) + 1, projectId: opts.projectId ?? null, seedText: opts.seedText ?? '' },
  }),
}));

/** Open the Ask dock (a real chat); nothing is sent. */
export function openAskDock(opts?: { projectId?: string | null; seedText?: string }): void {
  useAskDock.getState().open(opts);
}
