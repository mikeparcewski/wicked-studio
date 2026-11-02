import type { BaseSkillPosture, BaseSkillRefusedResponse, LaunchBodyWithDeliver, RosterSeat } from '../api/types.js';
import { ApiError } from '../api/errors.js';
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
/**
 * The gate-posture options in plain words (operator 2026-10-10 / UX audit row 3), shared by the
 * composer's launch strip and the /runs/new form so the two read as one product. The control is
 * labelled "Ask me", so each option finishes that sentence.
 */
export function gatePostureWord(mode: 'before' | 'all' | 'none', beforeOrd: number, autoDeliver = false): string {
  if (mode === 'before') return beforeOrd === 1 ? 'Before the first step' : `Before step ${beforeOrd}`;
  if (mode === 'all') return 'Before every step';
  return autoDeliver ? 'Never (it delivers on its own)' : 'Never: run straight through';
}

/** The status line's gate words, in the same vocabulary as the options ("asks you before the first step"). */
export function gateSentence(mode: 'before' | 'all' | 'none', beforeOrd: number): string {
  return mode === 'none' ? 'never asks' : `asks you ${gatePostureWord(mode, beforeOrd).toLowerCase()}`;
}

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

/**
 * studio#275: the composer's confirm line for the BASE (discipline) skill the next launch carries,
 * read off `GET /health.baseSkill` — `discipline skill: <name> gen N`, or what a missing skill does
 * under the daemon's policy. `null` (setting off, seam disabled) and ABSENT (an older daemon) say
 * nothing: there is no discipline to disclose.
 */
export function describeBaseSkill(posture: BaseSkillPosture | null | undefined): string | null {
  if (posture === null || posture === undefined) return null;
  if (posture.present) return `discipline skill: ${posture.name} gen ${posture.gen ?? '?'}`;
  return posture.policy === 'require'
    ? `discipline skill: ${posture.name} MISSING — runs will be refused at intake`
    : `discipline skill: ${posture.name} MISSING — runs proceed without it`;
}

/** studio#275: the typed `POST /runs` 422 `base_skill_refused` body, or `null` for any other error. */
export function baseSkillRefusalOf(err: unknown): BaseSkillRefusedResponse | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const b = err.body;
  if (typeof b !== 'object' || b === null) return null;
  const r = b as Partial<BaseSkillRefusedResponse>;
  if (r.code !== 'base_skill_refused' || typeof r.error !== 'string') return null;
  return {
    code: 'base_skill_refused',
    error: r.error,
    baseSkill: r.baseSkill ?? null,
    remedy: typeof r.remedy === 'string' ? r.remedy : '',
  };
}

/**
 * studio#404: a client-minted run id for `POST /runs {sessionId}` — the daemon launches under the id
 * the caller names, so the composer knows the run before the 201 lands and can offer it while a slow
 * POST is outstanding. `null` where the browser has no `crypto.randomUUID` (an insecure origin): the
 * launch then waits for the 201 as before.
 */
export function newLaunchId(): string | null {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof c?.randomUUID === 'function' ? c.randomUUID() : null;
}

/** studio#404: how long a launch POST is outstanding before the composer looks for the run itself. */
export const LAUNCH_PROBE_AFTER_SECS = 5;

/**
 * The one `POST /runs` body a named-workflow launch sends (the launch wizard; formerly the composer's
 * inline strip, whose body this reproduces field for field — tests/launchWizard.test.tsx pins it).
 * Pure: every capability and choice is passed in.
 */
export interface WorkflowLaunchChoices {
  workflowId: string;
  intent: string;
  /** The seats this launch uses (already filtered to the helpers shown, minus the dropped). */
  seats: readonly RosterSeat[];
  repoRef: string | null;
  projectId: string | null;
  /** The gate posture's wire token, resolved by the launch preview (undefined = say nothing). */
  humanConfirm: string | undefined;
  /** null = the workflow runs no code, so no delivery key is sent. */
  deliver: 'pr' | 'none' | null;
  /** The "never ask me" posture on a daemon that keeps a deliver gate. */
  autoDeliverGate: boolean;
  reducedAssurance: boolean;
  skipQeReason: string | null;
  chatId: string | null;
  /** The lead agent the operator chose (a key among `seats`, on a daemon that takes it); null = Random. */
  primary?: string | null;
  /** Power mode for this job (DES-POWER-MODE §2), on a daemon that runs it; null/absent = say nothing (the daemon's
   *  Settings default applies, and an older daemon's strict schema never sees the key). */
  power?: boolean | null;
}

export function workflowLaunchBody(c: WorkflowLaunchChoices): LaunchBodyWithDeliver {
  const body: LaunchBodyWithDeliver = { problem: c.intent.trim(), workflow: c.workflowId };
  if (c.reducedAssurance) body.reducedAssurance = true;
  if (c.seats.length > 0) body.clisJson = JSON.stringify(c.seats);
  if (c.repoRef !== null) body.repoRef = c.repoRef;
  if (c.projectId !== null) body.projectId = c.projectId;
  if (c.humanConfirm !== undefined) body.humanConfirm = c.humanConfirm;
  if (c.deliver !== null) body.deliver = c.deliver;
  // F-E2E-030: only the explicitly unattended posture sends the opt-out, and only with a delivery.
  if (body.deliver === 'pr' && c.autoDeliverGate) body.deliverGate = 'auto';
  if (c.skipQeReason !== null && c.skipQeReason.trim() !== '') body.skipQeAcceptance = { reason: c.skipQeReason.trim() };
  if (c.chatId !== null) body.chatId = c.chatId;
  if (c.primary != null && c.seats.some((s) => s.key === c.primary)) body.primary = c.primary;
  if (c.power != null) (body as LaunchBodyWithDeliver & { power?: boolean }).power = c.power;
  return body;
}

/**
 * The lead agent a launch sends (DES-TEAMING-002 §8.1): the operator's pick when the daemon takes
 * `primary` and the pick is still one of the launch's seats, else null (Random — the engine picks).
 */
export function launchLead(lead: string | null, seats: readonly RosterSeat[], capable: boolean): string | null {
  if (!capable || lead === null) return null;
  return seats.some((s) => s.key === lead) ? lead : null;
}
