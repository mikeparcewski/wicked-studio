import { create } from 'zustand';

/**
 * THE SYSTEM CHAT WINDOW (DES-SYSTEM-CHAT §2–3): where the one app-wide chat (the Ask dock) sits and
 * how big it is. Pure geometry helpers plus one store; the window component (`ChatWindow`) draws it.
 *
 *  - `floating` — a window, about 600 × 700 by default, dragged by its header and resized from its
 *    corner (min 420 × 420), always kept inside the viewport;
 *  - `full` — fills the content area beside the rail; restore returns to the last floating geometry;
 *  - `minimized` — a small tray, bottom right by default and draggable. The dock stays MOUNTED (hidden),
 *    so the conversation keeps running and the tray can say "thinking…" / "answer ready";
 *  - `closed` — nothing drawn. Only the header's or the tray's Close ENDS the chat (`endSystemChat`,
 *    AskDock); the window merely moving to `closed` (a chat stepping aside onto its own page) does not.
 *
 * The floating geometry and the tray's spot persist per browser (localStorage, try/catch: it works
 * without storage). The mode does not: a reload starts with the chat closed.
 */

export type ChatWindowMode = 'closed' | 'floating' | 'full' | 'minimized';
/** What the tray says about the conversation: idle, an answer on its way, or one landed while hidden. */
export type ChatStatus = 'ready' | 'thinking' | 'answered';

export interface ChatGeometry { x: number; y: number; w: number; h: number }
export interface ChatPoint { x: number; y: number }

export const CHAT_MIN_W = 420;
export const CHAT_MIN_H = 420;
export const CHAT_DEFAULT_W = 600;
export const CHAT_DEFAULT_H = 700;
/** The gap a default-placed window or tray keeps from the viewport's edges. */
export const CHAT_EDGE_PX = 16;
export const TRAY_W = 300;
export const TRAY_H = 52;

export const CHAT_WINDOW_KEY = 'wicked.chat.window.v1';

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** The default floating window: 600 × 700 (smaller when the viewport is), bottom right, inside the edges. */
export function defaultGeometry(vw: number, vh: number): ChatGeometry {
  const w = Math.max(0, Math.min(CHAT_DEFAULT_W, vw - 2 * CHAT_EDGE_PX));
  const h = Math.max(0, Math.min(CHAT_DEFAULT_H, vh - 2 * CHAT_EDGE_PX));
  return { x: Math.max(0, vw - w - CHAT_EDGE_PX), y: Math.max(0, vh - h - CHAT_EDGE_PX), w, h };
}

/**
 * A geometry kept inside the viewport: never smaller than the minimum (unless the viewport itself is),
 * never larger than the viewport, and positioned so every edge — the header above all — stays on screen.
 */
export function clampGeometry(g: ChatGeometry, vw: number, vh: number): ChatGeometry {
  const finite = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);
  const w = Math.round(clamp(finite(g.w, CHAT_DEFAULT_W), Math.min(CHAT_MIN_W, vw), vw));
  const h = Math.round(clamp(finite(g.h, CHAT_DEFAULT_H), Math.min(CHAT_MIN_H, vh), vh));
  return { x: Math.round(clamp(finite(g.x, 0), 0, vw - w)), y: Math.round(clamp(finite(g.y, 0), 0, vh - h)), w, h };
}

/** The tray's default spot: bottom right. */
export function defaultTray(vw: number, vh: number): ChatPoint {
  return { x: Math.max(0, vw - TRAY_W - CHAT_EDGE_PX), y: Math.max(0, vh - TRAY_H - CHAT_EDGE_PX) };
}

/** The tray kept wholly inside the viewport. */
export function clampTray(p: ChatPoint, vw: number, vh: number): ChatPoint {
  const w = Math.min(TRAY_W, vw);
  return { x: Math.round(clamp(Number.isFinite(p.x) ? p.x : 0, 0, vw - w)), y: Math.round(clamp(Number.isFinite(p.y) ? p.y : 0, 0, vh - TRAY_H)) };
}

interface Persisted { geometry: ChatGeometry | null; tray: ChatPoint | null }

