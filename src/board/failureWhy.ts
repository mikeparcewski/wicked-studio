import type { CoreEvent, SessionView } from '../api/types.js';
import { phaseLabel } from '../components/gateVerdictModel.js';
import { engineFailureOf } from './engineFailure.js';
import { stepNoun } from './deskWords.js';

/**
 * A failed job's reason in plain words (DES-frontdoor §4 requirement 3) from what the wire carries:
 * the step that stopped (a `rejected` unit, else the unit at the run's cursor) and its `stepFailed`
 * frames (`failureKind` + `detail`), when the operator asked to see them. studio#815: a run that
 * failed with no step failing (the plan could not be decided, no seat was eligible) says the
 * engine's own `error` frame instead, in the run page's headline (`engineFailureOf`). The engine's
 * own words go to Technical details only.
 */
export interface FailureWhyWords {
  plain: string;
  /** Raw lines for Technical details (the step's denial reason, the failure frames' detail). */
  detail: string[];
}

const KIND_WORDS: Readonly<Record<string, (step: string) => string>> = {
  workerError: (step) => `A helper could not start or finish the ${step} step.`,
  environmentRefused: (step) => `The ${step} step could not start: its working copy was refused.`,
  timeout: (step) => `The ${step} step ran out of time.`,
  timedOut: (step) => `The ${step} step ran out of time.`,
  cancelled: (step) => `The ${step} step was stopped before it finished.`,
};

/** What Retry does on the Desk: a prefill, never a hidden relaunch. */
export const RETRY_WORDS = 'Retry opens a new job with the same words and settings. Nothing starts until you launch it.';

export function failureWhy(view: SessionView, frames: readonly Record<string, unknown>[]): FailureWhyWords {
  const s = view.session;
  const units = [...(view.units ?? [])].sort((a, b) => a.ord - b.ord);
  const stopped = units.find((u) => u.status === 'rejected') ?? units.find((u) => u.ord === s.unit_ix) ?? null;
  const ord = stopped?.ord ?? (typeof frames[0]?.['ord'] === 'number' ? (frames[0]['ord'] as number) : null);
  const step = ord === null ? 'last' : stepNoun(phaseLabel(s.id, units, ord));
  const mine = frames.filter((f) => f['type'] === 'stepFailed' && (ord === null || f['ord'] === ord));
  const last = mine[mine.length - 1];
  const kind = typeof last?.['failureKind'] === 'string' ? (last['failureKind'] as string) : null;
  const times = mine.length > 1 ? ` It failed ${mine.length} times.` : '';
  const detail = [
    ...(stopped?.denial_reason ? [stopped.denial_reason] : []),
    ...mine.map((f) => (typeof f['detail'] === 'string' ? (f['detail'] as string) : '')).filter((d) => d.trim() !== ''),
  ];
  let plain: string;
  if (kind !== null) plain = (KIND_WORDS[kind]?.(step) ?? `The ${step} step failed.`) + times;
  else if (stopped?.status === 'rejected') plain = `A check stopped the ${step} step.`;
  else if (stopped !== null && detail.length > 0) plain = `The ${step} step failed.`;
  else {
    const engine = engineFailureOf(frames as unknown as readonly CoreEvent[]);
    if (engine !== null) {
      plain = engine.headline;
      detail.push(engine.raw);
    } else plain = 'No reason was recorded for this failure.';
  }
  return { plain, detail };
}
