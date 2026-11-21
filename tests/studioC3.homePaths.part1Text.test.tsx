import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { api } from '../src/api/client.js';
import { ProposalCard } from '../src/components/session/ProposalCard.js';
import { RunStory } from '../src/components/session/RunRecord.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { chainFromUnits } from '../src/board/chainModel.js';
import { useGateStore } from '../src/store/gates.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-c3-home';
const deferred = String.raw`Approve delivery. After delivery — 2 checks the review deferred to the opened pull request; check each there before you merge: ITEM 1: DEFERRED — the fixture at /home/reel-operator/repo/test/cart.json loads (review unit 2); ITEM 2: DEFERRED — CI reads C:\\Users\\reel-operator\\repo\\ci.yml (review unit 2).`;

beforeEach(() => {
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 4, prompt: deferred, gateKind: 'deliver', lifecycle: 'open', receivedAt: 1 } } } as never);
  useGateActionStore.setState({ byGate: {} });
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: [] });
  vi.spyOn(api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
  vi.spyOn(api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(api, 'getAudit').mockResolvedValue({ entries: [] } as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('the deliver card’s after-delivery checks mask a home directory', () => {
  const unit = makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 4, phase_ref: 'deliver' });
  render(<ProposalCard view={makeView({ id: RUN, status: 'awaiting_human' }, [unit])} chain={chainFromUnits(makeView())} />);
  const list = screen.getByTestId('session-proposal-after-delivery');
  expect(list.querySelectorAll('li')).toHaveLength(2);
  expect(list).toHaveTextContent('~/repo/test/cart.json');
  expect(list).toHaveTextContent('~');
  expect(list.textContent).not.toContain('reel-operator');
});

it('a stop reason that names a home directory reads it as ~', () => {
  useProvenanceStore.setState({ byRun: { [RUN]: { state: 'unknown' } }, endedRead: { [RUN]: true },
    cancelStories: { [RUN]: { rejectNote: null, sendBackNote: null, engineTimedOut: false, stop: { reason: 'Wrong clone: /home/reel-operator/old-repo', byPerson: true } } } } as never);
  render(<RunStory view={makeView({ id: RUN, status: 'cancelled' })} />);
  const banner = screen.getByTestId('failure-banner');
  expect(banner).toHaveTextContent('You stopped it: “Wrong clone: ~/old-repo”');
  expect(banner.textContent).not.toContain('reel-operator');
});
