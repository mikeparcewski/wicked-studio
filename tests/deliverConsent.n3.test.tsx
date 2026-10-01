// N3 (ship re-proof) — on a non-GitHub origin the deliver gate contradicted itself. The prompt
// said "no pull request can be opened" (the workflow's card, only behind "show the full prompt"
// and after a raw ` ||| `) AND "…opens a pull request on `tally-kit`" (the engine's boilerplate);
// the visible consent line said only "Deliver pushes the run branch: 4 files changed, +17, −2".
//
// The consent line must state what will actually happen, and no raw separator may render. The
// prompt below is the re-proof's, verbatim in shape, as the PUBLISHED engine still writes it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { deliverTargetOf, gateRowVerb, recommendGateMove } from '../src/components/gateMoveModel.js';
import * as client from '../src/api/client.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeUnit } from './factories.js';

const RUN = 'efe69c4b-0000-0000-0000-000000000000';
const CARD =
  'Pushes the run branch wicked/<run> to origin (/srv/proof/remote.git) — a local path, so no pull ' +
  'request can be opened against it: unless another remote in this checkout is a GitHub repository ' +
  'gh resolves, the pushed branch IS the delivery. Push identity: none configured — pushes as ' +
  'whatever login gh holds (set the deliver identity in system settings to pin it). It refuses if ' +
  "gh's login and git's credential for the remote disagree.";
const DESCRIPTION = `deliver — add a clamp() helper to tally-kit and test it ||| ${CARD}`;
const OLD_ENGINE_PROMPT =
  `Approve delivery before unit 8 runs: ${DESCRIPTION}. This step leaves the machine — it commits ` +
  "the run's verified work, pushes branch `wicked/efe69c4b` to the remote and opens a pull request " +
  "on `tally-kit` under the gh account active in the daemon's environment (pin it now if it must " +
  'differ). Merge stays yours. Reject cancels the run and keeps the worktree and its uncommitted ' +
  'work on disk. [deliver gate: engine-enforced unless the launch set autoDeliver: true]';

const UNITS = [
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 7, status: 'done' }),
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 8, status: 'pending', description: DESCRIPTION }),
];

const DIFF = [
  'diff --git a/src/math.ts b/src/math.ts',
  '--- a/src/math.ts',
  '+++ b/src/math.ts',
  '@@ -1 +1,2 @@',
  '+export const clamp = 1;',
].join('\n');

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: DIFF, truncated: false });
});
afterEach(cleanup);

describe('N3 — the deliver gate says what will actually happen', () => {
  it('the visible consent line leads with the origin truth, then the diffstat — never a PR it cannot open', async () => {
    render(<SteeringGate runId={RUN} ord={8} prompt={OLD_ENGINE_PROMPT} units={UNITS} />);
    await screen.findByTestId('deliver-gate-diffstat');
    const consent = (await screen.findByTestId('gate-move-consequence')).textContent ?? '';
    expect(consent).toContain('a local path, so no pull request can be opened against it');
    expect(consent).toContain('1 file');
    expect(consent).not.toMatch(/opens a pull request/);
  });

  it('no raw ` ||| ` separator renders in the prompt', () => {
    render(<SteeringGate runId={RUN} ord={8} prompt={OLD_ENGINE_PROMPT} units={UNITS} />);
    expect(screen.getByTestId('steering-prompt').textContent).not.toContain('|||');
  });

  it('a deliver unit with no card claims no pull request either way', () => {
    const bare = [makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 8, status: 'pending', description: 'deliver — x' })];
    expect(deliverTargetOf(bare, 8)).toBeNull();
    // An approved intent amendment is a segment too, and never the card.
    const amended = [makeUnit({
      id: `${RUN}:deliver`, session_id: RUN, ord: 8, status: 'pending',
      description: 'deliver — x ||| APPROVED INTENT AMENDMENT (overrides the corresponding launch-intent item; judge the amended acceptance, never the withdrawn one): clamp at 10',
    })];
    expect(deliverTargetOf(amended, 8)).toBeNull();
    const cardThenAmendment = [makeUnit({
      id: `${RUN}:deliver`, session_id: RUN, ord: 8, status: 'pending',
      description: `${DESCRIPTION} ||| APPROVED INTENT AMENDMENT (…): clamp at 10`,
    })];
    expect(deliverTargetOf(cardThenAmendment, 8)).toContain('a local path, so no pull request can be opened');
    const move = recommendGateMove({
      runId: RUN, ord: 8, units: bare, verdict: null, verdictSummary: null, escalationGate: false,
      hasLift: false, restoredRetry: false, isPlanGate: false, planView: null, diffstat: '1 file changed, +1',
    });
    expect(move?.consequence).toBe('Deliver pushes the run branch: 1 file changed, +1');
  });

  it("the Home gate row names the move for the engine's own deliver prompt", () => {
    expect(gateRowVerb(OLD_ENGINE_PROMPT)).toBe('Review diff… ›');
    expect(gateRowVerb(`Approve delivery before unit 8 runs. ${CARD} This step leaves the machine.`)).toBe('Review diff… ›');
  });
});
