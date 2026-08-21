import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, terminalWsUrl } from '../api/client.js';
import { resolveToken } from '../styles/resolveToken.js';

interface Props {
  /** Working directory the PTY opens in. */
  cwd: string;
  /** Command to run; omit for the user's login shell. */
  cmd?: string[];
  /**
   * `false` = the loud, opt-in UNGOVERNED operator shell (DES-TERMINAL-001 §7),
   * surfaced as ungoverned in the UI. Omitted / `true` = the safe governed default.
   */
  governed?: boolean;
  /**
   * Bytes to type into the PTY as soon as the stdin channel is up — sent ONCE over
   * the dedicated terminal WS, the exact same text-frame path keystrokes take
   * (`ws.send` → daemon `writeTerminal`). Used by seat sign-in: the roster's
   * `login_invocation` + `"\n"` runs in the operator's own interactive login shell,
   * echoing visibly so they can complete the CLI's URL/paste flow in this terminal.
   */
  initialInput?: string;
}

/**
 * A real xterm.js terminal wired to a PTY through the daemon → core-ts → engine
 * (DES-TERMINAL-001 §6). On mount it `POST /terminals` → id, opens the dedicated
 * WS `/ws/terminals/:id`, and bridges both directions:
 *   - `xterm.onData` (keystrokes) → `ws.send` → daemon `writeTerminal`
 *   - `ws.onmessage` (raw PTY bytes) → `xterm.write`
 * The fit addon sizes the grid to the container; a ResizeObserver re-fits and
 * `POST …/resize`s the PTY. On unmount it closes the WS and `POST …/close`s the
 * PTY (reaping the child even if unmounted mid-open).
 *
 * A terminal is a stateful session: it opens ONCE for the component's lifetime.
 * Remount with a React `key` to start a fresh terminal (e.g. a different cwd).
 */
export function Terminal({ cwd, cmd, governed = true, initialInput }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  // Snapshot the open-time props; the session opens once (see effect deps: []).
  const propsRef = useRef({ cwd, cmd, governed, initialInput });
  propsRef.current = { cwd, cmd, governed, initialInput };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let socket: WebSocket | undefined;
    let terminalId: string | undefined;

    const term = new XTerm({
      convertEol: false,
      cursorBlink: true,
      fontSize: 12,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      // xterm parses concrete colors (no var() support) — resolve the tokens
      // through the cascade at mount time (§2.11's escape hatch).
      theme: {
        background: resolveToken('--surface-base'),
        foreground: resolveToken('--ink-body'),
        cursor: resolveToken('--accent'),
        cursorAccent: resolveToken('--surface-base'),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // xterm keystrokes → PTY stdin over the dedicated WS (raw, as a text frame).
    const dataSub = term.onData((chunk: string) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(chunk);
    });

    // Refit on container resize → tell the PTY its new dimensions.
    const observe =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            try {
              fit.fit();
            } catch {
              /* not laid out */
            }
            if (terminalId) {
              void api.resizeTerminal(terminalId, term.cols, term.rows).catch(() => {});
            }
          })
        : undefined;

    // Defer open to the next animation frame so the browser has completed layout and
    // the container has non-zero dimensions. Opening xterm synchronously crashes
    // Viewport.syncScrollArea with "cannot read properties of undefined (reading dimensions)".
    const rafHandle = requestAnimationFrame(() => {
      if (disposed) return;
      term.open(host);
      try {
        fit.fit();
      } catch {
        /* container still not laid out — keep xterm's default 80x24 */
      }
      observe?.observe(host);

      void (async () => {
        const p = propsRef.current;
        let id: string;
        try {
          const opts: Parameters<typeof api.openTerminal>[0] = {
            cwd: p.cwd,
            cols: term.cols,
            rows: term.rows,
            governed: p.governed,
          };
          if (p.cmd !== undefined) opts.cmd = p.cmd;
          id = (await api.openTerminal(opts)).id;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          term.write(`\r\n\x1b[31m[failed to open terminal: ${msg}]\x1b[0m\r\n`);
          return;
        }
        if (disposed) {
          // Unmounted before open resolved — reap the orphan PTY.
          void api.closeTerminal(id).catch(() => {});
          return;
        }
        terminalId = id;

        const ws = new WebSocket(terminalWsUrl(id));
        ws.binaryType = 'arraybuffer';
        // Type `initialInput` into the PTY the moment the stdin channel is up —
        // once, over the same WS text-frame path as keystrokes. The PTY's input is
        // kernel-buffered, so sending at open is safe even before the shell prompts.
        const line = propsRef.current.initialInput;
        if (line !== undefined && line.length > 0) {
          if (ws.readyState === WebSocket.OPEN) ws.send(line);
          else ws.onopen = () => ws.send(line);
        }
        ws.onmessage = (ev: MessageEvent) => {
          // Raw PTY output: binary frame → exact bytes; text frame → string.
          if (typeof ev.data === 'string') term.write(ev.data);
          else term.write(new Uint8Array(ev.data as ArrayBuffer));
        };
        socket = ws;
      })();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafHandle);
      observe?.disconnect();
      dataSub.dispose();
      try {
        socket?.close();
      } catch {
        /* already closing */
      }
      if (terminalId) void api.closeTerminal(terminalId).catch(() => {});
      term.dispose();
    };
    // Open once for the component's lifetime (props snapshotted via propsRef).
  }, []);

  return (
    <div data-testid="terminal" className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold font-mono" style={{ color: 'var(--ink-dim)' }}>Terminal</span>
        <span
          data-testid="terminal-governed"
          style={{ color: governed ? 'var(--ink-dim)' : 'var(--status-gate)', fontWeight: governed ? undefined : 600 }}
        >
          {governed ? 'governed' : 'ungoverned operator shell'}
        </span>
      </div>
      <div
        ref={hostRef}
        data-testid="terminal-host"
        className="h-64 w-full overflow-hidden rounded p-1"
        style={{ background: 'var(--surface-base)' }}
      />
    </div>
  );
}
