/**
 * CAPTURE ANYTHING (Studio OS behaviour 8) — the pure half, on the actionable pattern.
 *
 * A capture is dropped where you already are (the Home verb row beside Do Work, or the Ask dock).
 * Crew files a small run whose only output is proposals in the ONE governed-knowledge queue; those
 * rows land in Home's existing Needs You proposal triage (Wave B, idea 4) with the consequence of
 * accepting each one first. There is no second review surface: this model only says, in words,
 * what the drop will do and what the capture has filed so far.
 *
 * What the team filed each row as rides the row's `payload.capture` (crew's capture brief): an
 * INTENT, a DECISION or a MEMORY is `kind_type: "memory"`; a RULE is `kind_type: "policy:<type>"`.
 */

import { captureImageType } from '../api/capture.js';
import type { Proposal } from '../api/proposals.js';
import { proposalConsequence } from './proposalTriage.js';

export { captureClass, type CaptureClass } from './proposalTriage.js';

/** Whether a picked file rides the capture as a photo (vs text). */
export function isCaptureImage(file: { name: string; type: string }): boolean {
  return captureImageType(file) !== null;
}

/** The drop's consequence, shown before the send. */
export function captureConsequence(projectName: string): string {
  return `The team reads these and files what they say as proposals on ${projectName}. `
    + 'They land in Needs You on Home, each with what accepting it does. Nothing is kept until you accept it.';
}

/** What one capture run has filed: every row seen, and those still waiting, by consequence. */
export interface CaptureFiled {
  /** Rows the run filed that have been seen at all (pending when first read). */
  seen: number;
  /** Still pending in the queue: waiting in Needs You. */
  waiting: number;
  memoryOnly: number;
  changesEnforcement: number;
}

/**
 * The capture run's rows: `seenIds` are every row of the run ever read pending (a decided row
 * leaves the pending queue, so the count of what was filed is kept apart from what still waits).
 */
export function captureFiled(pending: readonly Proposal[], runId: string, seenIds: readonly string[]): CaptureFiled {
  const mine = pending.filter((p) => p.state === 'pending' && p.provenance.run_id === runId);
  const seen = new Set(seenIds);
  for (const p of mine) seen.add(p.id);
  return {
    seen: seen.size,
    waiting: mine.length,
    memoryOnly: mine.filter((p) => proposalConsequence(p) === 'memory').length,
    changesEnforcement: mine.filter((p) => proposalConsequence(p) === 'enforcement').length,
  };
}

const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

/** The status line under the drop: what the capture has filed, and where it waits. */
export function captureFiledLine(f: CaptureFiled, projectName: string, runDone: boolean): string {
  if (f.seen === 0) {
    return runDone
      ? `Captured to ${projectName}: the team filed nothing`
      : `Captured to ${projectName}: the team is reading it…`;
  }
  if (f.waiting === 0) return `${n(f.seen, 'proposal', 'proposals')} filed from your capture to ${projectName}: all decided`;
  const split = [
    ...(f.memoryOnly > 0 ? [`${f.memoryOnly} memory-only`] : []),
    ...(f.changesEnforcement > 0 ? [`${f.changesEnforcement} ${f.changesEnforcement === 1 ? 'changes' : 'change'} enforcement`] : []),
  ].join(', ');
  const still = runDone ? '' : ' (the team is still reading)';
  return `${n(f.waiting, 'proposal', 'proposals')} from your capture waiting in Needs You${split !== '' ? `: ${split}` : ''}${still}`;
}

/** The count on Home's Capture verb itself: short, because the Needs You group right below carries
 *  the consequence split. The full line rides its title and the open drop. */
export function captureFiledChip(f: CaptureFiled, runDone: boolean): string {
  if (f.seen === 0) return runDone ? 'nothing filed' : 'reading…';
  if (f.waiting === 0) return 'all decided';
  return `${f.waiting} waiting`;
}
