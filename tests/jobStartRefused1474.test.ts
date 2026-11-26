import { describe, expect, it } from 'vitest';
import { foldJobLineages, jobView, NO_RUN } from '../src/board/jobStream.js';
import { unitStepName } from '../src/board/chainModel.js';
import { CHAT, jobProposal } from './jobFixtures.js';

/**
 * studio#1474 (J6): a Start that crew refuses AFTER its accepting record (a launch refusal such as 409
 * `power_unavailable` from the launch route's posture check) is reopened by crew: it writes the proposal again under the
 * same pid (wicked-crew packages/crew/src/api/chat-proposals.ts `reopenLaunch`, `{at, turnId, kind: 'proposal',
 * proposal}`), and crew's own fold (`foldProposals`) reads that as the open proposal once more. Studio's fold skipped a
 * proposal record for an accepting pid, so the card stayed "Starting the job…" on the run id the accepting record had
 * minted (which never launched: GET /runs/<id> 404, "The job's run couldn't be read. Retry") with no way out.
 * The records below are crew's writers' shapes: the accepting record at chat-proposals.ts (`kind: 'proposal_accepting',
 * pid, actor, edits, resolution, identity`) and the reopen.
 */

const rec = (at: number, kind: string, body: Record<string, unknown>, turnId = 't1'): Record<string, unknown> => ({ at, turnId, kind, ...body });
const PID = `${CHAT}:t1`;
const accepting = (at: number): Record<string, unknown> =>
  rec(at, 'proposal_accepting', { pid: PID, actor: 'operator', edits: null, resolution: jobProposal(), identity: { runId: '419fbf5e-0000-4000-8000-000000000001', artifactRef: null } });

describe('studio#1474: a Start crew refused and reopened is open again', () => {
  it('the reopen record makes the proposal open, with no run and no accepting time', () => {
    const [l] = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), accepting(3), rec(4, 'proposal', { proposal: jobProposal() })]);
    expect(l!.state).toBe('open');
    expect(l!.runId).toBeNull();
    expect(l!.acceptingAt).toBeNull();
  });

  it('the card offers Start again instead of "starting" on a run that never launched', () => {
    const [l] = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), accepting(3), rec(4, 'proposal', { proposal: jobProposal() })]);
    const v = jobView(l!, NO_RUN, { stepName: unitStepName, now: 5 });
    expect(v.phase).toBe('proposed');
    expect(v.replies.find((r) => r.id === 'start')?.enabled).toBe(true);
  });

  it('a second Start after the reopen is accepting again (crew\'s next accepting record)', () => {
    const [l] = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), accepting(3), rec(4, 'proposal', { proposal: jobProposal() }), accepting(5)]);
    expect(l!.state).toBe('accepting');
    expect(l!.acceptingAt).toBe(5);
  });

  it('an accepting proposal with no reopen still waits on its launch, as before', () => {
    const [l] = foldJobLineages([rec(2, 'proposal', { proposal: jobProposal() }), accepting(3)]);
    expect(l!.state).toBe('accepting');
    expect(jobView(l!, NO_RUN, { stepName: unitStepName, now: 4 }).phase).toBe('starting');
  });
});
