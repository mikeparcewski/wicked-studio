import { create } from 'zustand';
import { pageChatSessionKey, type PageChatKind, type PageFocus } from '../board/pageChat.js';
import { forgetAskSession, writeAskSession } from './askSession.js';

/**
 * Each page chat's state (DES-LEARN §6.2): open or not (remembered per page), the item the next question is
 * about, words put in its box (or sent, when the person pressed a page's own Ask: Understand's box, an
 * evaluation's "Analyze this run"), and a generation that a New chat bumps.
 *
 * A seed is never sent on its own: `send` is set only by a press the person made on words they typed or an
 * action that names what it asks ("Analyze this run"). Clicking a number puts a question in the box, unsent.
 */

export interface PageChatSeed {
  nonce: number;
  text: string;
  /** Send it now (the person pressed Ask on it); otherwise it waits in the box. */
  send: boolean;
}

interface PageChatState {
  open: Partial<Record<PageChatKind, boolean>>;
  focus: Partial<Record<PageChatKind, PageFocus | null>>;
  seed: Partial<Record<PageChatKind, PageChatSeed | null>>;
  gen: Partial<Record<PageChatKind, number>>;
  /** Open the page's chat; with `focus`, the next question is about that item; with `text`, it is in the box. */
  ask: (kind: PageChatKind, opts?: { focus?: PageFocus | null; text?: string; send?: boolean; fresh?: boolean }) => void;
  setOpen: (kind: PageChatKind, open: boolean) => void;
  clearFocus: (kind: PageChatKind) => void;
  /** The seed was taken by the composer. */
  tookSeed: (kind: PageChatKind, nonce: number) => void;
  /** Start a new conversation on this page (the old one stays in past chats). */
  fresh: (kind: PageChatKind) => void;
  /** Show a past conversation of this page (Understand's Recent answers). */
  resume: (kind: PageChatKind, chatId: string, title: string) => void;
}

const openKey = (kind: PageChatKind): string => `wicked.pagechat.${kind}.open`;

/** Was this page's chat left open (default closed: a page opens it with Ask)? */
export function storedOpen(kind: PageChatKind): boolean {
  try { return localStorage.getItem(openKey(kind)) === 'true'; } catch { return false; }
}

function saveOpen(kind: PageChatKind, open: boolean): void {
  try { localStorage.setItem(openKey(kind), String(open)); } catch { /* forgets across reloads, still works */ }
}

let nonce = 0;
const epochs: Partial<Record<PageChatKind, number>> = {};

/** Bumped by every New chat on the page: a send that settles after it must not re-persist the old chat. */
export function pageChatEpoch(kind: PageChatKind): number {
  return epochs[kind] ?? 0;
}

export const usePageChat = create<PageChatState>((set) => ({
  open: {},
  focus: {},
  seed: {},
  gen: {},
  ask: (kind, opts = {}) => {
    if (opts.fresh === true) {
      epochs[kind] = (epochs[kind] ?? 0) + 1;
      forgetAskSession(undefined, pageChatSessionKey(kind));
    }
    saveOpen(kind, true);
    set((s) => ({
      open: { ...s.open, [kind]: true },
      ...(opts.focus !== undefined ? { focus: { ...s.focus, [kind]: opts.focus } } : {}),
      ...(opts.text !== undefined ? { seed: { ...s.seed, [kind]: { nonce: (nonce += 1), text: opts.text, send: opts.send === true } } } : {}),
      ...(opts.fresh === true ? { gen: { ...s.gen, [kind]: (s.gen[kind] ?? 0) + 1 } } : {}),
    }));
  },
  setOpen: (kind, open) => {
    saveOpen(kind, open);
    set((s) => ({ open: { ...s.open, [kind]: open } }));
  },
  clearFocus: (kind) => set((s) => ({ focus: { ...s.focus, [kind]: null } })),
  tookSeed: (kind, n) => set((s) => (s.seed[kind]?.nonce === n ? { seed: { ...s.seed, [kind]: null } } : s)),
  fresh: (kind) => {
    epochs[kind] = (epochs[kind] ?? 0) + 1;
    forgetAskSession(undefined, pageChatSessionKey(kind));
    set((s) => ({ gen: { ...s.gen, [kind]: (s.gen[kind] ?? 0) + 1 }, focus: { ...s.focus, [kind]: null } }));
  },
  resume: (kind, chatId, title) => {
    epochs[kind] = (epochs[kind] ?? 0) + 1;
    writeAskSession({ chatId, title, seeded: true }, pageChatSessionKey(kind));
    saveOpen(kind, true);
    set((s) => ({ open: { ...s.open, [kind]: true }, gen: { ...s.gen, [kind]: (s.gen[kind] ?? 0) + 1 }, focus: { ...s.focus, [kind]: null } }));
  },
}));

/** Is `kind`'s chat open (the stored preference until this tab says otherwise)? */
export function usePageChatOpen(kind: PageChatKind): boolean {
  return usePageChat((s) => s.open[kind] ?? storedOpen(kind));
}

// ── The page on screen that hosts a chat ────────────────────────────────────────────────────────

/** What a page hands its chat: its scope sentence, its data (read at send time), and the moves only it can make. */
export interface PageChatProvider {
  /** "Knows this page: 4 numbers, the throughput chart, 35 jobs behind them." */
  knows: string;
  data: () => string[];
  /** A "What next?" move only the page can make (re-check, draft rules…); true when it made it. */
  onMove?: (move: import('../board/pageChat.js').NextMove, focus: PageFocus | null) => boolean;
  /** A message was sent into the page's chat (Understand lists its questions under Recent answers). */
  onSent?: (text: string, chatId: string) => void;
  /** Evaluate: how many uncovered behaviours the analysed evaluation has (offers Draft rules). */
  gaps?: (focus: PageFocus | null) => number;
}

interface PageChatHostState {
  host: { kind: PageChatKind; id: number; provider: { current: PageChatProvider } } | null;
  /** The scope sentence, kept apart so the header re-renders when it changes. */
  knows: string;
  register: (kind: PageChatKind, provider: { current: PageChatProvider }) => number;
  unregister: (id: number) => void;
  setKnows: (id: number, knows: string) => void;
}

let hostSeq = 0;

export const usePageChatHost = create<PageChatHostState>((set, get) => ({
  host: null,
  knows: '',
  register: (kind, provider) => {
    const id = (hostSeq += 1);
    set({ host: { kind, id, provider }, knows: provider.current.knows });
    return id;
  },
  unregister: (id) => { if (get().host?.id === id) set({ host: null, knows: '' }); },
  setKnows: (id, knows) => { if (get().host?.id === id && get().knows !== knows) set({ knows }); },
}));
