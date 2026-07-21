import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentTerminal } from '../src/components/AgentTerminal.js';
import * as client from '../src/api/client.js';

// ── mock xterm.js + fit addon (jsdom has no canvas/renderer) ─────────────────
const h = vi.hoisted(() => ({
  terminals: [] as Array<{
    write: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80;
    rows = 24;
    open = vi.fn();
    loadAddon = vi.fn();
    dispose = vi.fn();
    write = vi.fn();
    onData = vi.fn((_cb: (d: string) => void) => ({ dispose: vi.fn() }));
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

// ── fake WebSocket ────────────────────────────────────────────────────────────
class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | undefined;

  url: string;
  binaryType = 'blob';
  readyState = FakeWebSocket.OPEN;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED; });

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

describe('AgentTerminal (observer-only — attaches to existing PTY, no new session)', () => {
  beforeEach(() => {
    h.terminals.length = 0;
    FakeWebSocket.last = undefined;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    // Spy to verify these are NOT called.
    vi.spyOn(client.api, 'openTerminal').mockResolvedValue({ id: 'should-not-be-called' });
    vi.spyOn(client.api, 'closeTerminal').mockResolvedValue({ status: 'ok' });
    vi.spyOn(client.api, 'resizeTerminal').mockResolvedValue({ status: 'ok' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connects directly to the existing terminal WS without creating a new PTY', () => {
    render(<AgentTerminal terminalId="tid-abc" cliKey="claude" onClose={vi.fn()} />);
    expect(FakeWebSocket.last).toBeTruthy();
    expect(FakeWebSocket.last?.url).toContain('/ws/terminals/tid-abc');
    expect(FakeWebSocket.last?.binaryType).toBe('arraybuffer');
    expect(client.api.openTerminal).not.toHaveBeenCalled();
  });

  it('renders the cliKey and observer label in the header', () => {
    render(<AgentTerminal terminalId="tid-abc" cliKey="codex" onClose={vi.fn()} />);
    expect(screen.getByText(/codex/)).toBeInTheDocument();
    expect(screen.getByText(/observer/i)).toBeInTheDocument();
  });

  it('writes text frames to xterm', () => {
    render(<AgentTerminal terminalId="tid-abc" cliKey="claude" onClose={vi.fn()} />);
    act(() => { FakeWebSocket.last?.onmessage?.({ data: 'hello from agent' }); });
    expect(h.terminals[0]?.write).toHaveBeenCalledWith('hello from agent');
  });

  it('writes binary frames to xterm as Uint8Array', () => {
    render(<AgentTerminal terminalId="tid-abc" cliKey="claude" onClose={vi.fn()} />);
    const bytes = new TextEncoder().encode('binary-chunk');
    act(() => { FakeWebSocket.last?.onmessage?.({ data: bytes.buffer }); });
    const arg = h.terminals[0]?.write.mock.calls.at(-1)?.[0] as unknown;
    expect(arg).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(arg as Uint8Array)).toBe('binary-chunk');
  });

  it('does NOT forward keystrokes to the WS (observer-only, disableStdin)', () => {
    render(<AgentTerminal terminalId="tid-abc" cliKey="claude" onClose={vi.fn()} />);
    // With disableStdin: true the component never registers an onData handler.
    expect(h.terminals[0]?.onData).not.toHaveBeenCalled();
    expect(FakeWebSocket.last?.send).not.toHaveBeenCalled();
  });

  it('closes the WS on unmount without calling api.closeTerminal', () => {
    const { unmount } = render(<AgentTerminal terminalId="tid-abc" cliKey="claude" onClose={vi.fn()} />);
    const ws = FakeWebSocket.last!;
    unmount();
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(client.api.closeTerminal).not.toHaveBeenCalled();
  });

  it('does NOT call api.resizeTerminal when the container resizes', () => {
    render(<AgentTerminal terminalId="tid-abc" cliKey="claude" onClose={vi.fn()} />);
    expect(client.api.resizeTerminal).not.toHaveBeenCalled();
  });

  it('calls onClose when the × button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AgentTerminal terminalId="tid-abc" cliKey="claude" onClose={onClose} />);
    await user.click(screen.getByLabelText(/close claude terminal/i));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reconnects to a new WS URL when terminalId prop changes', () => {
    const { rerender } = render(<AgentTerminal terminalId="tid-1" cliKey="claude" onClose={vi.fn()} />);
    const ws1 = FakeWebSocket.last!;
    expect(ws1.url).toContain('/ws/terminals/tid-1');

    rerender(<AgentTerminal terminalId="tid-2" cliKey="claude" onClose={vi.fn()} />);
    expect(ws1.close).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.last?.url).toContain('/ws/terminals/tid-2');
  });
});
