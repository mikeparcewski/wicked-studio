import type { CoreEvent, WorkUnit } from '../api/types.js';

/**
 * studio#761 / studio#762: a gate the engine opened because the run's QE review did not pass.
 *
 * wicked-core folds the isolated QE reviewer's record into the QE unit's gate
 * (DES-QE-EVERY-SEAT §3.4): `fail` and `invalid` deny it under the source `qe_review` (class
 * `verdict_not_pass`), `unavailable` under `qe_reviewer_unavailable` and (j4-gates) `inconclusive` under
 * `qe_inconclusive` (both class `judge_unavailable`, whose plain approve is the operator's own judgment). (e2e-1105 F23)
 * On every record that is no verdict the engine also takes `retry_qe`, the redo of the QE check ({@link QE_REDO_ACTION}).
 * The gate pauses ON the QE unit, so the engine's Approve ("confirm to retry the phase")
 * re-dispatches that unit alone: the QE check runs again (on the same tree it resumes its evidence)
 * and a fresh reviewer judges it. That is the retry an `invalid` record needs: the reviewer recorded
 * no verdict, so nothing was judged and nothing was found wrong with the work. Sending the build
 * back (request_changes) asks the creator to fix a finding that does not exist.
 *
 * Pure. Read from the escalation's `denialSource` / `verdictSummary` (else the gate's
 * `gateEvaluated.denial`), and the unit's own `qe_review.outcome` when the daemon serves it
 * (the unit wire carries it; the published contract does not type it yet, so it is read tolerantly).
 */

export type QeGateOutcome = 'no-verdict' | 'fail' | 'unavailable' | 'inconclusive';

export interface QeGate {
  outcome: QeGateOutcome;
  /** The row's first line: why the gate opened, in plain words, and the move it suggests. */
  lead: string;
  /** One plain line under it: what exactly went wrong (no ids, no paths). */
  why: string;
}

export const QE_RETRY_LABEL = 'Retry the QE review';
export const QE_RETRY_TITLE = 'Run the QE check and its review again on this step only. The earlier steps are kept and nothing is sent back.';
export const QE_RETRY_NOTE_LABEL = 'Retry with a note';
export const QE_RETRY_NOTE_TITLE = 'Run the QE check and its review again with your note. The earlier steps are kept.';

/** (e2e-1105 F23, wicked-core#1312, api-types 0.195.0) REDO THE QE CHECK: at a QE gate whose isolated reviewer gave no
 *  verdict on the work (inconclusive, no reviewer, or no bound verdict) the engine runs the QE step again from fresh
 *  evidence with a new reviewer session. Never a verdict: QE stays required and only that reviewer's PASS counts. At
 *  most 2 per QE step and tree; offered only where the engine's prompt names the action. */
export const QE_REDO_ACTION = 'retry_qe' as const;
export const QE_REDO_KEY = 'redo-qe';
export const QE_REDO_LABEL = 'Redo the QE check';
export const QE_REDO_TITLE = 'Run the QE check again from fresh evidence, with a new reviewer session (on another reviewer seat when one can run). It is not a verdict: only that reviewer\'s pass counts.';
export const QE_REDO_CONSEQUENCE = 'The QE check runs again from fresh evidence with a new reviewer; the earlier steps are kept';

/** Whether the engine's gate prompt offers the redo (`action \`retry_qe\``) — it drops the offer at the cap. */
export function offersQeRedo(prompt: string | undefined): boolean {
  return prompt !== undefined && prompt.includes(`action \`${QE_REDO_ACTION}\``);
}

const QE_SOURCES: ReadonlySet<string> = new Set(['qe_review', 'qe_reviewer_unavailable', 'qe_inconclusive']);

/** What an INCONCLUSIVE reviewer said it could not run (the engine's words after "could not run its checks:"), bounded. */
function couldNotRun(reason: string): string | null {
  const at = reason.indexOf('could not run its checks:');
  if (at < 0) return null;
  const what = reason.slice(at + 'could not run its checks:'.length).trim().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
  if (what === '') return null;
  return what.length > 140 ? `${what.slice(0, 139)}…` : what;
}

