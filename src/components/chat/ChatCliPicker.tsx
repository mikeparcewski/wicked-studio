import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CliOption } from '../../board/chatCli.js';
import { OPT_IN_NOTE } from '../../store/composerSeats.js';

/**
 * The system chat's CLI picker (DES-SYSTEM-CHAT §5): one answering CLI. The menu lists every CLI; one
 * that cannot answer now is greyed out and says why, with Sign in when signing in is the fix. Fixed once
 * the chat is open (that chat's CLI answers it).
 */
export function ChatCliPicker({ options, value, onChange, locked, onSignIn }: {
  options: readonly CliOption[];
  value: string | null;
  onChange: (key: string) => void;
  locked: boolean;
  /** Go to the Agents page's sign-in for a CLI (the window stays as it is). */
  onSignIn?: (path: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent): void => { if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const chosen = options.find((o) => o.key === value) ?? null;
  const name = chosen?.label ?? (options.length === 0 ? 'No CLI' : 'Pick a CLI');
  return (
    <div ref={boxRef} className="wk-chatcli" data-no-drag>
      <button
        type="button"
        data-testid="chat-cli"
        data-key={value ?? ''}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Answering CLI: ${name}${locked ? ' (set for this chat)' : ''}`}
        title={locked ? `${name} answers this chat — start a new chat to ask another CLI` : 'Which CLI answers'}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
        className="wk-chatcli-btn"
      >
        <span className="wk-chatcli-name">{name}</span>
        {!locked && <ChevronDown size={12} aria-hidden />}
      </button>
      {open && (
        <div role="menu" aria-label="Answering CLI" data-testid="chat-cli-menu" className="wk-chatcli-menu">
          {options.map((o) => (
            <div key={o.key} className="wk-chatcli-row" data-ok={o.ok ? 'true' : 'false'}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={o.key === value}
                data-testid="chat-cli-option"
                data-key={o.key}
                disabled={!o.ok}
                aria-describedby={o.reason !== null ? `chat-cli-why-${o.key}` : undefined}
                onClick={() => { onChange(o.key); setOpen(false); }}
                className="wk-chatcli-option"
              >
                <span aria-hidden className="wk-chatcli-check">{o.key === value ? '✓' : ''}</span>
                <span className="wk-chatcli-label">{o.label}</span>
                {o.optIn && o.ok && <span className="wk-chatcli-why">{OPT_IN_NOTE}</span>}
                {o.reason !== null && <span id={`chat-cli-why-${o.key}`} data-testid="chat-cli-why" className="wk-chatcli-why">{o.reason}</span>}
              </button>
              {o.signInPath !== null && (
                <a
                  href={o.signInPath}
                  data-testid="chat-cli-signin"
                  className="wk-link wk-chatcli-signin"
                  onClick={(e) => {
                    if (onSignIn === undefined || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    setOpen(false);
                    onSignIn(o.signInPath!);
                  }}
                >
                  Sign in
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
