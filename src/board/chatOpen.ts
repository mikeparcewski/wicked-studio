import type { RosterSeat } from '../api/types.js';

/**
 * S16a-4i: the chat-open helpers kept code uses — the Ask dock's seat default and refusal wording, the
 * launch model's admission read — moved here unchanged from the retired chat page.
 */

/**
 * The DAEMON's chat admission verdict for one seat and one scope mode (F-W1-005, wave-1 P6):
 * crew ≥ 0.7.36 publishes `chat_admission: { unscoped, scoped }` on every `GET /roster` seat —
 * computed by the SAME predicate its `POST /chats` pre-filter runs — so the picker offers exactly
 * the seats an open would seat. There is deliberately NO client-side capability rule beside it
 * (review MED-1): studio hard-codes no seat kinds, so the pending F-W1-003 decision (chat stays
 * ACP-seats-only, or wrapped seats get a path) lands entirely in that daemon-side predicate. A
 * daemon that publishes no verdict is not second-guessed — every seat is offered, and its own
 * answer at open is the truth (a refusal renders with its reason and is re-seatable via Retry).
 * Rides `RosterSeat`'s index signature until api-types 0.39.0 types it.
 */
export interface ChatAdmissionVerdict {
  ok: boolean;
  reason?: string;
  source?: string;
}

/**
 * The verdict for `seat` in the given scope mode — the daemon's, or "admissible" when it states
 * none. Never a client-side judgement of what a seat can do (review MED-1).
 */
export function chatAdmissionOf(seat: RosterSeat, scoped: boolean): ChatAdmissionVerdict {
  const a = seat['chat_admission'] as
    | { unscoped?: ChatAdmissionVerdict; scoped?: ChatAdmissionVerdict }
    | null
    | undefined;
  const v = a !== null && typeof a === 'object' ? (scoped ? a.scoped : a.unscoped) : undefined;
  return v !== undefined && v !== null && typeof v.ok === 'boolean' ? v : { ok: true };
}

/**
 * The default chip selection for a chat being created: the seats the daemon would SEAT in this
 * scope mode (its `chat_admission` verdict — F-W1-005), or, on a daemon without the verdict, the
 * CHAT-CAPABLE subset of the roster (EC44 — the incapable ones are offered in [+ Add], labeled
 * honestly, never silently default-selected into guaranteed failures). Pure derivation — never a
 * request.
 */
export function defaultSelection(roster: RosterSeat[], scoped = false): string[] {
  return roster.filter((s) => chatAdmissionOf(s, scoped).ok).map((s) => s.key);
}

/**
 * The operator sentence for a refused `POST /chats` (crew#502's own status
 * codes): 404 = a named ref is not registered (every missing one is in the
 * daemon's sentence); 400 "ambiguous" = a NAME two checkouts share (name it by
 * id); 409 = a daemon-side conflict (scratch-base overlap, an id still closing,
 * an archived project); 501 = the installed engine cannot ground a scoped chat
 * (predates chat scope) — the Unscoped fallback is offered beside it. Anything
 * else keeps the translated message as-is.
 */
export function describeChatOpenRefusal(status: number | null, wire: string | null, fallback: string): string {
  if (status === 404 && wire !== null) {
    // Only a REPO 404 (`Repo 'x', 'y' not found` — chat-scope.ts) gets the repo remedy; the route
    // also answers 404 `Project <id> not found` (routes.ts), which reads plain.
    return /^Repo /.test(wire)
      ? `Scope refused — ${wire}. Name repositories that are registered (by id, or a name only one repo carries) and send again.`
      : wire;
  }
  if (status === 400 && wire !== null && /`scopeKind`/.test(wire)) {
    // A daemon without api-types 0.39.0's named kinds rejects the field as unknown (studio#323 R4).
    return `This daemon predates the System and Everything chat scopes — upgrade wicked-crew, or choose Project or Repos. (${wire})`;
  }
  if (status === 400 && wire !== null && /ambiguous/i.test(wire)) {
    return `Scope refused — ${wire}`;
  }
  if (status === 409 && wire !== null) {
    return `The daemon refused to open this chat — ${wire}`;
  }
  if (status === 501 && wire !== null) {
    return `This daemon cannot open a SCOPED chat — ${wire}`;
  }
  return fallback;
}
