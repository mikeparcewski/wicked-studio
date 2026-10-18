import type { RosterSeat } from '../api/types.js';
import { seatLabel } from '../board/seatNames.js';
import { seatOff, useComposerSeats } from '../store/composerSeats.js';

/**
 * studio#840: the Ask drawer's helpers row — the seats its first send opens the chat with (the
 * daemon's admitted seats for the chosen scope), each on or off. It writes the same choice as the
 * Desk / session composer's row (`useComposerSeats`), so the refusal "turn one on in the helpers
 * row" always has a row to point at. Shown only before the chat opens: a started chat keeps its
 * seats.
 */
export function AskHelpers({ roster, eligible }: { roster: readonly RosterSeat[] | null; eligible: readonly string[] }): React.ReactElement | null {
  const dropped = useComposerSeats((s) => s.dropped);
  const picked = useComposerSeats((s) => s.picked);
  const toggle = useComposerSeats((s) => s.toggle);
  if (eligible.length === 0) return null;
  const anyOn = eligible.some((k) => !seatOff(k, dropped, picked));
  return (
    <div data-testid="ask-helpers" role="group" aria-label="Helpers this question goes to" className="wk-composer-chips">
      <span className="wk-composer-note">Helpers</span>
      {eligible.map((key) => {
        const on = !seatOff(key, dropped, picked);
        const seat = (roster ?? []).find((s) => s.key === key);
        const name = seat === undefined ? seatLabel({ key }) : seatLabel(seat);
        return (
          <button
            key={key}
            type="button"
            data-testid="ask-helper"
            data-key={key}
            aria-pressed={on}
            title={on ? `${name} answers — click to leave it out` : `${name} is left out — click to include it`}
            onClick={() => toggle(key)}
            className={`wk-composer-chip wk-composer-seat${on ? '' : ' wk-composer-seat--off'}`}
          >
            {name}
          </button>
        );
      })}
      {!anyOn && (
        <span data-testid="ask-helpers-none" role="status" className="wk-composer-note wk-composer-note--bad">
          Every helper is off — turn one on to send.
        </span>
      )}
    </div>
  );
}
