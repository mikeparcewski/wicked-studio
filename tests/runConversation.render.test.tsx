/**
 * DES-CHAT-NATIVE-RUN — the run block as a conversation, rendered (codex r1 on the chat-native PR):
 *  #1 a finished run's final message never waits on a retained answer receipt (a plan approved earlier);
 *  #2 a step that ran again is read again (no cached words from the failed attempt);
 *  #3 the final message claims an approval only when the review's own words say it passed.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { WorkUnit } from '../src/api/types.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../src/board/gateActions.js';
import { RunBlock, resetStepOutputs } from '../src/components/session/RunConversation.js';
import { resetRunCoverage } from '../src/hooks/useRunCoverage.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-conv';
const unit = (key: string, ord: number, status: string, cli: string | null, stage = 'build', role = 'neutral'): WorkUnit =>
  makeUnit({ id: `${RUN}:${key}`, session_id: RUN, ord, status, assigned_cli: cli, stage, role, description: key } as never);

let outputs: Record<string, string>;
beforeEach(() => {
  resetStepOutputs();
  resetRunCoverage();
  outputs = {};
  useGateStore.setState({ gates: {}, approaching: {} });
  useGateActionStore.setState({ byGate: {} });
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] } as never);
  vi.spyOn(client.api, 'getWatch').mockResolvedValue({ coverage: [] } as never);
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] } as never);
  vi.spyOn(client.api, 'getUnitOutput').mockImplementation((_run: string, key: string) => Promise.resolve({ output: outputs[key] ?? null } as never));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the run as a conversation, rendered', () => {
  it('a finished, stranded run shows its final message and the deliver door although a plan answer is still remembered (#1)', async () => {
    useGateActionStore.setState({ byGate: { [RUN]: { ...IDLE_GATE_ACTION, answered: 'approved', receipt: { kind: 'plan', chosenLabel: 'Approve plan', sentAt: 1 } } } });
    const view = makeView({ id: RUN, problem: 'Fix it', status: 'completed', delivery: 'stranded', workdir: '/w/x' } as never,
      [unit('build', 1, 'done', 'claude'), unit('deliver', 2, 'rejected', null)]);
    render(<RunBlock view={view} badge={0} sessionId={`run:${RUN}`} />);
    expect(await screen.findByTestId('chat-final')).toBeTruthy();
    // J4 deliver truth: a stranded run never reads "Done"; it leads "Not delivered" and names the door.
    expect(screen.getByTestId('chat-final-text').textContent).toMatch(/^Not delivered\./);
    expect(screen.getByTestId('chat-final-text').textContent).toContain('Deliver — open a PR');
    expect(screen.getByTestId('session-stranded')).toBeTruthy();
  });

  it('a step that ran again shows the new attempt’s words, not the failed attempt’s (#2)', async () => {
    outputs = { build: 'OLD FAILED OUTPUT' };
    const failed = makeView({ id: RUN, problem: 'Fix it', status: 'failed', attempt: 0 } as never, [unit('build', 1, 'rejected', 'claude')]);
    const { rerender } = render(<RunBlock view={failed} badge={0} sessionId={`run:${RUN}`} />);
    await screen.findByText('OLD FAILED OUTPUT');
    outputs = { build: 'NEW PASSING OUTPUT' };
    const done = makeView({ id: RUN, problem: 'Fix it', status: 'completed', attempt: 1 } as never, [unit('build', 1, 'done', 'claude')]);
    rerender(<RunBlock view={done} badge={0} sessionId={`run:${RUN}`} />);
    await screen.findByText('NEW PASSING OUTPUT');
    expect(screen.queryByText('OLD FAILED OUTPUT')).toBeNull();
  });

  it('a review that finished saying FAIL is not reported as an approval (#3)', async () => {
    outputs = { review: 'VERDICT: FAIL\n\nThe fix misses the refund path.' };
    const view = makeView({ id: RUN, problem: 'Fix it', status: 'completed' } as never,
      [unit('build', 1, 'done', 'claude'), unit('review', 2, 'done', 'codex', 'review', 'evaluator')]);
    render(<RunBlock view={view} badge={0} sessionId={`run:${RUN}`} />);
    await screen.findByTestId('chat-step-verdict');
    expect(screen.getByTestId('chat-step-verdict')).toHaveAttribute('data-verdict', 'fail');
    await waitFor(() => expect(screen.getByTestId('chat-final-text').textContent).toMatch(/^Done\./));
    expect(screen.getByTestId('chat-final-text').textContent).not.toMatch(/approved/i);
  });

  it('a review that said PASS is named as approving it', async () => {
    outputs = { review: 'VERDICT: PASS\n\nLooks right.' };
    const view = makeView({ id: RUN, problem: 'Fix it', status: 'completed' } as never,
      [unit('build', 1, 'done', 'claude'), unit('review', 2, 'done', 'codex', 'review', 'evaluator')]);
    render(<RunBlock view={view} badge={0} sessionId={`run:${RUN}`} />);
    await waitFor(() => expect(screen.getByTestId('chat-final-text').textContent).toContain('Reviewed and approved by codex.'));
  });
});
