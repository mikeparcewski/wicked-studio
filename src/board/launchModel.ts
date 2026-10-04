import type { RosterSeat } from '../api/types.js';
import { chatAdmissionOf } from '../components/GroupChat.js';
import { noCarryingSeatReason, seatCanCarry } from '../components/gateVerdictModel.js';

/**
 * THE LAUNCH RULES (DES-STUDIO-REBUILD-001 §5.5, slice S7), extracted from ChatInput so every
 * composer refuses the same way: the run page's launch form, the Desk's composer and a session's.
 * Pure: no React, no store.
 */

/** The workflow a free-text intent reads as (`bug`, `feature`, `migration`), or `null`. */
export function detectWorkflow(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(bug|fix|broken|error|crash|issue)\b/.test(lower)) return 'bug';
  if (
    /\b(feature|implement|add|create)\b/.test(lower) &&
    !/\b(bug|fix|broken|error|crash|issue)\b/.test(lower)
  )
    return 'feature';
  if (/\b(migrate|upgrade|migration|move)\b/.test(lower)) return 'migration';
  return null;
}

/** What the launch form's Send needs, all of it read by the caller. */
export interface LaunchSubmitInput {
  problem: string;
  selectedClis: ReadonlySet<string>;
  submitting: boolean;
  /** Build-kind work with several repos attached and no target chosen (F-028). */
  targetRequired: boolean;
  roster: readonly RosterSeat[] | null;
  /** studio#429: a launch on a repository with no steps, preset or workflow — the engine runs it as
   *  ONE neutral unit (no PA scope, no evaluator, no deliver). A designed launch (a repo as context,
   *  D2), so it still sends; the form says what it will be. Absent ⇒ false. */
  planMissing?: boolean;
}

/** studio#429: what a repository launch with nothing that plans the work will run as. */
export const PLAN_MISSING_NOTE =
  'This runs as one step on the repository — no PA scope, no review, no delivery. Pick the steps (or a preset) to have it planned and reviewed.';

/**
 * Whether the launch form may send, and the studio#315 reason when the roster SAYS no selected seat
 * can take the work (benched or not council-eligible). A cold roster or an unknown seat is never a
 * refusal.
 */
export function launchSubmit(input: LaunchSubmitInput): { canSubmit: boolean; noSeatReason: string | null; planNote: string | null } {
  const noSeatReason = noCarryingSeatReason(input.selectedClis, input.roster);
  const planNote = input.planMissing === true ? PLAN_MISSING_NOTE : null;
  const canSubmit = input.problem.trim().length > 0 && input.selectedClis.size > 0 && !input.submitting
    && !input.targetRequired && noSeatReason === null;
  return { canSubmit, noSeatReason, planNote };
}

/**
 * The Desk's and a session's composer (S7): the message opens (or continues) a chat whose seats are
 * the roster's. When the roster SAYS not one seat can carry it — each benched, not council-eligible,
 * or refused by the daemon's own chat admission for this scope — the composer refuses to send and
 * names why (studio#315): the send would only fail at the daemon. A cold (unread) roster is never a
 * refusal; an empty one is.
 * `null`: send.
 */
export function composerSendRefusal(roster: readonly RosterSeat[] | null, scoped: boolean): string | null {
  if (roster === null) return null;
  // A roster the daemon ANSWERED with no seats is an answer, not a cold read (codex on S7).
  if (roster.length === 0) return 'No helper is set up on this daemon yet — add one under Settings.';
  const reasons: string[] = [];
  for (const seat of roster) {
    const admission = chatAdmissionOf(seat, scoped);
    if (admission.ok && seatCanCarry(seat)) return null;
    reasons.push(!admission.ok
      ? `${seat.key}: ${admission.reason ?? 'the daemon would not seat it'}`
      : noCarryingSeatReason([seat.key], roster) ?? `${seat.key}: unavailable`);
  }
  return `No helper can take this right now — ${reasons.join(' · ')}.`;
}
