import type { SessionView } from '../api/types.js';

/**
 * DES-CHAT-ARTIFACTS-001 §7 (slice A4, PLAN S1 G1): a proposal's slot — the run its Go started, drawn right under the
 * proposal card (`RunArtifacts`), so what it made sits at the proposal, filed or Unfiled, and never a second time in the
 * run's own block.
 *
 * The run is the one crew recorded on the proposal's result (`result.runId`), else the run whose `proposal_id` is the
 * proposal's. Of several slots for ONE artifact (a failed attempt and its Try again fill the same `artifact_ref`), only
 * the newest draws the card; the others say one line.
 */
export interface ProposalSlot {
  pid: string;
  run: SessionView;
  /** True: an older attempt at an artifact a newer slot shows. */
  older: boolean;
}

export interface SlotProposal {
  pid: string;
  result?: { runId: string } | null;
}

const refOf = (v: SessionView): string | null => {
  const r = (v.session as { artifact_ref?: unknown }).artifact_ref;
  return typeof r === 'string' && r !== '' ? r : null;
};
const pidOf = (v: SessionView): string | null => {
  const p = (v.session as { proposal_id?: unknown }).proposal_id;
  return typeof p === 'string' && p !== '' ? p : null;
};

/** The slots for the proposals drawn as cards, by pid. `launchedAt` orders attempts (newest wins the card). */
export function proposalSlots(proposals: readonly SlotProposal[], runs: readonly SessionView[], launchedAt: (v: SessionView) => number): Map<string, ProposalSlot> {
  const out = new Map<string, ProposalSlot>();
  const taken = new Set<string>();
  for (const p of proposals) {
    const byResult = p.result?.runId !== undefined ? runs.find((v) => v.session.id === p.result!.runId) : undefined;
    const run = byResult ?? runs.find((v) => pidOf(v) === p.pid);
    if (run === undefined || taken.has(run.session.id)) continue;
    taken.add(run.session.id);
    out.set(p.pid, { pid: p.pid, run, older: false });
  }
  // One live card per artifact: the newest attempt's.
  const newest = new Map<string, ProposalSlot>();
  for (const s of out.values()) {
    const ref = refOf(s.run);
    if (ref === null) continue;
    const was = newest.get(ref);
    if (was === undefined || launchedAt(s.run) >= launchedAt(was.run)) {
      if (was !== undefined) was.older = true;
      newest.set(ref, s);
    } else {
      s.older = true;
    }
  }
  return out;
}

/** The one line an older attempt says in place of its card: crew's reason it did not land, else where the card is. */
export function olderSlotLine(run: SessionView): string {
  const failed = (run.session as { landing_failed?: { reason?: unknown } }).landing_failed;
  const why = typeof failed?.reason === 'string' ? failed.reason.trim() : '';
  if (why !== '') return `Not made: ${why}`;
  return 'Shown below, with the newer attempt.';
}
