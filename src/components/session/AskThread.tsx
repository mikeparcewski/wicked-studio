import { useState } from 'react';
import type { AskLine } from '../../board/askThread.js';

/**
 * THE ASK THREAD'S QUIET LINES (DES-ASK-TEAM-CHAT-001 §4.8, slice ASK-S1). Render only — the words
 * and the order are `board/askThread.ts`.
 *
 *  - A quiet line sits between the turns at its row's time, in the grey the thread already uses
 *    for its own asides; a problem (a timeout, a re-pick, a refusal) is said in the same voice,
 *    marked so; the end of the conversation is its own line.
 *  - Every line expands to its row's words — the look-underneath (rule 2): the pick and the
 *    roster, the score and the shape, a finding's evidence and suggestion, a helper's answer.
 *  - A line that offers an action (the absent reviewer, the one-seat refusal) carries Sign in.
 *  - The typing line ("claude is thinking") is the one line that is not a row: it stands while the
 *    PA's answer step is claimed and no reply has landed, and leaves when one does.
 */
export function AskLineView({ line, onSignIn, onRetry }: { line: AskLine; onSignIn?: (() => void) | undefined; onRetry?: (() => void) | undefined }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const expandable = line.detail.length > 0;
  return (
    <div data-testid="ask-line" data-kind={line.kind} data-tone={line.tone} data-open={open ? 'true' : 'false'} {...(line.ord !== null ? { 'data-ord': String(line.ord) } : {})} className={`wk-ask-line wk-ask-line--${line.tone}`}>
      <p className="wk-ask-line-text">
        {expandable ? (
          <button type="button" data-testid="ask-line-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="wk-ask-line-btn">
            {line.text}
          </button>
        ) : (
          <span className="wk-ask-line-plain">{line.text}</span>
        )}
        {line.action === 'signin' && onSignIn !== undefined && (
          <>
            {' '}
            <button type="button" data-testid="ask-line-signin" onClick={onSignIn} className="wk-since-toggle wk-ask-line-action">Sign in</button>
          </>
        )}
        {line.action === 'retry' && onRetry !== undefined && (
          <>
            {' '}
            <button type="button" data-testid="ask-line-retry" onClick={onRetry} className="wk-since-toggle wk-ask-line-action">Try again</button>
          </>
        )}
      </p>
      {open && expandable && (
        <ul data-testid="ask-line-detail" className="wk-ask-line-detail">
          {line.detail.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </div>
  );
}

export function AskTyping({ who }: { who: string }): React.ReactElement {
  return (
    <p data-testid="ask-typing" className="wk-ask-line wk-ask-line--quiet wk-ask-typing" aria-live="polite">
      <span aria-hidden className="wk-desk-dot wk-desk-dot--working" /> {who} is thinking
    </p>
  );
}
