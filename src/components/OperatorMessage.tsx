import { useState } from 'react';
import { useDisplayText } from '../hooks/useHomePath.js';
import { splitAskContext } from '../board/askPack.js';

/**
 * The operator's own message in a transcript (studio#468). Ask sends a context pack with the first
 * message — the route, run counts, the daemon's diagnostics — and the daemon stores it as part of
 * that message. What the operator typed is what the transcript shows; the pack is one quiet line
 * that opens to show what was sent (with paths under the home directory as `~/…` in the default
 * layer — a transcript stored before the pack dropped its paths still holds them).
 *
 * Phrasing content only (a button and spans), so it sits inside a bubble's `<p>` or `<div>` alike.
 */
export function OperatorMessage({ text }: { text: string }): React.ReactElement {
  const showText = useDisplayText();
  const [open, setOpen] = useState(false);
  const { typed, pack } = splitAskContext(text);
  if (pack === null) return <>{text}</>;
  return (
    <>
      {typed}
      <span data-testid="context-sent" data-open={open} className="wk-context-sent">
        <button type="button" data-testid="context-sent-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="wk-since-toggle">
          {open ? 'Hide what studio sent with this' : 'Sent with studio’s context'}
        </button>
        {open && <span data-testid="context-sent-pack" className="wk-context-pack">{showText(pack)}</span>}
      </span>
    </>
  );
}
