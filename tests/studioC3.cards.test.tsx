import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '../src/api/client.js';
import { ProposalCard } from '../src/components/session/ProposalCard.js';
import { AssuranceReceipt } from '../src/components/session/AssuranceReceipt.js';
import { SourceChips } from '../src/components/session/SourceChips.js';
import { RunBlock } from '../src/components/session/RunConversation.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { PowerThread } from '../src/components/session/PowerMode.js';
import { RunRawView } from '../src/components/RunRawView.js';
import { receiptOf } from '../src/board/assuranceModel.js';
import { chainFromUnits } from '../src/board/chainModel.js';
import { useGateStore } from '../src/store/gates.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { useRunEventStore } from '../src/store/events.js';
import { state } from './powerFixtures.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-c3';
const chain = chainFromUnits(makeView());
const deferred = 'deliver: push the run branch and open a PR. After delivery — 2 check(s) the review deferred to the opened pull request; the engine does not verify these before you merge: ITEM 2: DEFERRED — CI passes on the opened PR (review unit 1); ITEM 3: DEFERRED — PR body `Closes #840` (review unit 1).';
beforeEach(() => {
  useGateStore.setState({ gates: {} });
  useGateActionStore.setState({ byGate: {} });
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: [] });
  vi.spyOn(api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
  vi.spyOn(api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(api, 'listRepos').mockResolvedValue({ repos: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const deliverUnit = makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 4, phase_ref: 'deliver' });

it.each([['local (human)', 'your'], ['Morgan (human)', 'Morgan’s']])('carried overrides name their actor (%s) and never count as another act by you', (by, possessive) => {
  const record = (ord: number, carriedFrom?: string) => ({ by, note: 'known base failures', at: 1, floorOverride: { layer: 'repo_checks', resultId: `${RUN}:unit-${ord}:attempt-0:repo_checks`, ...(carriedFrom ? { carriedFrom } : {}) } });
  const receipt = receiptOf({ mode: 'full', required: [], ran: [], skipped: [], operatorJudges: [record(2), record(3, `${RUN}:unit-2:attempt-0:repo_checks`)] })!;
  render(<AssuranceReceipt receipt={receipt} units={[makeUnit({ id: `${RUN}:fix`, ord: 2 }), makeUnit({ id: `${RUN}:verify`, ord: 3 })]} />);
  expect(screen.getByTestId('assurance-floor-overridden-line')).toHaveTextContent('At one gate');
  expect(screen.getByText(`Carried to the Verify step’s checks from ${possessive} override at the Fix step (same tree).`)).toBeInTheDocument();
  const items = screen.getAllByTestId('assurance-floor-override');
  expect(items[1]).not.toHaveTextContent('You');
  expect(items[1]).toHaveTextContent('Override carried');
});
it('a deliver ask lists the checks deferred until after delivery', () => {
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 4, prompt: deferred, gateKind: 'deliver', lifecycle: 'open', receivedAt: 1 } } });
  render(<ProposalCard view={makeView({ id: RUN, status: 'awaiting_human' }, [deliverUnit])} chain={chain} />);
  const list = screen.getByTestId('session-proposal-after-delivery');
  expect(list).toHaveTextContent('After delivery, check these on the pull request before you merge:');
  expect(list.querySelectorAll('li')).toHaveLength(2);
  expect(list).toHaveTextContent('CI passes on the opened PR');
  expect(list).toHaveTextContent('PR body Closes #840');
  expect(list).not.toHaveTextContent(/ITEM|review unit/);
});
it.each([{ deliverUrl: 'https://github.com/example/project/pull/1' }, { deliverBranch: 'fix/widget', delivery: 'pushed' }])('a done receipt shows its destination without repeating the outcome (%j)', (destination) => {
  const view = makeView({ id: RUN, status: 'completed' }, [{ ...deliverUnit, status: 'done' }]);
  Object.assign(view.session, { delivery: 'delivered', ...destination });
  render(<ProposalCard view={view} chain={chain} />);
  expect(screen.getByTestId('session-proposal')).toHaveTextContent('Done');
  expect(screen.queryByTestId('session-proposal-outcome')).toBeNull();
});
it('more than six sources open on demand', () => {
  render(<SourceChips runs={[]} citations={{ items: Array.from({ length: 8 }, (_, i) => ({ kind: 'path', status: 'verified', raw: `src/source${i}.ts` })) } as never} />);
  expect(screen.getAllByTestId('session-source')).toHaveLength(6);
  expect(screen.getByRole('button', { name: '+2 more' })).toHaveAttribute('data-testid', 'session-sources-more');
  fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
  expect(screen.getAllByTestId('session-source')).toHaveLength(8);
});
it('the raw events breadcrumb allows two lines', () => {
  render(<RunRawView target="events" runId={RUN} run={makeView({ id: RUN, problem: 'A long run title that should wrap onto a second line on a phone' })} navigate={() => {}} />);
  const title = screen.getByTitle('A long run title that should wrap onto a second line on a phone');
  expect(title).not.toHaveClass('truncate');
  expect(title).toHaveClass('line-clamp-2');
});

it.each([false, true])('the power thread reads durable overrides at the checks step (carried: %s)', (carried) => {
  const view = makeView({ id: RUN, status: 'completed' });
  Object.assign(view.session, { assurance: { floorOverrides: [{ by: 'local (human)', at: 1, note: 'known failures', floorOverride: { ord: 3, resultId: `${RUN}:unit-3:attempt-0:repo_checks`, ...(carried ? { carriedFrom: `${RUN}:unit-2:attempt-0:repo_checks` } : {}) } }] } });
  render(<PowerThread view={view} power={state()} part="handoff" items={[{ kind: 'handoff', key: 'handoff', at: 1, round: 1, steps: [{ step: 'checks', ord: 3, seat: null, status: 'failed', at: 1, summary: 'engine summary' }] }]} />);
  expect(screen.getByTestId('power-handoff-result')).toHaveTextContent(carried ? 'Override carried' : 'Overridden by you');
  expect(screen.getByTestId('power-handoff')).toHaveTextContent('engine summary');
});

it('the run fold leaves its one step count to the chain line', async () => {
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  vi.spyOn(api, 'getWatch').mockResolvedValue({ coverage: [] } as never);
  vi.spyOn(api, 'getUnitOutput').mockResolvedValue({ output: 'Work finished.' } as never);
  vi.spyOn(api, 'getRoster').mockResolvedValue({ roster: [] } as never);
  vi.spyOn(api, 'getAudit').mockResolvedValue({ entries: [] } as never);
  const view = makeView({ id: RUN, status: 'completed' }, Array.from({ length: 7 }, (_, ord) => makeUnit({ id: `${RUN}:step${ord}`, session_id: RUN, ord, status: 'done' })));
  render(<RunBlock view={view} badge={0} sessionId={`run:${RUN}`} />);
  expect(await screen.findByTestId('session-status-sentence')).not.toHaveTextContent('7 of 7');
  expect(screen.getByTestId('chain-sentence')).toHaveTextContent('7 of 7');
});
