import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';

/**
 * DES-SYSTEM-CHAT §2–3: the window around the system chat — floating at its geometry, dragged by
 * the header and resized from the corner (kept in the viewport, remembered), full size beside the
 * rail, minimized to a tray that keeps the conversation mounted, and Close that ends it.
 */

const { ChatWindow, useChatChrome } = await import('../src/components/chat/ChatWindow.js');
const { CHAT_WINDOW_KEY, resetChatWindow, useChatWindow } = await import('../src/store/chatWindow.js');

/** A stand-in dock: a header carrying the window's drag handle and controls, and a mount counter. */
let mounts = 0;
function FakeDock(): React.ReactElement {
  const chrome = useChatChrome();
  useEffect(() => { mounts += 1; }, []);
  return (
    <div data-testid="fake-dock">
      <div data-testid="fake-header" {...chrome?.dragProps}>
        <span>Chat</span>
        <button type="button" data-testid="fake-header-button">picker</button>
        {chrome?.controls}
      </div>
    </div>
  );
}

function setViewport(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

function win(props: { phone?: boolean; onEnd?: () => void } = {}): void {
  render(<ChatWindow phone={props.phone ?? false} railPx={236} onEnd={props.onEnd ?? (() => undefined)}><FakeDock /></ChatWindow>);
}

const panel = (): HTMLElement => screen.getByTestId('ask-panel');

/** jsdom has no PointerEvent constructor; a MouseEvent of the pointer type carries clientX/Y and button. */
function pointer(target: EventTarget, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  act(() => { target.dispatchEvent(ev); });
}

beforeEach(() => {
  localStorage.clear();
  resetChatWindow();
  setViewport(1440, 900);
  mounts = 0;
});
afterEach(() => cleanup());

describe('the chat window', () => {
  it('draws nothing while the chat is closed', () => {
    win();
    expect(screen.queryByTestId('ask-panel')).toBeNull();
    expect(screen.queryByTestId('chat-tray')).toBeNull();
  });

  it('opens floating at the larger default, bottom right', () => {
    act(() => useChatWindow.getState().open());
    win();
    expect(panel().dataset.chatMode).toBe('floating');
    expect(panel().style.width).toBe('600px');
    expect(panel().style.height).toBe('700px');
    expect(panel().style.left).toBe(`${1440 - 600 - 16}px`);
    expect(panel().style.top).toBe(`${900 - 700 - 16}px`);
    expect(screen.getByTestId('fake-header')).toHaveAttribute('data-drag-handle', 'true');
  });

  it('drags by the header, stays in the viewport, and remembers where it was left', () => {
    act(() => useChatWindow.getState().open());
    win();
    const header = screen.getByTestId('fake-header');
    pointer(header, 'pointerdown', 1000, 200);
    pointer(window, 'pointermove', 400, 150);
    expect(panel().style.left).toBe(`${824 - 600}px`);
    expect(panel().style.top).toBe(`${184 - 50}px`);
    // Far past the top-left corner: pulled back to the edge.
    pointer(window, 'pointermove', -2000, -2000);
    expect(panel().style.left).toBe('0px');
    expect(panel().style.top).toBe('0px');
    pointer(window, 'pointerup', -2000, -2000);
    expect(JSON.parse(localStorage.getItem(CHAT_WINDOW_KEY)!).geometry).toEqual({ x: 0, y: 0, w: 600, h: 700 });
  });

  it('a press on a header button never starts a drag', () => {
    act(() => useChatWindow.getState().open());
    win();
    pointer(screen.getByTestId('fake-header-button'), 'pointerdown', 1000, 200);
    pointer(window, 'pointermove', 100, 100);
    pointer(window, 'pointerup', 100, 100);
    expect(panel().style.left).toBe(`${1440 - 600 - 16}px`);
    expect(localStorage.getItem(CHAT_WINDOW_KEY)).toBeNull();
  });

  it('resizes from the corner, never below 420 × 420, and by keyboard', () => {
    act(() => useChatWindow.getState().open());
    win();
    const grip = screen.getByTestId('chat-resize');
    pointer(grip, 'pointerdown', 1400, 880);
    pointer(window, 'pointermove', 900, 500);
    pointer(window, 'pointerup', 900, 500);
    expect(panel().style.width).toBe('420px');
    expect(panel().style.height).toBe('420px');
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(panel().style.width).toBe('440px');
    expect(useChatWindow.getState().geometry).toMatchObject({ w: 440, h: 420 });
  });

  it('a browser resize pulls a remembered window back inside', () => {
    useChatWindow.getState().setGeometry({ x: 800, y: 150, w: 600, h: 700 });
    act(() => useChatWindow.getState().open());
    win();
    act(() => { setViewport(1000, 700); window.dispatchEvent(new Event('resize')); });
    const left = parseInt(panel().style.left, 10);
    const top = parseInt(panel().style.top, 10);
    expect(left + 600).toBeLessThanOrEqual(1000);
    expect(top + 700).toBeLessThanOrEqual(700);
  });

  it('full size fills the content area beside the rail, and restore returns to the floating geometry', () => {
    useChatWindow.getState().setGeometry({ x: 300, y: 40, w: 500, h: 600 });
    act(() => useChatWindow.getState().open());
    win();
    fireEvent.click(screen.getByTestId('chat-fullsize'));
    expect(panel().dataset.chatMode).toBe('full');
    expect(panel().style.left).toBe('236px');
    expect(panel().style.right).toBe('0px');
    expect(panel().style.top).toBe('0px');
    expect(panel().style.bottom).toBe('0px');
    expect(screen.getByTestId('chat-fullsize')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('chat-resize')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-fullsize'));
    expect(panel().style.left).toBe('300px');
    expect(panel().style.width).toBe('500px');
  });

  it('minimize: the tray shows the CLI and its status, the dock stays MOUNTED (the chat keeps running), restore brings it back', () => {
    act(() => { useChatWindow.getState().open(); useChatWindow.getState().setCli('Claude Code'); });
    win();
    expect(mounts).toBe(1);
    fireEvent.click(screen.getByTestId('chat-minimize'));
    expect(screen.queryByTestId('ask-panel')).toBeNull();
    expect(screen.getByTestId('fake-dock')).toBeInTheDocument(); // hidden, not unmounted
    const tray = screen.getByTestId('chat-tray');
    expect(tray).toHaveTextContent('Claude Code');
    expect(screen.getByTestId('chat-tray-status')).toHaveTextContent('ready');
    act(() => useChatWindow.getState().setStatus('thinking'));
    expect(screen.getByTestId('chat-tray-status')).toHaveTextContent('thinking…');
    act(() => useChatWindow.getState().setStatus('answered'));
    expect(screen.getByTestId('chat-tray-status')).toHaveTextContent('answer ready');
    expect(tray).toHaveAttribute('data-status', 'answered');
    fireEvent.click(screen.getByTestId('chat-tray-restore'));
    expect(panel().dataset.chatMode).toBe('floating');
    expect(mounts).toBe(1); // the same dock, never remounted
  });

  it('the tray drags and remembers its spot; it starts bottom right', () => {
    act(() => { useChatWindow.getState().open(); useChatWindow.getState().minimize(); });
    win();
    const tray = screen.getByTestId('chat-tray');
    expect(tray.style.left).toBe(`${1440 - 300 - 16}px`);
    expect(tray.style.top).toBe(`${900 - 52 - 16}px`);
    pointer(tray, 'pointerdown', 1200, 860);
    pointer(window, 'pointermove', 200, 100);
    pointer(window, 'pointerup', 200, 100);
    expect(tray.style.left).toBe(`${1124 - 1000}px`);
    expect(tray.style.top).toBe('72px');
    expect(JSON.parse(localStorage.getItem(CHAT_WINDOW_KEY)!).tray).toEqual({ x: 124, y: 72 });
  });

  it('Close — in the header or on the tray — ends the chat', () => {
    const onEnd = vi.fn();
    act(() => useChatWindow.getState().open());
    win({ onEnd });
    fireEvent.click(screen.getByTestId('chat-close'));
    expect(onEnd).toHaveBeenCalledTimes(1);
    cleanup();
    act(() => useChatWindow.getState().minimize());
    win({ onEnd });
    fireEvent.click(screen.getByTestId('chat-tray-close'));
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('on a phone the window is the whole screen: no drag, no resize, no full-size toggle', () => {
    setViewport(390, 844);
    act(() => useChatWindow.getState().open());
    win({ phone: true });
    expect(['0', '0px']).toContain(panel().style.inset);
    expect(screen.queryByTestId('chat-resize')).toBeNull();
    expect(screen.queryByTestId('chat-fullsize')).toBeNull();
    expect(screen.getByTestId('fake-header')).not.toHaveAttribute('data-drag-handle');
    expect(screen.getByTestId('chat-minimize')).toBeInTheDocument();
    expect(screen.getByTestId('chat-close')).toBeInTheDocument();
  });
});
