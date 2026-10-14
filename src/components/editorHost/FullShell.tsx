import { useEffect, useRef } from 'react';
import type { FullShellProps } from '../../editors/hostApi.js';
import { useHostChrome } from '../../editors/hostApi.js';

/**
 * FULL SCREEN (DES-EDITOR-PLUGIN-CONTRACT-001 §7.3; HOST-API §5): the host's shell around the card's own frame.
 * The tree is the same open or closed — header, body, drawer, in that order — so the frame passed as
 * `children` keeps its place and the iframe never re-parents (EP-D2): a playing video keeps playing.
 */
export function FullShell({ open, tag, title, phase, modes, mode, onMode, gateActions, chat, onExit, children }: FullShellProps): React.ReactElement {
  const chatOpen = useHostChrome((s) => s.chatOpen);
  const setChatOpen = useHostChrome((s) => s.setChatOpen);
  const exitBtn = useRef<HTMLButtonElement | null>(null);
  const hasChat = chat !== undefined && chat !== null;
  const drawer = open && hasChat && chatOpen;

  // Esc leaves full screen — unless something inside consumed it (an input, a menu) or the browser's own
  // fullscreen is up (Esc leaves that first).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.fullscreenElement) return;
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      onExit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onExit]);

  useEffect(() => { if (open) exitBtn.current?.focus(); }, [open]);

  return (
    <div data-testid={open ? 'full-shell' : undefined} data-open={open ? 'true' : 'false'} className={open ? 'wk-full' : 'wk-full wk-full--closed'}>
      {open && (
        <header className="wk-full-head" data-testid="full-shell-head">
          <span className="wk-card-tag">{tag}</span>
          <span className="wk-full-title">{title}</span>
          {phase !== undefined && phase !== null && phase !== '' && <span className="wk-full-phase">{phase}</span>}
          <span className="wk-full-gap" />
          {modes !== undefined && modes !== null && (
            <span role="radiogroup" aria-label="Mode" className="wk-seg">
              {modes.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} data-testid="full-shell-mode" data-mode={m}
                  className={`wk-seg-btn${mode === m ? ' wk-seg-btn--on' : ''}`} onClick={() => onMode?.(m)}>
                  {m === 'simple' ? 'Simple' : 'Advanced'}
                </button>
              ))}
            </span>
          )}
          {gateActions}
          {hasChat && (
            <button type="button" data-testid="full-shell-chat" aria-pressed={chatOpen} className="wk-host-btn" onClick={() => setChatOpen(!chatOpen)}>
              {chatOpen ? 'Hide chat' : 'Chat'}
            </button>
          )}
          <button ref={exitBtn} type="button" data-testid="full-shell-exit" className="wk-host-btn" onClick={onExit}>Esc · back</button>
        </header>
      )}
      <div className={open ? 'wk-full-row' : 'wk-full-row wk-full-row--closed'}>
        <div className="wk-full-body">{children}</div>
        {drawer && (
          <aside data-testid="full-shell-drawer" aria-label="Chat" className="wk-full-drawer">
            <div className="wk-full-drawer-head"><b>Chat</b> <span>the run’s own thread</span></div>
            <div className="wk-full-drawer-body">{chat}</div>
          </aside>
        )}
      </div>
    </div>
  );
}