function isGeometry(v: unknown): v is ChatGeometry {
  const g = v as Partial<ChatGeometry> | null;
  return g !== null && typeof g === 'object' && [g.x, g.y, g.w, g.h].every((n) => typeof n === 'number' && Number.isFinite(n));
}
function isPoint(v: unknown): v is ChatPoint {
  const p = v as Partial<ChatPoint> | null;
  return p !== null && typeof p === 'object' && [p.x, p.y].every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** The remembered geometry and tray spot; anything unreadable reads as "never moved". */
export function loadChatWindow(): Persisted {
  try {
    const raw = globalThis.localStorage?.getItem(CHAT_WINDOW_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
    return { geometry: isGeometry(parsed.geometry) ? parsed.geometry : null, tray: isPoint(parsed.tray) ? parsed.tray : null };
  } catch {
    return { geometry: null, tray: null };
  }
}

function save(p: Persisted): void {
  try { globalThis.localStorage?.setItem(CHAT_WINDOW_KEY, JSON.stringify(p)); } catch { /* storage unavailable: this page only */ }
}

interface ChatWindowStore {
  mode: ChatWindowMode;
  /** The mode a minimized chat restores to (floating or full). */
  restoreTo: 'floating' | 'full';
  /** The last floating geometry the user chose; `null` = the default for the viewport. */
  geometry: ChatGeometry | null;
  /** The tray's spot; `null` = bottom right. */
  tray: ChatPoint | null;
  status: ChatStatus;
  /** The answering CLI's name, for the tray. */
  cli: string | null;
  /** Show the window: a closed chat opens floating, a minimized one restores; an open one stays. */
  open: () => void;
  minimize: () => void;
  /** Minimized → back to how it was; full → floating. */
  restore: () => void;
  /** Floating ⇄ full size. */
  toggleFull: () => void;
  /** Nothing drawn. Ending the conversation is the caller's (`endSystemChat`). */
  close: () => void;
  setGeometry: (g: ChatGeometry) => void;
  setTray: (p: ChatPoint) => void;
  setStatus: (s: ChatStatus) => void;
  setCli: (label: string | null) => void;
}

const initial = loadChatWindow();

export const useChatWindow = create<ChatWindowStore>((set, get) => ({
  mode: 'closed',
  restoreTo: 'floating',
  geometry: initial.geometry,
  tray: initial.tray,
  status: 'ready',
  cli: null,
  open: () => {
    const { mode } = get();
    if (mode === 'closed') set({ mode: 'floating', status: 'ready' });
    else if (mode === 'minimized') get().restore();
  },
  minimize: () => {
    const { mode } = get();
    if (mode === 'floating' || mode === 'full') {
      // An answer that already landed was seen; the tray says "answer ready" only for one that lands now.
      const status = get().status === 'answered' ? 'ready' : get().status;
      set({ mode: 'minimized', restoreTo: mode, status });
    }
  },
  restore: () => {
    const { mode, restoreTo, status } = get();
    if (mode === 'minimized') set({ mode: restoreTo, status: status === 'answered' ? 'ready' : status });
    else if (mode === 'full') set({ mode: 'floating', restoreTo: 'floating' });
  },
  toggleFull: () => {
    const { mode } = get();
    if (mode === 'floating') set({ mode: 'full', restoreTo: 'full' });
    else if (mode === 'full') set({ mode: 'floating', restoreTo: 'floating' });
  },
  close: () => set({ mode: 'closed', restoreTo: 'floating', status: 'ready' }),
  setGeometry: (geometry) => {
    set({ geometry });
    save({ geometry, tray: get().tray });
  },
  setTray: (tray) => {
    set({ tray });
    save({ geometry: get().geometry, tray });
  },
  setStatus: (status) => {
    // While the window shows the conversation, a landed answer is simply read: only a hidden one is news.
    if (status === 'answered' && get().mode !== 'minimized') { set({ status: 'ready' }); return; }
    set({ status });
  },
  setCli: (cli) => set({ cli }),
}));

/** Test hook: back to a closed chat with nothing remembered. */
export function resetChatWindow(): void {
  try { globalThis.localStorage?.removeItem(CHAT_WINDOW_KEY); } catch { /* stubbed */ }
  useChatWindow.setState({ mode: 'closed', restoreTo: 'floating', geometry: null, tray: null, status: 'ready', cli: null });
}

/** Ctrl/⌘+Shift+A and the phone's chat bubble: an open chat minimizes (it keeps running), a minimized
 *  one comes back, a closed one opens. */
export function toggleSystemChat(): void {
  const s = useChatWindow.getState();
  if (s.mode === 'floating' || s.mode === 'full') s.minimize();
  else s.open();
}

/** Show the chat (a closed one opens, a minimized one comes back) or take it off screen. Taking it off
 *  screen does not END it — `endSystemChat` does. */
export function setSystemChatOpen(next: boolean): void {
  if (next) useChatWindow.getState().open();
  else useChatWindow.getState().close();
}
