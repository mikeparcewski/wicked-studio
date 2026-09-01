/**
 * The Chat section's fold layer (lane B, the 0.4.6 command-surface treatment):
 * pure derivations over the TWO chat wires —
 *
 *  - `GET /runs` carries chat HISTORY: chat sessions are runs (workflow
 *    `chat`, plus legacy unstamped runs — `isChatRun`'s partition), so every
 *    windowed count reuses `windowBuckets`/`windowDelta`/`statusCounts`
 *    verbatim (never re-implemented here);
 *  - `GET /chats` carries only the LIVE seat pool: `{chatId, seats, idleSecs}`
 *    per warm session, nothing more — so the only live-side metrics are the
 *    ones that wire honestly answers: how many warm sessions, how many seats
 *    they hold, and which have sat idle past a threshold.
 *
 * Message/turn counts are NOT served by either wire, so no fold invents them.
 */

/** One warm chat session as `GET /chats` serves it (FINDING-027's shape). */
export interface LiveChatSnapshot {
  chatId: string;
  seats: string[];
  /** `null` = the daemon holds no idle age for this session. */
  idleSecs: number | null;
}

/** Warm agent seats across every live session — the wire's own seat lists. */
export function liveSeatCount(chats: readonly LiveChatSnapshot[]): number {
  return chats.reduce((a, c) => a + c.seats.length, 0);
}

/**
 * A live session counts as STALLED once its daemon-reported idle age passes
 * this threshold — warm seats someone paid for that nothing is driving.
 * `idleSecs: null` (age unknown) never counts: absence stays absent.
 */
export const STALLED_IDLE_SECS = 600;

export function stalledLiveChats(
  chats: readonly LiveChatSnapshot[],
  stalledAfterSecs: number = STALLED_IDLE_SECS,
): LiveChatSnapshot[] {
  return chats.filter((c) => c.idleSecs !== null && c.idleSecs >= stalledAfterSecs);
}
