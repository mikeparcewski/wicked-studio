import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, terminalWsUrl } from '../api/client.js';
import { homeMasker } from '../board/homePath.js';
import { splitUtf8 } from '../board/utf8Segments.js';
import { copyAskWords, copyNote, linksAt, openUrl, opensOnRelease, osc52Text, readRow, urlsIn } from '../board/terminalLinks.js';
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
  /**
   * Home directories to draw as `~` in this terminal's output (studio#467): the sign-in line
   * names the worker home under the operator's home directory, and the shell echoes it. Display
   * only — what is typed and what runs is unchanged. Omit (or pass none) to draw the bytes as-is.
   */
  concealHome?: readonly string[];
  /**
   * Open the PTY some other way than `POST /terminals` — the daemon's own seat route (crew#615
   * `POST /seats/:cli/logout` runs the seat's documented logout and answers its `terminalId`). The
   * terminal then drives and reads that id exactly like its own; `cwd` / `cmd` / `initialInput`
   * are not used. A rejection is drawn in the terminal and handed to `onOpenError`.
   */
  open?: (cols: number, rows: number) => Promise<{ id: string }>;
  /** Told when opening failed (the error the open rejected with). */
  onOpenError?: (err: unknown) => void;
  /** Told once its PTY is gone while mounted: the daemon closes the terminal socket when the child exits. */
  onExit?: () => void;
  /**
   * (studio#1362) Told the web addresses on screen, oldest first, a moment after the program draws (at most every
   * {@link LINK_SCAN_MS}): the sign-in window shows the newest outside the terminal, as a link with a copy button.
   */
  onLinks?: (urls: readonly string[]) => void;
}

