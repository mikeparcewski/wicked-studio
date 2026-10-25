import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import {
  clampGeometry,
  clampTray,
  defaultGeometry,
  defaultTray,
  TRAY_H,
  TRAY_W,
  useChatWindow,
  type ChatGeometry,
  type ChatPoint,
} from '../../store/chatWindow.js';

/**
 * THE SYSTEM CHAT WINDOW (DES-SYSTEM-CHAT §2–3) — the frame the one app-wide chat (AskDock) sits in.
 *
 *  - floating: a window at the remembered geometry (about 600 × 700 the first time, bottom right),
 *    dragged by its header and resized from its bottom-right corner (min 420 × 420), never outside the
 *    viewport — a resize of the browser pulls it back in;
 *  - full size: fills the content area beside the rail; restore returns to the floating geometry;
 *  - minimized: the dock stays mounted but hidden (the conversation keeps running) and a small tray,
 *    bottom right by default and draggable, says which CLI and how it is doing, with Restore and Close;
 *  - on a phone the window is the whole screen (no drag, no resize, no full-size toggle).
 *
 * The header lives in the dock (it holds the dock's own title and CLI picker), so the window hands the
 * dock its drag handle and its window controls through {@link ChatChromeContext}.
 */

export interface ChatChrome {
  /** Spread onto the dock's header: it is the drag handle while floating. */
  dragProps: React.HTMLAttributes<HTMLDivElement> & { 'data-drag-handle'?: string | undefined };
  /** Minimize · full size/restore · close, for the header's end. */
  controls: React.ReactNode;
  phone: boolean;
}

export const ChatChromeContext = createContext<ChatChrome | null>(null);

/** The window's chrome, when the dock sits in one (absent in a bare render). */
export function useChatChrome(): ChatChrome | null {
  return useContext(ChatChromeContext);
}

