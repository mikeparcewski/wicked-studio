import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-SYSTEM-CHAT §2–3: the system chat window's geometry (default, clamped into the viewport,
 * remembered across reloads) and its state machine (floating · full size · minimized · closed, the
 * tray's status, and Close as the only thing that ENDS the chat).
 */

const {
  CHAT_MIN_H, CHAT_MIN_W, CHAT_WINDOW_KEY, clampGeometry, clampTray, defaultGeometry, defaultTray, loadChatWindow,
  resetChatWindow, setSystemChatOpen, toggleSystemChat, TRAY_H, TRAY_W, useChatWindow,
} = await import('../src/store/chatWindow.js');
const { endSystemChat, openSystemChat, systemChatEpoch, useAskDock } = await import('../src/store/askDock.js');
const { readAskSession, writeAskSession } = await import('../src/store/askSession.js');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetChatWindow();
});

describe('geometry', () => {
  it('defaults to 600 × 700 at the bottom right, inside the edges', () => {
    expect(defaultGeometry(1440, 900)).toEqual({ x: 1440 - 600 - 16, y: 900 - 700 - 16, w: 600, h: 700 });
  });

  it('a viewport shorter than the default gets a shorter window that still fits (1440 × 700)', () => {
    const g = defaultGeometry(1440, 700);
    expect(g.h).toBe(700 - 32);
    expect(g.y).toBe(16);
    expect(g.y + g.h).toBeLessThanOrEqual(700);
  });

  it('clamps a window dragged off any edge back inside the viewport', () => {
    expect(clampGeometry({ x: -300, y: -50, w: 600, h: 500 }, 1440, 700)).toEqual({ x: 0, y: 0, w: 600, h: 500 });
    expect(clampGeometry({ x: 1300, y: 600, w: 600, h: 500 }, 1440, 700)).toEqual({ x: 840, y: 200, w: 600, h: 500 });
  });

  it('never smaller than 420 × 420, never larger than the viewport', () => {
    expect(clampGeometry({ x: 10, y: 10, w: 100, h: 50 }, 1440, 900)).toMatchObject({ w: CHAT_MIN_W, h: CHAT_MIN_H });
    expect(clampGeometry({ x: 0, y: 0, w: 5000, h: 5000 }, 1440, 700)).toEqual({ x: 0, y: 0, w: 1440, h: 700 });
  });

  it('a viewport smaller than the minimum gets the whole viewport (390 × 844)', () => {
    expect(clampGeometry({ x: 50, y: 50, w: 600, h: 700 }, 390, 844)).toEqual({ x: 0, y: 50, w: 390, h: 700 });
  });

  it('a stored geometry the viewport shrank under is pulled back in', () => {
    // Remembered at 1920 × 1080, reopened at 1440 × 700.
    const g = clampGeometry({ x: 1300, y: 360, w: 600, h: 700 }, 1440, 700);
    expect(g.x + g.w).toBeLessThanOrEqual(1440);
    expect(g.y + g.h).toBeLessThanOrEqual(700);
    expect(g.y).toBeGreaterThanOrEqual(0);
  });

  it('non-numbers never reach the style', () => {
    expect(clampGeometry({ x: Number.NaN, y: Infinity, w: Number.NaN, h: Number.NaN }, 1440, 900)).toEqual({ x: 0, y: 0, w: 600, h: 700 });
  });

  it('the tray defaults bottom right and stays inside the viewport', () => {
    expect(defaultTray(1440, 700)).toEqual({ x: 1440 - TRAY_W - 16, y: 700 - TRAY_H - 16 });
    expect(clampTray({ x: 5000, y: -40 }, 1440, 700)).toEqual({ x: 1440 - TRAY_W, y: 0 });
  });

  it('remembers the geometry and the tray across a reload, and reads corrupt storage as "never moved"', () => {
    useChatWindow.getState().setGeometry({ x: 100, y: 40, w: 640, h: 560 });
    useChatWindow.getState().setTray({ x: 20, y: 600 });
    expect(loadChatWindow()).toEqual({ geometry: { x: 100, y: 40, w: 640, h: 560 }, tray: { x: 20, y: 600 } });
    localStorage.setItem(CHAT_WINDOW_KEY, '{not json');
    expect(loadChatWindow()).toEqual({ geometry: null, tray: null });
    localStorage.setItem(CHAT_WINDOW_KEY, JSON.stringify({ geometry: { x: 'a', y: 1, w: 2, h: 3 }, tray: { x: 1 } }));
    expect(loadChatWindow()).toEqual({ geometry: null, tray: null });
  });

  it('works without storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      expect(() => useChatWindow.getState().setGeometry({ x: 1, y: 2, w: 500, h: 500 })).not.toThrow();
      expect(useChatWindow.getState().geometry).toEqual({ x: 1, y: 2, w: 500, h: 500 });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the state machine', () => {
  const s = () => useChatWindow.getState();

  it('open → floating; full size ⇄ restore', () => {
    s().open();
    expect(s().mode).toBe('floating');
    s().toggleFull();
    expect(s().mode).toBe('full');
    s().restore();
    expect(s().mode).toBe('floating');
  });

  it('minimize keeps the chat (not closed) and restores to the size it had — floating or full', () => {
    s().open();
    s().toggleFull();
    s().minimize();
    expect(s().mode).toBe('minimized');
    s().restore();
    expect(s().mode).toBe('full');
    s().toggleFull();
    s().minimize();
    s().open(); // the rail's Chat / any open() restores a minimized chat
    expect(s().mode).toBe('floating');
  });

  it('the tray says "answer ready" only for an answer that landed while it was minimized', () => {
    s().open();
    s().setStatus('thinking');
    s().setStatus('answered');
    expect(s().status).toBe('ready'); // seen in the window
    s().setStatus('thinking');
    s().minimize();
    expect(s().status).toBe('thinking');
    s().setStatus('answered');
    expect(s().status).toBe('answered');
    s().restore();
    expect(s().status).toBe('ready');
  });

  it('Ctrl/⌘+Shift+A: open → minimized → back → minimized; closed → open', () => {
    toggleSystemChat();
    expect(s().mode).toBe('floating');
    toggleSystemChat();
    expect(s().mode).toBe('minimized');
    toggleSystemChat();
    expect(s().mode).toBe('floating');
    setSystemChatOpen(false);
    expect(s().mode).toBe('closed');
  });

  it('Close ENDS the chat: the stored session is forgotten, the epoch moves, the window closes', () => {
    writeAskSession({ chatId: 'c-1', title: 'hi', seeded: true });
    s().open();
    s().minimize();
    const epoch = systemChatEpoch();
    endSystemChat();
    expect(readAskSession()).toBeNull();
    expect(systemChatEpoch()).toBe(epoch + 1);
    expect(s().mode).toBe('closed');
  });

  it('taking the window off screen (a chat stepping aside) does NOT end it', () => {
    writeAskSession({ chatId: 'c-2', title: 'hi', seeded: true });
    s().open();
    setSystemChatOpen(false);
    expect(readAskSession()?.chatId).toBe('c-2');
  });

  it('the rail\'s Chat: restores a minimized chat, leaves an open one, starts a new one when closed', () => {
    const before = useAskDock.getState().request?.nonce ?? 0;
    s().open();
    s().minimize();
    openSystemChat('p-1');
    expect(s().mode).toBe('floating');
    openSystemChat('p-1');
    expect(useAskDock.getState().request?.nonce ?? 0).toBe(before);
    s().close();
    openSystemChat('p-1');
    expect(useAskDock.getState().request).toMatchObject({ nonce: before + 1, projectId: 'p-1', fresh: true });
  });
});
