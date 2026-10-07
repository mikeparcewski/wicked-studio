/**
 * studio#575 / #577: the session's proposal card, rendered — the Done receipt links the pull request
 * it opened (or names the pushed branch), and the deliver card's acceptance line says what THIS
 * Deliver rests on when crew's QE gate has no verdict to judge.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, RunAcceptanceSummary, SessionView } from '../src/api/types.js';
import type { ChainModel } from '../src/board/chainModel.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { ProposalCard } from '../src/components/session/ProposalCard.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const NOW = 1_700_000_000_000;
const PR = 'https://github.com/example/studio-api/pull/999';
const CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };

/** A finished run whose deliver unit ran (the card infers the hand-over from it on a fresh load). */
function delivered(id: string, over: Record<string, unknown>): SessionView {
  const v = makeView({ id, status: 'completed' }, [
    makeUnit({ id: `${id}:build`, session_id: id, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: `${id}:deliver`, session_id: id, ord: 2, stage: 'build', phase_ref: 'deliver', role: 'neutral', status: 'done', assigned_cli: 'claude' }),
  ]);
  Object.assign(v.session as object, over);
  return v;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  useGateActionStore.setState({ byGate: {} });
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] });
  vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
});
afterEach(() => cleanup());

describe('studio#575: the Done receipt says where the work went', () => {
  it('a delivered run links its pull request, in a new tab', () => {
    const RUN = 'r-done-pr';
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    render(<ProposalCard view={delivered(RUN, { delivery: 'delivered', deliverUrl: PR })} chain={CHAIN} />);
    expect(screen.getByTestId('session-proposal').dataset['state']).toBe('done');
    expect(screen.getByTestId('session-proposal-outcome').textContent).toBe('Finished · delivered');
    const a = screen.getByTestId('session-proposal-pr') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(PR);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer');
    expect(a.textContent).toBe('Pull request ↗');
    expect(screen.queryByTestId('session-proposal-branch')).toBeNull();
  });
  it('a push-only hand-over names the branch and links nothing', () => {
    const RUN = 'r-done-branch';
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    render(<ProposalCard view={delivered(RUN, { delivery: 'pushed', deliverBranch: 'wicked/r-done-branch', deliverRemote: 'origin' })} chain={CHAIN} />);
    expect(screen.getByTestId('session-proposal-outcome').textContent).toBe('Finished · branch pushed');
    expect(screen.getByTestId('session-proposal-branch').textContent).toContain('wicked/r-done-branch');
    expect(screen.queryByTestId('session-proposal-pr')).toBeNull();
  });
  it('"delivered" with no url in hand links nothing — the claim is never dressed up', () => {
    const RUN = 'r-done-nourl';
    useRunEventStore.setState({ byRun: { [RUN]: [] } });
    render(<ProposalCard view={delivered(RUN, { delivery: 'delivered' })} chain={CHAIN} />);
    expect(screen.getByTestId('session-proposal-outcome').textContent).toBe('Finished · delivered');
    expect(screen.queryByTestId('session-proposal-pr')).toBeNull();
    expect(screen.queryByTestId('session-proposal-branch')).toBeNull();
  });
});

describe('studio#577: the deliver card’s acceptance line says what this Deliver rests on', () => {
  const RUN = 'r-deliver-ask';
  const gate: OpenGate = { runId: RUN, ord: 2, prompt: 'deliver: push the run branch and open a PR on origin — confirm to deliver, reject to keep it local', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
  const EVENTS = [
    { type: 'unitDispatched', session: RUN, ord: 1, attempt: 0 },
    { type: 'repoChecksEvaluated', session: RUN, ord: 1, attempt: 0, passed: true, criterion: 'checks pass', skipped: [], checks: [] },
    { type: 'gateEvaluated', session: RUN, ord: 1, criterion: null, hasDeterministicFloor: true, deterministicPass: true, agentVerdict: 'PASS', agentReasoning: null, evaluatorPass: true, evaluatorPolicies: [], denialReason: null, denial: null, combined: true, judgeCli: 'pi', judgeDistinct: true },
  ] as unknown as CoreEvent[];
  const view = (): SessionView => makeView({ id: RUN, status: 'awaiting_human' }, [
    makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 2, stage: 'build', phase_ref: 'deliver', role: 'neutral', status: 'pending' }),
  ]);
  it('crew’s "(missing ⇒ deny)" above an enabled Deliver becomes the run’s own evidence, quietly — and Deliver stays enabled', () => {
    useGateStore.setState({ gates: { [RUN]: gate } });
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
    const summary: RunAcceptanceSummary = { required: true, satisfied: false, walkthrough: null, line: 'Not accepted yet: no QE ledger at .wicked-qe — no QE run has recorded a verdict for this repository; this gate reads the QE ledger only (the run\'s own repo-check and evaluator evidence is on GET /runs/:id/evidence) (missing ⇒ deny)' };
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={summary} />);
    const line = screen.getByTestId('session-proposal-acceptance');
    expect(line.dataset['tone']).toBe('quiet');
    expect(line.textContent).toBe('No QE verdict is recorded for this run, and Deliver doesn’t consult the QE gate — this hand-over rests on the run’s own evidence: floor passed · 1 of 1 reviewer gate passed.');
    expect(line.textContent).not.toContain('deny');
    expect((screen.getByTestId('session-proposal-go') as HTMLButtonElement).disabled).toBe(false);
  });
  it('a failed walkthrough keeps crew’s words and the bad tone', () => {
    useGateStore.setState({ gates: { [RUN]: gate } });
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
    const summary: RunAcceptanceSummary = { required: true, satisfied: false, walkthrough: { checked: 0, failed: 1, ownedByYou: 0, steps: 1, sealed: true, tree: 'abc' }, line: 'Not accepted yet: the walkthrough failed in chapter 4.' };
    render(<ProposalCard view={view()} chain={CHAIN} acceptance={summary} />);
    const line = screen.getByTestId('session-proposal-acceptance');
    expect(line.dataset['tone']).toBe('bad');
    expect(line.textContent).toBe('Not accepted yet: the walkthrough failed in chapter 4.');
  });
});
