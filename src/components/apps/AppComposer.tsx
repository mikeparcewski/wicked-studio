import { useRef } from 'react';
import { X } from 'lucide-react';
import { chipsOf, removeAboutChip, useComposerChips } from '../../store/composerChips.js';
import type { ComposerSuggestion } from '../session/Composer.js';

/**
 * THE APP'S COMPOSER (K5): the session composer's box, chips and suggestions (same classes, same look), for one job
 * only — a message that becomes an app turn. It offers no `@project`, no helpers and no `/` commands (an app turn is
 * the app's project and crew's roster; xreview r1 on K5: those controls did nothing here), and judges no chat
 * admission of its own: crew judges the turn. The PARENT decides: `onSubmit` answers whether the message was taken,
 * and only a taken message clears the box and its chips (a blocked or refused one keeps both).
 */

const EMPTY: readonly never[] = [];

export function AppComposer({ composerKey, text, setText, onSubmit, placeholder, ariaLabel, suggestions = EMPTY, readOnly = null, busy = false, testId = 'app-composer' }: {
  composerKey: string;
  text: string;
  setText: (t: string) => void;
  /** The words and the component ids on the chips; true when the message was taken (then the box and chips clear). */
  onSubmit: (text: string, about: string[]) => Promise<boolean> | boolean;
  placeholder: string;
  ariaLabel: string;
  suggestions?: readonly ComposerSuggestion[];
  /** Why nothing can be sent from here (a framed studio): the box is read-only and says so. */
  readOnly?: string | null;
  /** A send is in flight: the box keeps typing, Send waits. */
  busy?: boolean;
  testId?: string;
}): React.ReactElement {
  const chips = useComposerChips((s) => chipsOf(s, composerKey));
  const box = useRef<HTMLTextAreaElement | null>(null);
  const latest = useRef(text);
  latest.current = text;
  const about = chips.filter((c) => c.kind === 'about' && c.key.startsWith('cmp:'));
  const canSend = readOnly === null && !busy && text.trim() !== '';
  const submit = async (): Promise<void> => {
    if (!canSend) return;
    const ids = about.map((c) => c.key.slice(4));
    const keys = about.map((c) => c.key);
    const sent = text;
    const taken = await onSubmit(text.trim(), ids);
    if (!taken) return;
    for (const k of keys) removeAboutChip(composerKey, k);
    // The box empties for the message that was taken, unless the person has typed the next one meanwhile.
    if (latest.current === sent) setText('');
  };
  return (
    <div className="wk-composer" data-testid={testId} data-composer={composerKey}>
      {about.length > 0 && (
        <div className="wk-composer-chips" data-testid={`${testId}-chips`}>
          {about.map((c) => (
            <span key={c.key} className="wk-composer-chip" data-testid={`${testId}-chip`}>
              about: {c.label}
              {readOnly === null && (
                <button type="button" className="wk-composer-chip-x" aria-label={`Not about ${c.label}`} onClick={() => removeAboutChip(composerKey, c.key)}>
                  <X size={11} aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {readOnly === null && suggestions.length > 0 && text === '' && (
        <div className="wk-composer-chips" role="group" aria-label="Suggestions" data-testid={`${testId}-suggestions`}>
          {suggestions.map((sg) => (
            <button key={sg.id} type="button" data-testid={`${testId}-suggestion`} title={sg.title} onClick={() => { sg.onPick(); box.current?.focus(); }} className="wk-composer-chip wk-composer-suggestion">{sg.label}</button>
          ))}
        </div>
      )}
      {readOnly !== null && <p className="wk-composer-note" data-testid={`${testId}-readonly`}>{readOnly}</p>}
      <form className="wk-desk-composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <textarea
          ref={box}
          data-testid={`${testId}-input`}
          aria-label={ariaLabel}
          rows={1}
          value={text}
          readOnly={readOnly !== null}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // An IME confirming its composition with Enter sends nothing (as the session composer).
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
          }}
          placeholder={placeholder}
          className="wk-desk-input"
        />
        <button type="submit" data-testid={`${testId}-send`} aria-label="Send" disabled={!canSend} className="wk-desk-send">↑</button>
      </form>
    </div>
  );
}
