import type { Responder } from '../../board/responder.js';
import { openSheet } from '../../store/sheets.js';

/**
 * H3: the line that says who responded, above every turn and card in the run's thread. A seat's name is
 * a way into its sheet when the run is known (what it did, its terminal); "You" and "crew" are plain.
 * `data-role` is the contract the tests and journeys read: `seat` | `operator` | `crew`.
 */
export function TurnWho({ who, runId = null, suffix = null, className = '' }: {
  who: Responder;
  /** The run the seat worked on: its name opens the seat's sheet for that run. */
  runId?: string | null;
  /** A short state after the name ("answering", "is asking"). */
  suffix?: string | null;
  className?: string;
}): React.ReactElement {
  const name = who.role === 'seat' && who.cli !== null && runId !== null
    ? (
      <button type="button" data-testid="turn-who-seat" data-cli={who.cli} onClick={() => openSheet({ kind: 'helper', runId, cli: who.cli! })} className="wk-link wk-who-name">
        {who.name}
      </button>
    )
    : <span className="wk-who-name">{who.name}</span>;
  return (
    <p data-testid="turn-who" data-role={who.role} {...(who.cli !== null ? { 'data-cli': who.cli } : {})} className={`wk-session-who wk-who wk-who--${who.role}${className !== '' ? ` ${className}` : ''}`}>
      <span aria-hidden className="wk-who-dot" />
      {name}
      {suffix !== null && <span className="wk-who-suffix"> · {suffix}</span>}
    </p>
  );
}
