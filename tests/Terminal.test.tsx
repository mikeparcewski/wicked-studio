import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Terminal } from '../src/components/Terminal.js';
import * as client from '../src/api/client.js';

// ── mock xterm.js + the fit addon (jsdom has no canvas/renderer) ──────────────
// The hoisted registry lets the test reach the xterm instance the component made,
// drive its `onData` callback, and inspect `write`.
const h = vi.hoisted(() => ({
  terminals: [] as Array<{
    cols: number;
    rows: number;
    write: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    emitData: (d: string) => void;
  }>,
}));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80;
    rows = 24;
    open = vi.fn();
    loadAddon = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    write = vi.fn();
    private dataCbs: Array<(d: string) => void> = [];
    onData = vi.fn((cb: (d: string) => void) => {
      this.dataCbs.push(cb);
      return { dispose: vi.fn() };
    });
    emitData(d: string): void {
      for (const cb of this.dataCbs) cb(d);
    }
    constructor() {
      h.terminals.push(this);
    }
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn();
  }
  return { FitAddon };
});

// ── fake WebSocket (jsdom provides none) ──────────────────────────────────────
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | undefined;

  url: string;
  binaryType = 'blob';
  readyState: number = FakeWebSocket.OPEN;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.last = this;
  }
}

class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe('Terminal (DES-TERMINAL-001 §6 — the web bridge)', () => {
  beforeEach(() => {
    h.terminals.length = 0;
    FakeWebSocket.last = undefined;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(client.api, 'openTerminal').mockResolvedValue({ id: 'term-xyz' });
    vi.spyOn(client.api, 'closeTerminal').mockResolvedValue({ status: 'ok' });
    vi.spyOn(client.api, 'resizeTerminal').mockResolvedValue({ status: 'ok' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens a PTY on mount with the terminal grid size + governed default', async () => {
    render(<Terminal cwd="/work" />);
    await waitFor(() => expect(client.api.openTerminal).toHaveBeenCalledTimes(1));
    expect(client.api.openTerminal).toHaveBeenCalledWith({
      cwd: '/work',
      cols: 80,
      rows: 24,
      governed: true,
    });
    // ...then opens the dedicated per-terminal WS for the returned id.
    await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
    expect(FakeWebSocket.last?.url).toContain('/ws/terminals/term-xyz');
    expect(FakeWebSocket.last?.binaryType).toBe('arraybuffer');
  });

  it('forwards cmd + the ungoverned opt-in through to openTerminal', async () => {
    render(<Terminal cwd="/work" cmd={['bash', '-l']} governed={false} />);
    await waitFor(() =>
      expect(client.api.openTerminal).toHaveBeenCalledWith({
        cwd: '/work',
        cmd: ['bash', '-l'],
        cols: 80,
        rows: 24,
        governed: false,
      }),
    );
  });

  it('xterm.onData (keystrokes) → ws.send', async () => {
    render(<Terminal cwd="/work" />);
    await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
    const term = h.terminals[0];
    expect(term).toBeTruthy();

    act(() => term!.emitData('l'));
    act(() => term!.emitData('s\r'));

    expect(FakeWebSocket.last?.send).toHaveBeenCalledWith('l');
    expect(FakeWebSocket.last?.send).toHaveBeenCalledWith('s\r');
  });

  it('ws.onmessage (text frame) → xterm.write with the string', async () => {
    render(<Terminal cwd="/work" />);
    await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
    const term = h.terminals[0]!;

    act(() => FakeWebSocket.last?.onmessage?.({ data: 'hello-from-pty' }));
    expect(term.write).toHaveBeenCalledWith('hello-from-pty');
  });

  it('ws.onmessage (binary frame) → xterm.write with exact bytes', async () => {
    render(<Terminal cwd="/work" />);
    await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
    const term = h.terminals[0]!;

    const bytes = new TextEncoder().encode('raw-bytes');
    act(() => FakeWebSocket.last?.onmessage?.({ data: bytes.buffer }));

    const lastArg = term.write.mock.calls.at(-1)?.[0] as unknown;
    expect(lastArg).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(lastArg as Uint8Array)).toBe('raw-bytes');
  });

  it('on unmount closes the WS and the PTY (POST …/close), reaping the child', async () => {
    const { unmount } = render(<Terminal cwd="/work" />);
    await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
    const ws = FakeWebSocket.last!;
    const term = h.terminals[0]!;

    unmount();

    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(term.dispose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(client.api.closeTerminal).toHaveBeenCalledWith('term-xyz'));
  });

  it('surfaces the ungoverned operator shell loudly in the UI (§7)', () => {
    const { rerender } = render(<Terminal cwd="/work" governed />);
    expect(screen.getByTestId('terminal-governed')).toHaveTextContent('governed');

    rerender(<Terminal cwd="/work" governed={false} />);
    expect(screen.getByTestId('terminal-governed')).toHaveTextContent('ungoverned operator shell');
  });
});
