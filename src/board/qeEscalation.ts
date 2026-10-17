import type { CoreEvent, WorkUnit } from '../api/types.js';
import { escalationFor } from './assuranceModel.js';

/**
 * studio#761 / studio#762: a gate the engine opened because the run's QE review did not pass.
 *
 * wicked-core folds the isolated QE reviewer's record into the QE unit's gate
 * (DES-QE-EVERY-SEAT §3.4): `fail` and `invalid` deny it under the source `qe_review` (class
 * `verdict_not_pass`), `unavailable` under `qe_reviewer_unavailable` (class `judge_unavailable`).
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

export type QeGateOutcome = 'no-verdict' | 'fail' | 'unavailable';

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

const QE_SOURCES: ReadonlySet<string> = new Set(['qe_review', 'qe_reviewer_unavailable']);

/** The unit's `qe_review.outcome` when the daemon serves it (untyped on the published contract). */
function unitOutcome(units: readonly WorkUnit[], ord: number): string | null {
  const unit = units.find((u) => u.ord === ord) as (WorkUnit & { qe_review?: unknown }) | undefined;
  const review = unit?.qe_review;
  if (review === null || typeof review !== 'object') return null;
  const outcome = (review as { outcome?: unknown }).outcome;
  return typeof outcome === 'string' ? outcome : null;
}

/** The newest `gateEvaluated.denial` for `ord` (source and reason), when the log has one. */
function evaluatedDenial(events: readonly CoreEvent[], ord: number): { source: string; reason: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]! as Record<string, unknown>;
    if (e['type'] !== 'gateEvaluated' || e['ord'] !== ord) continue;
    const d = e['denial'];
    if (d === null || typeof d !== 'object') return null;
    const { source, reason } = d as { source?: unknown; reason?: unknown };
    return typeof source === 'string' ? { source, reason: typeof reason === 'string' ? reason : '' } : null;
  }
  return null;
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
export function qeGateOf(events: readonly CoreEvent[] | null, units: readonly WorkUnit[], ord: number | undefined): QeGate | null {
  if (typeof ord !== 'number') return null;
  const log = events ?? [];
  const esc = escalationFor(log, ord);
  const evaluated = evaluatedDenial(log, ord);
  const source = esc !== null && esc.denialSource !== '' ? esc.denialSource : evaluated?.source ?? '';
  if (!QE_SOURCES.has(source)) return null;
  const reason = (esc?.summary || evaluated?.reason || '').replace(/^\s*QE acceptance:\s*/i, '');
  const recorded = unitOutcome(units, ord);

  if (source === 'qe_reviewer_unavailable' || recorded === 'unavailable') {
    return {
      outcome: 'unavailable',
      lead: 'No helper could review the QE evidence on its own, so nothing was judged.',
      why: 'Approve to judge the evidence yourself (it is labelled as your judgment), or stop the run.',
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
  return {
    outcome: 'no-verdict',
    lead: 'The QE reviewer didn\'t record a verdict, so nothing was judged. Retry the QE review?',
    why: noVerdictWhy(reason),
  };
}
