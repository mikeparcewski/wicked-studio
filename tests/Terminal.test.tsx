import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { Terminal } from '../src/components/Terminal.js';
import * as client from '../src/api/client.js';

// ── mock xterm.js + the fit addon (jsdom has no canvas/renderer) ──────────────
// The hoisted registry lets the test reach the xterm instance the component made,
// drive its `onData` callback, and inspect `write`.
const h = vi.hoisted(() => ({
  terminals: [] as Array<{
    options: Record<string, unknown>;
    cols: number;
    rows: number;
    write: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    emitData: (d: string) => void;
    lines: string[];
    selection: string;
    linkProviders: Array<{ provideLinks: (y: number, cb: (links: Array<{ text: string; range: unknown; activate: (e: unknown, t: string) => void }> | undefined) => void) => void }>;
    registerLinkProvider: ReturnType<typeof vi.fn>;
    osc: Map<number, (data: string) => boolean>;
    keyHandler: ((ev: KeyboardEvent) => boolean) | null;
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
    // The link, OSC and key hooks studio#1362 uses, over a buffer of plain rows.
    lines: string[] = [];
    selection = '';
    linkProviders: Array<{ provideLinks: (y: number, cb: (links: Array<{ text: string; range: unknown; activate: (e: unknown, t: string) => void }> | undefined) => void) => void }> = [];
    osc = new Map<number, (data: string) => boolean>();
    keyHandler: ((ev: KeyboardEvent) => boolean) | null = null;
    registerLinkProvider = vi.fn((p: (typeof this.linkProviders)[number]) => { this.linkProviders.push(p); return { dispose: vi.fn() }; });
    parser = { registerOscHandler: vi.fn((id: number, cb: (data: string) => boolean) => { this.osc.set(id, cb); return { dispose: vi.fn() }; }) };
    attachCustomKeyEventHandler = vi.fn((cb: (ev: KeyboardEvent) => boolean) => { this.keyHandler = cb; });
    hasSelection = (): boolean => this.selection !== '';
    getSelection = (): string => this.selection;
    get buffer(): unknown {
      const lines = this.lines;
      const cols = this.cols;
      return {
        active: {
          get length() { return lines.length; },
          getLine: (i: number) => (i < 0 || i >= lines.length ? undefined : {
            isWrapped: false,
            getCell: (x: number) => (x >= cols ? undefined : { getChars: () => lines[i]![x] ?? '', getWidth: () => 1 }),
          }),
        },
      };
    }
    constructor(public options: Record<string, unknown> = {}) {
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

  it('Option-drag selects even while the program has mouse reporting on, and right-click keeps the selection', async () => {
    render(<Terminal cwd="/work" />);
    await waitFor(() => expect(h.terminals).toHaveLength(1));
    expect(h.terminals[0]!.options).toMatchObject({
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: false,
    });
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

  it('initialInput: opens a plain login shell (no cmd) and types the line into the PTY over the WS', async () => {
    render(<Terminal cwd="/work" initialInput={'codex auth login\n'} />);
    await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());

    // Seat sign-in contract: login_invocation is a SHELL LINE, so the PTY is the
    // user's interactive login shell — cmd is NOT forwarded to openTerminal.
    expect(client.api.openTerminal).toHaveBeenCalledWith({
      cwd: '/work',
      cols: 80,
      rows: 24,
      governed: true,
    });
    // ...and the line goes down the SAME stdin path keystrokes use: a WS text frame.
    expect(FakeWebSocket.last?.send).toHaveBeenCalledWith('codex auth login\n');
  });

  it('initialInput: waits for ws.onopen when the socket is still connecting', async () => {
    // Force the CONNECTING path — the component must defer the write to onopen.
    class ConnectingWebSocket extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        this.readyState = FakeWebSocket.CONNECTING;
      }
    }
    vi.stubGlobal('WebSocket', ConnectingWebSocket);

    render(<Terminal cwd="/work" initialInput={'claude login\n'} />);
    await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
    const ws = FakeWebSocket.last!;
    expect(ws.send).not.toHaveBeenCalled();

    act(() => {
      ws.readyState = FakeWebSocket.OPEN;
      ws.onopen?.({});
    });
    expect(ws.send).toHaveBeenCalledWith('claude login\n');
  });

  it('concealHome draws the named home directory as ~ in the output, text and binary frames alike (studio#467)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Terminal cwd="." initialInput={'CLAUDE_CONFIG_DIR="/Users/reel-operator/.wicked-worker/claude" claude\n'} concealHome={['/Users/reel-operator']} />);
      await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
      const term = h.terminals[0]!;
      const ws = FakeWebSocket.last!;
      // What is typed into the shell is the line as given — only the drawing changes.
      await waitFor(() => expect(ws.send).toHaveBeenCalledWith('CLAUDE_CONFIG_DIR="/Users/reel-operator/.wicked-worker/claude" claude\n'));

      act(() => ws.onmessage?.({ data: '% CLAUDE_CONFIG_DIR="/Users/reel-' }));
      act(() => ws.onmessage?.({ data: new TextEncoder().encode('operator/.wicked-worker/claude" claude\r\n').buffer }));
      act(() => { vi.advanceTimersByTime(60); });

      const drawn = term.write.mock.calls.map((c) => c[0] as unknown).filter((x): x is string => typeof x === 'string').join('');
      expect(drawn).toBe('% CLAUDE_CONFIG_DIR="~/.wicked-worker/claude" claude\r\n');
      expect(drawn).not.toContain('reel-operator');
    } finally {
      vi.useRealTimers();
    }
  });

  it('concealHome passes a frame that is not UTF-8 through as its exact bytes (codex on #484)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Terminal cwd="." concealHome={['/Users/reel-operator']} />);
      await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
      const term = h.terminals[0]!;
      const ws = FakeWebSocket.last!;
      act(() => ws.onmessage?.({ data: 'ok ' }));
      act(() => ws.onmessage?.({ data: new Uint8Array([0xff, 0xfe, 0x41]).buffer }));
      act(() => { vi.advanceTimersByTime(60); });
      const out: number[] = [];
      for (const [x] of term.write.mock.calls as unknown[][]) {
        if (typeof x === 'string') out.push(...new TextEncoder().encode(x));
        else if (x instanceof Uint8Array) out.push(...x);
      }
      // Every byte, in order: the text, the two bytes that are not UTF-8 as they came, the valid 'A'.
      expect(out).toStrictEqual([...new TextEncoder().encode('ok '), 0xff, 0xfe, 0x41]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('concealHome keeps every byte across frames and masks a directory completed inside a frame that also holds a non-UTF-8 byte (codex r2 on #484)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Terminal cwd="." concealHome={['/Users/reel-operator']} />);
      await waitFor(() => expect(FakeWebSocket.last).toBeTruthy());
      const term = h.terminals[0]!;
      const ws = FakeWebSocket.last!;
      // A valid lead byte held by one frame, then a frame whose next byte cannot continue it.
      act(() => ws.onmessage?.({ data: new Uint8Array([0xe2]).buffer }));
      act(() => ws.onmessage?.({ data: new Uint8Array([0x82, 0xff]).buffer }));
      // A held directory prefix, completed by a frame that ends in an invalid byte.
      act(() => ws.onmessage?.({ data: ' /Users/reel-' }));
      act(() => ws.onmessage?.({ data: new Uint8Array([...new TextEncoder().encode('operator/.wicked-worker/pi'), 0xff]).buffer }));
      act(() => { vi.advanceTimersByTime(60); });
      const out: number[] = [];
      for (const [x] of term.write.mock.calls as unknown[][]) {
        if (typeof x === 'string') out.push(...new TextEncoder().encode(x));
        else if (x instanceof Uint8Array) out.push(...x);
      }
      expect(out).toStrictEqual([0xe2, 0x82, 0xff, ...new TextEncoder().encode(' ~/.wicked-worker/pi'), 0xff]);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('getting text out (studio#1362)', () => {
    const LINK = 'https://claude.ai/oauth/authorize?code=true&client_id=00000000-0000-4000-8000-000000000000&response_type=code&state=abc';
    // claude's own wrap at the width: the link cut into 80-column rows.
    const wrapped = (s: string, w: number): string[] => Array.from({ length: Math.ceil(s.length / w) }, (_, i) => s.slice(i * w, (i + 1) * w));
    const mounted = async () => {
      render(<Terminal cwd="." />);
      await waitFor(() => expect(h.terminals[0]?.registerLinkProvider).toHaveBeenCalled());
      return h.terminals[0]!;
    };
    const linksAt = (term: (typeof h.terminals)[number], y: number) => {
      let got: Array<{ text: string; range: unknown; activate: (e: unknown, t: string) => void }> | undefined;
      term.linkProviders[0]!.provideLinks(y, (l) => { got = l; });
      return got;
    };

    it('a sign-in link wrapped over rows is one link on each of its rows, and a click opens it in a new tab with no opener', async () => {
      const term = await mounted();
      term.lines = ['Browser didn\'t open? Use the url below to sign in:', '', ...wrapped(LINK, 80), '', 'Paste code here if prompted >'];
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      try {
        for (const y of [3, 4]) {
          const links = linksAt(term, y);
          expect(links?.map((l) => l.text)).toEqual([LINK]);
          expect(links?.[0]?.range).toEqual({ start: { x: 1, y: 3 }, end: { x: LINK.length - 80, y: 4 } });
        }
        expect(linksAt(term, 1)).toBeUndefined();
        linksAt(term, 4)![0]!.activate(new MouseEvent('mouseup'), LINK);
        expect(open).toHaveBeenCalledWith(LINK, '_blank', 'noopener,noreferrer');
        // A drag that ends on the link, or an Option/Shift press (they select), does not open it (review r1).
        const host = screen.getByTestId('terminal-host');
        fireEvent.mouseDown(host, { clientX: 10, clientY: 10 });
        linksAt(term, 4)![0]!.activate(new MouseEvent('mouseup', { clientX: 200, clientY: 10 }), LINK);
        fireEvent.mouseDown(host, { clientX: 10, clientY: 10 });
        linksAt(term, 4)![0]!.activate(new MouseEvent('mouseup', { clientX: 10, clientY: 10, altKey: true }), LINK);
        expect(open).toHaveBeenCalledTimes(1);
      } finally {
        open.mockRestore();
      }
    });

    it('an OSC 52 copy is offered, never done on its own: Copy it copies, a refusal says how to copy by hand (review r1)', async () => {
      const term = await mounted();
      const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('NotAllowedError'));
      vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', clipboard: { writeText } });
      try {
        const handler = term.osc.get(52)!;
        act(() => { expect(handler(`c;${btoa(LINK)}`)).toBe(true); });
        expect(writeText).not.toHaveBeenCalled();
        expect(screen.getByTestId('terminal-copy-ask')).toHaveTextContent(`The program in this terminal wants to copy ${LINK.length} characters to your clipboard.`);
        // The text itself is never drawn (it can be a sign-in token).
        expect(screen.getByTestId('terminal-copy-ask')).not.toHaveTextContent('claude.ai');
        fireEvent.click(screen.getByTestId('terminal-copy-go'));
        expect(writeText).toHaveBeenCalledWith(LINK);
        await waitFor(() => expect(screen.getByTestId('terminal-copy-note')).toHaveTextContent('Copied to your clipboard.'));
        act(() => { handler(`c;${btoa('made-up-value')}`); });
        fireEvent.click(screen.getByTestId('terminal-copy-go'));
        await waitFor(() => expect(screen.getByTestId('terminal-copy-note')).toHaveTextContent('Your browser didn’t allow the copy. To copy text from the terminal, hold Option (⌥) while you drag over it, then press ⌘C.'));
        // Don't copy drops the offer; a read request is never answered.
        act(() => { handler(`c;${btoa('another')}`); });
        fireEvent.click(screen.getByTestId('terminal-copy-skip'));
        expect(screen.queryByTestId('terminal-copy-ask')).toBeNull();
        act(() => { handler('c;?'); });
        expect(screen.queryByTestId('terminal-copy-ask')).toBeNull();
        expect(writeText).toHaveBeenCalledTimes(2);
      } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      }
    });

    it('only the newest copy says how it went (review r1)', async () => {
      const term = await mounted();
      let rejectOld: (e: Error) => void = () => {};
      const writeText = vi.fn()
        .mockImplementationOnce(() => new Promise((_r, rej) => { rejectOld = rej; }))
        .mockResolvedValueOnce(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      try {
        act(() => { term.osc.get(52)!(`c;${btoa('first')}`); });
        fireEvent.click(screen.getByTestId('terminal-copy-go'));
        term.selection = 'second';
        act(() => { term.keyHandler!(new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true })); });
        await waitFor(() => expect(screen.getByTestId('terminal-copy-note')).toHaveTextContent('Copied to your clipboard.'));
        await act(async () => { rejectOld(new Error('late')); await Promise.resolve(); });
        expect(screen.getByTestId('terminal-copy-note')).toHaveTextContent('Copied to your clipboard.');
      } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      }
    });

    it('Ctrl+Shift+C copies the selection; plain Ctrl+C stays the program’s', async () => {
      const term = await mounted();
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      try {
        term.selection = 'the selected text';
        expect(term.keyHandler!(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBe(true);
        expect(writeText).not.toHaveBeenCalled();
        expect(term.keyHandler!(new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(writeText).toHaveBeenCalledWith('the selected text');
        // With nothing selected it is still never the program's (it would be its interrupt; review r1).
        term.selection = '';
        expect(term.keyHandler!(new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(writeText).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal('WebSocket', FakeWebSocket);
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      }
    });
  });

  it('surfaces the ungoverned operator shell loudly in the UI (§7)', () => {
    const { rerender } = render(<Terminal cwd="/work" governed />);
    expect(screen.getByTestId('terminal-governed')).toHaveTextContent('governed');

    rerender(<Terminal cwd="/work" governed={false} />);
    expect(screen.getByTestId('terminal-governed')).toHaveTextContent('ungoverned operator shell');
  });
});
