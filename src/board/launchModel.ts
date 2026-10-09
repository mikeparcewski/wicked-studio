import type { RosterSeat } from '../api/types.js';
import { chatAdmissionOf } from './chatOpen.js';
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

/** THE WORKFLOW COMMAND (DES-STUDIO-REBUILD-001 §5.5/§5.7, slice S19a): a workflow is named with a
 *  `/workflow-<key>` FIRST token in the composer, and Enter launches it. These are the ONE shared
 *  rules the launch form and the composer read — the no-repo preflight predicate and the
 *  launch-confirm line's lead — so the two surfaces can never disagree on what is ready. */

/** S19a: the composer refuses to launch a workflow with no repository, and says so. */
export const NO_REPO_REASON = 'Pick the repository this works in';

/** §7.8 preflight (EC43): a code-shaped intent with no repo attached cannot produce reviewable
 *  work. The launch form warns and blocks; the composer refuses the chip the same way. */
export function launchNeedsRepo(codeShaped: boolean, noRepoAttached: boolean): boolean {
  return codeShaped && noRepoAttached;
}

/** The launch-confirm line's lead — from the SAME `canSubmit` that disables Send, so the line and
 *  the button can never disagree ("Send enabled but Not ready to send", F-089 / F-E2E-035). */
export function readyLead(canSubmit: boolean, noSeatReason: string | null): string {
  return canSubmit
    ? 'Ready to send: '
    : noSeatReason !== null
      ? 'Not ready to send (no seat can take it): '
      : 'Not ready to send: ';
}

/** What a `/workflow-<key>` launch still needs before Enter may send. */
export interface WorkflowLaunchState {
  ready: boolean;
  /** Why it cannot send yet (`null` = ready). */
  reason: string | null;
  /** The one thing missing, when it is the repository. */
  missing: 'repo' | null;
}

/** S19a: the composer's own readiness for a named workflow — a repository to work in, and a roster
 *  that can take it. The repo is the composer's to pick (the form's is in its popover). */
export function workflowLaunchState(
  repoRef: string | null,
  roster: readonly RosterSeat[] | null,
): WorkflowLaunchState {
  if (repoRef === null || repoRef.trim() === '') {
    return { ready: false, reason: NO_REPO_REASON, missing: 'repo' };
  }
  if (roster !== null && roster.length === 0) {
    return { ready: false, reason: 'No helper is set up on this daemon yet — add one under Settings.', missing: null };
  }
  return { ready: true, reason: null, missing: null };
}