/** How often, at most, a terminal with `onLinks` reads its screen for addresses while the program draws. */
export const LINK_SCAN_MS = 150;

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
export function Terminal({ cwd, cmd, governed = true, initialInput, concealHome, open, onOpenError, onExit, onLinks }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  // Snapshot the open-time props; the session opens once (see effect deps: []).
  const propsRef = useRef({ cwd, cmd, governed, initialInput, concealHome, open, onOpenError, onExit, onLinks });
  propsRef.current = { cwd, cmd, governed, initialInput, concealHome, open, onOpenError, onExit, onLinks };
  /** (studio#1362) A copy the terminal's program asked for, waiting on the person, or what the last copy did. */
  const [copy, setCopy] = useState<{ kind: 'ask'; chars: number } | { kind: 'done'; text: string } | null>(null);
  /** The text the program asked to copy (never drawn: it can be a sign-in token), and each request's number. */
  const askedRef = useRef<string | null>(null);
  const copySeq = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  /** Put text on the clipboard from a person's own gesture; only the newest request says how it went. */
  const toClipboard = useCallback((text: string): void => {
    const mine = ++copySeq.current;
    const done = (ok: boolean): void => { if (copySeq.current === mine && mountedRef.current) setCopy({ kind: 'done', text: copyNote(ok) }); };
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clip === undefined || typeof clip.writeText !== 'function') done(false);
    else clip.writeText(text).then(() => done(true), () => done(false));
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    let terminalId: string | undefined;

    const term = new XTerm({
      convertEol: false,
      cursorBlink: true,
      // A program can leave mouse reporting on (claude's setup-token does): a drag is then sent
      // to it, not selected. Option-drag always selects, and right-click keeps that selection.
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: false,
      // The code size (--text-code); xterm needs a number, so it is read from the token at mount.
      fontSize: Number.parseFloat(resolveToken('--text-code')) || 13,
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

    // (studio#1362) A printed web address opens in a new tab on a click, joined across the rows it spans. It works while
    // a program has mouse reporting on (xterm's link layer reads the click before the report is sent). A drag, or a
    // press with Option or Shift (they select), never opens it.
    let down: { x: number; y: number } | null = null;
    const onDown = (e: MouseEvent): void => { down = { x: e.clientX, y: e.clientY }; };
    host.addEventListener('mousedown', onDown, true);
    const links = term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const read = (row: number) => {
          const buf = term.buffer.active;
          return linksAt((i) => readRow(buf.getLine(i), term.cols), buf.length, row, term.cols);
        };
        const found = read(y - 1);
        callback(found.length === 0 ? undefined : found.map((u) => ({
          text: u.url,
          range: { start: { x: u.start.col + 1, y: u.start.row + 1 }, end: { x: u.end.col + 1, y: u.end.row + 1 } },
          decorations: { pointerCursor: true, underline: true },
          // The screen may have changed since the link was found (xterm keeps it while only part of it is redrawn):
          // it opens only if the same address is still there, in the same place.
          activate: (e: MouseEvent, text: string) => {
            if (!opensOnRelease(e, down)) return;
            const still = read(u.start.row).some((v) => v.url === text && v.start.row === u.start.row && v.start.col === u.start.col && v.end.row === u.end.row && v.end.col === u.end.col);
            if (still) openUrl(text);
          },
        })));
      },
    });

    // (studio#1362) A program's copy (OSC 52, e.g. claude's copy key) is offered, never done on its own: the terminal's
    // output is the program's, so it may not change the clipboard behind the person's back. "Copy it" copies. Copying
    // a selection is the browser's own (⌘C on a Mac; the right-click menu's Copy elsewhere, which xterm readies).
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      const text = osc52Text(data);
      if (text !== null && !disposed) {
        askedRef.current = text;
        copySeq.current++;
        setCopy({ kind: 'ask', chars: text.length });
      }
      return true;
    });
    // (studio#1362) The addresses on screen, for a host that shows them outside the terminal. Read a moment after the
    // program draws, at most every LINK_SCAN_MS (a sign-in screen redraws its spinner often), from the same joined rows
    // a click opens. A terminal without `onLinks` reads nothing.
    let scan: ReturnType<typeof setTimeout> | undefined;
    const scanSub = propsRef.current.onLinks === undefined ? undefined : term.onWriteParsed(() => {
      if (scan !== undefined) return;
      scan = setTimeout(() => {
        scan = undefined;
        if (disposed) return;
        const buf = term.buffer.active;
        propsRef.current.onLinks?.(urlsIn((i) => readRow(buf.getLine(i), term.cols), buf.length, term.cols));
      }, LINK_SCAN_MS);
    });
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
      // DES-UX-001 §7.7 (slice AC): the shell takes focus on open — the first
      // keystroke lands in the terminal, never swallowed by whatever the modal
      // trigger left focused.
      term.focus();
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
          if (p.open !== undefined) {
            id = (await p.open(term.cols, term.rows)).id;
          } else {
            const opts: Parameters<typeof api.openTerminal>[0] = {
              cwd: p.cwd,
              cols: term.cols,
              rows: term.rows,
              governed: p.governed,
            };
            if (p.cmd !== undefined) opts.cmd = p.cmd;
            id = (await api.openTerminal(opts)).id;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          term.write(`\r\n\x1b[31m[failed to open terminal: ${msg}]\x1b[0m\r\n`);
          propsRef.current.onOpenError?.(err);
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
        // The daemon closes this socket when the PTY's child exits (crew TerminalHub); our own unmount
        // closes it too, and that is not an exit.
        ws.onclose = () => { if (!disposed) propsRef.current.onExit?.(); };
        // Type `initialInput` into the PTY the moment the stdin channel is up —
        // once, over the same WS text-frame path as keystrokes. The PTY's input is
        // kernel-buffered, so sending at open is safe even before the shell prompts.
        const line = propsRef.current.open === undefined ? propsRef.current.initialInput : undefined;
        if (line !== undefined && line.length > 0) {
          if (ws.readyState === WebSocket.OPEN) ws.send(line);
          else ws.onopen = () => ws.send(line);
        }
        const conceal = propsRef.current.concealHome ?? [];
        if (conceal.length === 0) {
          ws.onmessage = (ev: MessageEvent) => {
            // Raw PTY output: binary frame → exact bytes; text frame → string.
            if (typeof ev.data === 'string') term.write(ev.data);
            else term.write(new Uint8Array(ev.data as ArrayBuffer));
          };
        } else {
          // The same output, with the named home directories drawn as `~`. A chunk can end inside
          // one, so the masker holds that tail; an idle moment draws whatever it still holds.
          const masker = homeMasker(conceal);
          // A binary frame is split into valid UTF-8 text (masked) and the bytes that are not (drawn as
          // they came); a sequence cut by the frame's end waits for the next frame (codex r2 on #484).
          let pending: Uint8Array = new Uint8Array(0);
          const writeParts = (parts: readonly (string | Uint8Array)[]): void => {
            for (const part of parts) {
              if (typeof part === 'string') {
                const out = masker.push(part);
                if (out !== '') term.write(out);
              } else {
                const held = masker.flush(); // nothing that follows a raw byte can complete a held directory
                if (held !== '') term.write(held);
                term.write(part);
              }
            }
          };
          ws.onmessage = (ev: MessageEvent) => {
            if (typeof ev.data === 'string') {
              if (pending.length > 0) { writeParts([pending]); pending = new Uint8Array(0); }
              writeParts([ev.data]);
            } else {
              const frame = new Uint8Array(ev.data as ArrayBuffer);
              const buf = new Uint8Array(pending.length + frame.length);
              buf.set(pending, 0);
              buf.set(frame, pending.length);
              const split = splitUtf8(buf);
              pending = split.pending;
              writeParts(split.parts);
            }
            if (idle !== undefined) clearTimeout(idle);
            idle = setTimeout(() => {
              idle = undefined;
              if (disposed) return;
              const rest = masker.flush();
              if (rest !== '') term.write(rest);
              if (pending.length > 0) { term.write(pending); pending = new Uint8Array(0); }
            }, 40);
          };
        }
        socket = ws;
      })();
    });

    return () => {
      disposed = true;
      if (idle !== undefined) clearTimeout(idle);
      if (scan !== undefined) clearTimeout(scan);
      scanSub?.dispose();
      cancelAnimationFrame(rafHandle);
      observe?.disconnect();
      dataSub.dispose();
      links.dispose();
      osc52.dispose();
      host.removeEventListener('mousedown', onDown, true);
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
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold font-mono" style={{ color: 'var(--ink-dim)' }}>Terminal</span>
        <span
          data-testid="terminal-governed"
          style={{ color: governed ? 'var(--ink-dim)' : 'var(--status-gate)', fontWeight: governed ? undefined : 'var(--weight-strong)' }}
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
      {copy?.kind === 'ask' && (
        <div data-testid="terminal-copy-ask" role="status" className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--ink-dim)' }}>
          <span>{copyAskWords(copy.chars)}</span>
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="terminal-copy-go" onClick={() => { const t = askedRef.current; askedRef.current = null; if (t !== null) toClipboard(t); }}>Copy it</button>
          <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="terminal-copy-skip" onClick={() => { askedRef.current = null; copySeq.current++; setCopy(null); }}>Don’t copy</button>
        </div>
      )}
      {copy?.kind === 'done' && <p data-testid="terminal-copy-note" role="status" className="text-xs" style={{ color: 'var(--ink-dim)' }}>{copy.text}</p>}
    </div>
  );
}