/** A binding failure: the QE check's evidence was never found, so no reviewer ran at all. */
function evidenceNotFound(reason: string): boolean {
  return /named no evidence|no `?QE-EVIDENCE|the QE evidence could not be bound/i.test(reason);
}

/** The unit's `qe_review.outcome` when the daemon serves it (untyped on the published contract). */
function unitOutcome(units: readonly WorkUnit[], ord: number): string | null {
  const unit = units.find((u) => u.ord === ord) as (WorkUnit & { qe_review?: unknown }) | undefined;
  const review = unit?.qe_review;
  if (review === null || typeof review !== 'object') return null;
  const outcome = (review as { outcome?: unknown }).outcome;
  return typeof outcome === 'string' ? outcome : null;
}

/**
 * This attempt's evidence for `ord`: its newest `gateEscalated` (source, summary) and `gateEvaluated`
 * denial, read only AFTER the unit's newest `unitDispatched` — a retried unit's earlier QE denial is
 * the previous attempt's, never the reason this gate opened (codex r1: a retry whose worker then
 * crashed opens a triage gate with no new escalation frame).
 */
function attemptDenial(events: readonly CoreEvent[], ord: number): { escalated: { source: string; summary: string } | null; evaluated: { source: string; reason: string } | null } {
  let escalated: { source: string; summary: string } | null = null;
  let evaluated: { source: string; reason: string } | null = null;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]! as Record<string, unknown>;
    if (e['ord'] !== ord) continue;
    if (e['type'] === 'unitDispatched') break;
    if (e['type'] === 'gateEscalated' && escalated === null) {
      escalated = { source: str(e['denialSource']), summary: str(e['verdictSummary']) };
    } else if (e['type'] === 'gateEvaluated' && evaluated === null) {
      const d = e['denial'];
      const { source, reason } = (d !== null && typeof d === 'object' ? d : {}) as { source?: unknown; reason?: unknown };
      evaluated = { source: str(source), reason: str(reason) };
    }
  }
  return { escalated, evaluated };
}

/** What went wrong in a review that recorded no verdict, from the engine's reason. */
function noVerdictWhy(reason: string): string {
  if (/named no evidence|no `?QE-EVIDENCE/i.test(reason)) return 'The QE check named no evidence for its reviewer to read.';
  if (/evidence could not be bound/i.test(reason)) return 'The reviewer could not find the evidence this QE check took.';
  if (/floor fix changed the tree|not on the tree the last QE review judged/i.test(reason)) return 'The work changed after the QE evidence was taken, so the last review no longer applies.';
  if (/ended with no VERDICT line/i.test(reason)) return 'The reviewer finished without giving a verdict.';
  if (/turn on .* ended /i.test(reason)) return 'The reviewer stopped before it gave a verdict.';
  return 'Nothing was found wrong with the work, so the steps before it are kept.';
}

/**
 * The QE gate for `ord`, or `null` when the gate did not open on the QE review. `fail` only when the
 * reviewer's verdict was recorded and was not PASS; any other `qe_review` denial is `no-verdict`.
 */
export function qeGateOf(events: readonly CoreEvent[] | null, units: readonly WorkUnit[], ord: number | undefined, prompt?: string): QeGate | null {
  if (typeof ord !== 'number') return null;
  const log = events ?? [];
  const { escalated: esc, evaluated } = attemptDenial(log, ord);
  const source = esc !== null && esc.source !== '' ? esc.source : evaluated?.source ?? '';
  if (!QE_SOURCES.has(source)) return null;
  const reason = (esc?.summary || evaluated?.reason || '').replace(/^\s*QE acceptance:\s*/i, '');
  const recorded = unitOutcome(units, ord);

  const redo = offersQeRedo(prompt);
  // (F23) The reviewer ran and could not run its checks: an infrastructure miss, not a verdict. The headline names what
  // it could not run and leads with the redo; the person's own judgment stays one of the choices, labelled as theirs.
  if (source === 'qe_inconclusive' || recorded === 'inconclusive') {
    const what = couldNotRun(reason);
    return {
      outcome: 'inconclusive',
      lead: `The QE reviewer couldn't run its checks${what !== null ? ` (${what})` : ''}, so nothing was judged.${redo ? ' Redo the QE check?' : ''}`,
      why: redo
        ? 'No product failure was found and none was ruled out. Redo the QE check, or judge the evidence yourself (labelled as your judgment).'
        : /already redone \d+ times/.test(prompt ?? '')
          ? 'No product failure was found and none was ruled out. The QE check was already redone as often as it can be on this work: judge the evidence yourself (labelled as your judgment), send it back, or stop.'
          : 'No product failure was found and none was ruled out. Judge the evidence yourself (labelled as your judgment), send it back, or stop.',
    };
  }
  if (source === 'qe_reviewer_unavailable' || recorded === 'unavailable') {
    return {
      outcome: 'unavailable',
      lead: `No helper could review the QE evidence on its own, so nothing was judged.${redo ? ' Redo the QE check?' : ''}`,
      why: redo
        ? 'Redo the QE check once a reviewer can run, or judge the evidence yourself (labelled as your judgment).'
        : 'Approve to judge the evidence yourself (it is labelled as your judgment), or stop the run.',
    };
  }
  const failed = recorded === 'fail' || (recorded === null && /\brecorded\s+(?!no\b)[A-Z_]+\s+on QE run\b/.test(reason) && !/\brecorded PASS\b/.test(reason));
  if (failed) {
    return {
      outcome: 'fail',
      lead: 'The QE reviewer said the work does not pass — send it back?',
      why: 'The reviewer judged the QE evidence and recorded a fail. Send the work back to fix it, or run the QE review again.',
    };
  }
  // (F23) A binding failure is no reviewer at all: the evidence was never found, so no reviewer ran to record anything.
  if (evidenceNotFound(reason)) {
    return {
      outcome: 'no-verdict',
      lead: 'The QE check\'s evidence could not be found. Run the QE check again?',
      why: /named no evidence|no `?QE-EVIDENCE/i.test(reason)
        ? 'The QE check named no evidence, so no reviewer ran and nothing was judged.'
        : 'The evidence the QE check took could not be bound to this job, so no reviewer ran and nothing was judged.',
    };
  }
  return {
    outcome: 'no-verdict',
    lead: `The QE reviewer didn't record a verdict, so nothing was judged. ${redo ? 'Redo the QE check?' : 'Retry the QE review?'}`,
    why: noVerdictWhy(reason),
  };
}
