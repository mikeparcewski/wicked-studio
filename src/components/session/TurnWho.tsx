import type { Responder } from '../../board/responder.js';
import { messageTimeIso, messageTimeWords, type MessageTime } from '../../board/messageTimes.js';
import { openSheet } from '../../store/sheets.js';

/**
 * H3: the line that says who responded, above every turn and card in the run's thread. A seat's name is
 * a way into its sheet when the run is known (what it did, its terminal); "You" and "crew" are plain.
 * `data-role` is the contract the tests and journeys read: `seat` | `operator` | `crew`.
 */
export function TurnWho({ who, runId = null, suffix = null, className = '', inline = false, at = null }: {
  who: Responder;
  /** The run the seat worked on: its name opens the seat's sheet for that run. */
  runId?: string | null;
  /** A short state after the name ("answering", "is asking"). */
  suffix?: string | null;
  className?: string;
  /** Inside a line of its own (a card's one-line head): a span, not a paragraph. */
  inline?: boolean;
  /** When the message was said (unix ms), or the span a step ran: shown after the name and suffix, "· 14:03". */
  at?: MessageTime | number | null;
}): React.ReactElement {
  const time = typeof at === 'number' ? { from: at > 0 ? at : null, to: null } : at;
  const words = messageTimeWords(time);
  const iso = messageTimeIso(time);
  const name = who.role === 'seat' && who.cli !== null && runId !== null
    ? (
      <button type="button" data-testid="turn-who-seat" data-cli={who.cli} onClick={() => openSheet({ kind: 'helper', runId, cli: who.cli! })} className="wk-link wk-who-name">
        {who.name}
      </button>
    )
    : <span className="wk-who-name">{who.name}</span>;
  const Tag = inline ? 'span' : 'p';
  return (
    <Tag data-testid="turn-who" data-role={who.role} {...(who.cli !== null ? { 'data-cli': who.cli } : {})} className={`wk-session-who wk-who wk-who--${who.role}${className !== '' ? ` ${className}` : ''}`}>
      {/* The chat thread draws the dot as a small round mark with the speaker's initial (DES-CHAT-NATIVE-RUN). */}
      <span aria-hidden className="wk-who-dot" data-initial={who.name.slice(0, 1).toUpperCase()} />
      {name}
      {suffix !== null && <span className="wk-who-suffix"> · {suffix}</span>}
      {words !== null && iso !== null && <time data-testid="turn-who-at" dateTime={iso} title={new Date(iso).toLocaleString()} className="wk-who-suffix wk-who-at"> · {words}</time>}
    </Tag>
  );
}
