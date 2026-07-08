import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, terminalWsUrl } from '../api/client.js';

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
export function Terminal({ cwd, cmd, governed = true }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  // Snapshot the open-time props; the session opens once (see effect deps: []).
  const propsRef = useRef({ cwd, cmd, governed });
  propsRef.current = { cwd, cmd, governed };

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
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#111827', foreground: '#e5e7eb' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* container not laid out yet — keep xterm's default 80x24 */
    }

    // xterm keystrokes → PTY stdin over the dedicated WS (raw, as a text frame).
    const dataSub = term.onData((chunk: string) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(chunk);
    });

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
      ws.onmessage = (ev: MessageEvent) => {
        // Raw PTY output: binary frame → exact bytes; text frame → string.
        if (typeof ev.data === 'string') term.write(ev.data);
        else term.write(new Uint8Array(ev.data as ArrayBuffer));
      };
      socket = ws;
    })();

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
    observe?.observe(host);

    return () => {
      disposed = true;
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
        <span className="font-semibold text-gray-500">Terminal</span>
        <span
          data-testid="terminal-governed"
          className={governed ? 'text-gray-400' : 'font-semibold text-amber-600'}
        >
          {governed ? 'governed' : 'ungoverned operator shell'}
        </span>
      </div>
      <div
        ref={hostRef}
        data-testid="terminal-host"
        className="h-64 w-full overflow-hidden rounded bg-gray-900 p-1"
      />
    </div>
  );
}
