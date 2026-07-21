import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { terminalWsUrl } from '../api/client.js';

interface Props {
  /** The terminalId from a workerSessionStarted event — connects to this existing PTY. */
  terminalId: string;
  /** CLI key label shown in the header bar. */
  cliKey: string;
  /** Called when the close (×) button is clicked. */
  onClose: () => void;
}

/**
 * Read-only observer for an already-running agent PTY session.
 *
 * Attaches xterm.js to the existing WS for `terminalId` — no new PTY is created
 * and no input is forwarded (observer-only). The underlying PTY lifecycle is
 * owned by the engine; on unmount the socket closes but the PTY continues running.
 *
 * Resize only reflows the local xterm display — it does NOT call
 * POST /terminals/:id/resize so the agent's active PTY is left undisturbed.
 */
export function AgentTerminal({ terminalId, cliKey, onClose }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef(terminalId);
  terminalIdRef.current = terminalId;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;

    const term = new XTerm({
      convertEol: false,
      cursorBlink: false,
      disableStdin: true,
      fontSize: 12,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#0d1117', foreground: '#e6edf3', cursor: '#ffda19', cursorAccent: '#0d1117' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* container not laid out yet */
    }

    const ws = new WebSocket(terminalWsUrl(terminalIdRef.current));
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') term.write(ev.data);
      else term.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onerror = () => {
      if (!disposed) term.write('\r\n\x1b[31m[terminal connection error]\x1b[0m\r\n');
    };
    ws.onclose = () => {
      if (!disposed) term.write('\r\n\x1b[90m[agent session ended]\x1b[0m\r\n');
    };

    // Reflow the local xterm display on container resize — does NOT resize the PTY.
    const observe =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            try {
              fit.fit();
            } catch { /* not laid out */ }
          })
        : undefined;
    observe?.observe(host);

    return () => {
      disposed = true;
      observe?.disconnect();
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      // Do NOT close the terminal — the engine owns the PTY lifecycle.
      term.dispose();
    };
  }, [terminalId]);

  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden"
      style={{ background: '#0d1117', border: '1px solid rgba(230,237,243,0.08)' }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{ background: '#161c26', borderBottom: '1px solid rgba(230,237,243,0.06)' }}
      >
        <span className="text-[11px] font-mono font-semibold" style={{ color: 'rgba(230,237,243,0.5)' }}>
          {cliKey} <span style={{ color: 'rgba(230,237,243,0.3)', fontWeight: 400 }}>· observer</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${cliKey} terminal`}
          className="text-[13px] leading-none opacity-50 hover:opacity-100 transition-opacity"
          style={{ background: 'transparent', border: 'none', color: '#e6edf3', cursor: 'pointer' }}
        >
          ×
        </button>
      </div>
      <div
        ref={hostRef}
        className="h-56 w-full overflow-hidden p-1"
      />
    </div>
  );
}
