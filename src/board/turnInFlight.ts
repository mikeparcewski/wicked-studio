/**
 * A chat message the daemon refused because the previous turn has not CLOSED yet (crew's 409 `turn_in_flight`).
 *
 * artifact-runs-fix (rig, chat 2064e303): the answer renders (`chatReply`) while the ask path's run is still
 * finishing that turn (its review, its turn gate), so a follow-up sent a second after the answer appeared was
 * refused with "claude is still answering". The composer keeps the draft and holds Send until the turn has closed
 * (the path's run is no longer working); the person sends it then. Nothing is sent on their behalf, so a message
 * can never go twice, to another chat, or after they changed their mind.
 */
export class TurnInFlightError extends Error {
  /** Who is still answering, in the Desk's words. */
  readonly who: string;
  /** The ask path's run whose turn is still open, when crew named it (its 409 body) or the thread knows it. */
  readonly runId: string | null;
  constructor(who: string, runId: string | null = null) {
    super(`${who} is still answering — wait for the reply; your message was not sent.`);
    this.name = 'TurnInFlightError';
    this.who = who;
    this.runId = runId;
  }
}

/** A run status that means the turn is still being worked on. */
export function turnStillOpen(status: string | null | undefined): boolean {
  return status === 'planning' || status === 'distributing' || status === 'executing' || status === 'running';
}

/** How often the composer reads the path's run while Send waits, and for how long before it lets the person try
 *  again anyway (a test shortens them). */
export const TURN_WAIT = { pollMs: 3_000, giveUpMs: 10 * 60_000 };