function useViewport(): { vw: number; vh: number } {
  const [size, setSize] = useState(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  useEffect(() => {
    const on = (): void => setSize({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/** A press that should not start a drag: the header's own buttons, menus and fields. */
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="menu"], [role="listbox"], [data-no-drag]';

/** Track one pointer drag on window, calling `onMove` with the total delta and `onEnd` at release. */
function trackDrag(e: React.PointerEvent, onMove: (dx: number, dy: number) => void, onEnd: () => void): void {
  const sx = e.clientX;
  const sy = e.clientY;
  const move = (ev: PointerEvent): void => onMove(ev.clientX - sx, ev.clientY - sy);
  const up = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.style.userSelect = '';
    onEnd();
  };
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

const KEY_STEP = 20;

export function ChatWindow({ phone, railPx, onEnd, children }: {
  phone: boolean;
  /** The rail's width: full size fills the content area beside it. */
  railPx: number;
  /** Close: END the chat (`endSystemChat`). */
  onEnd: () => void;
  /** The dock. Mounted while the chat is open or minimized. */
  children: React.ReactNode;
}): React.ReactElement | null {
  const mode = useChatWindow((s) => s.mode);
  const stored = useChatWindow((s) => s.geometry);
  const storedTray = useChatWindow((s) => s.tray);
  const status = useChatWindow((s) => s.status);
  const cli = useChatWindow((s) => s.cli);
  const { vw, vh } = useViewport();

  // While a drag or resize is under way the window follows the pointer locally; the store (and storage)
  // take the geometry once, at release.
  const [live, setLive] = useState<ChatGeometry | null>(null);
  const [liveTray, setLiveTray] = useState<ChatPoint | null>(null);
  const liveRef = useRef<ChatGeometry | null>(null);
  const liveTrayRef = useRef<ChatPoint | null>(null);
  const geometry = clampGeometry(live ?? stored ?? defaultGeometry(vw, vh), vw, vh);
  const tray = clampTray(liveTray ?? storedTray ?? defaultTray(vw, vh), vw, vh);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  const commit = useCallback(() => {
    const g = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (g !== null) useChatWindow.getState().setGeometry(g);
  }, []);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (phone || mode !== 'floating' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE) !== null) return;
    e.preventDefault();
    const start = geometryRef.current;
    trackDrag(e, (dx, dy) => {
      const next = clampGeometry({ ...start, x: start.x + dx, y: start.y + dy }, window.innerWidth, window.innerHeight);
      liveRef.current = next;
      setLive(next);
    }, commit);
  };

  const onResizePointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = geometryRef.current;
    trackDrag(e, (dx, dy) => {
      const next = clampGeometry({ ...start, w: start.w + dx, h: start.h + dy }, window.innerWidth, window.innerHeight);
      liveRef.current = next;
      setLive(next);
    }, commit);
  };

  const onResizeKey = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    const d = { ArrowRight: [KEY_STEP, 0], ArrowLeft: [-KEY_STEP, 0], ArrowDown: [0, KEY_STEP], ArrowUp: [0, -KEY_STEP] }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const g = geometryRef.current;
    useChatWindow.getState().setGeometry(clampGeometry({ ...g, w: g.w + d[0]!, h: g.h + d[1]! }, vw, vh));
  };

  const onTrayPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE) !== null) return;
    e.preventDefault();
    const start = tray;
    trackDrag(e, (dx, dy) => {
      const next = clampTray({ x: start.x + dx, y: start.y + dy }, window.innerWidth, window.innerHeight);
      liveTrayRef.current = next;
      setLiveTray(next);
    }, () => {
      const p = liveTrayRef.current;
      liveTrayRef.current = null;
      setLiveTray(null);
      if (p !== null) useChatWindow.getState().setTray(p);
    });
  };

  if (mode === 'closed') return null;
  const visible = mode !== 'minimized';
  const full = mode === 'full';
  const store = useChatWindow.getState();

  const controls = (
    <span className="wk-chatwin-controls" data-no-drag>
      <button type="button" data-testid="chat-minimize" className="wk-chatwin-btn" aria-label="Minimize chat" title="Minimize (the chat keeps running)" onClick={() => store.minimize()}>
        <Minus size={15} aria-hidden />
      </button>
      {!phone && (
        <button type="button" data-testid="chat-fullsize" className="wk-chatwin-btn" aria-pressed={full} aria-label={full ? 'Restore chat size' : 'Full size'} title={full ? 'Restore' : 'Full size'} onClick={() => store.toggleFull()}>
          {full ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
        </button>
      )}
      <button type="button" data-testid="chat-close" className="wk-chatwin-btn" aria-label="Close chat (ends it)" title="Close — ends this chat" onClick={onEnd}>
        <X size={15} aria-hidden />
      </button>
    </span>
  );

  const frameStyle: React.CSSProperties = phone
    ? { position: 'fixed', inset: 0 }
    : full
      ? { position: 'fixed', left: railPx, top: 0, right: 0, bottom: 0 }
      : { position: 'fixed', left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h };

  const statusWord = status === 'thinking' ? 'thinking…' : status === 'answered' ? 'answer ready' : 'ready';

  return (
    <ChatChromeContext.Provider value={{ dragProps: { onPointerDown: onHeaderPointerDown, 'data-drag-handle': phone || full ? undefined : 'true' }, controls, phone }}>
      <div
        {...(visible ? { 'data-testid': 'ask-panel', role: 'dialog', 'aria-label': 'Chat' } : { hidden: true, 'aria-hidden': true })}
        data-chat-mode={mode}
        className={`wk-chatwin${full ? ' wk-chatwin--full' : ''}${phone ? ' wk-chatwin--phone' : ''}`}
        style={{ ...frameStyle, display: visible ? 'flex' : 'none' }}
      >
        {children}
        {visible && !phone && !full && (
          <button
            type="button"
            data-testid="chat-resize"
            className="wk-chatwin-resize"
            aria-label="Resize chat (arrow keys)"
            title="Drag to resize"
            onPointerDown={onResizePointerDown}
            onKeyDown={onResizeKey}
          />
        )}
      </div>
      {!visible && (
        <div
          data-testid="chat-tray"
          data-status={status}
          role="region"
          aria-label="Chat, minimized"
          className="wk-chattray"
          style={{ position: 'fixed', left: tray.x, top: tray.y, width: Math.min(TRAY_W, vw), height: TRAY_H }}
          onPointerDown={onTrayPointerDown}
        >
          <span aria-hidden className={`wk-chattray-dot wk-chattray-dot--${status}`} />
          <span className="wk-chattray-words">
            <span className="wk-chattray-cli">{cli ?? 'Chat'}</span>
            <span data-testid="chat-tray-status" className="wk-chattray-status" role="status">{statusWord}</span>
          </span>
          <button type="button" data-testid="chat-tray-restore" className="wk-chattray-btn" onClick={() => store.restore()}>Restore</button>
          <button type="button" data-testid="chat-tray-close" className="wk-chattray-btn wk-chattray-btn--icon" aria-label="Close chat (ends it)" title="Close — ends this chat" onClick={onEnd}>
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
    </ChatChromeContext.Provider>
  );
}
