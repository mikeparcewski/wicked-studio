// Issue #299 — Escalation gate: four labelled verbs (Retry / Request changes / Reject / Cancel run)
// with data-testids; confirm line explains each action.
//
// Retry → confirmGate({approve:true}); Request changes → confirmGate({approve:false,action:'request_changes',amend});
// Reject → confirmGate({approve:false}); Cancel run → cancelRun.
// Request changes is disabled until the note textarea carries text.
// Non-escalation gates keep the existing four buttons (Approve / Approve+steer / Reject / Cancel run).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate } from '../src/components/SteeringGate.js';
import * as client from '../src/api/client.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSteeringStore } from '../src/store/steering.js';
import type { CoreEvent } from '../src/api/types.js';

const RUN = 'esc-gate-test';
const ESCALATION_PROMPT = 'Unit 2 failed and triage escalated: the build phase timed out (Failed): [timeout after 120s]';
const NORMAL_PROMPT = 'Approve unit 3 before it runs: verify — the acceptance suite';

function beforeEachShared(): void {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {} });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  vi.spyOn(client.api, 'cancelRun').mockResolvedValue({ status: 'cancelled' });
}

describe('SteeringGate — escalation gate layout (#299)', () => {
  beforeEach(beforeEachShared);

  describe('escalation gate (prompt starts with "Unit N failed and triage escalated")', () => {
    it('renders Retry, Request changes, Reject, Cancel run — not the standard Approve layout', () => {
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      expect(screen.getByTestId('steering-retry')).toHaveTextContent('Retry');
      expect(screen.getByTestId('steering-request-changes')).toHaveTextContent('Request changes');
      expect(screen.getByTestId('steering-reject')).toHaveTextContent('Reject');
      expect(screen.getByTestId('steering-cancel')).toHaveTextContent('Cancel run');
      // Standard layout must NOT appear on an escalation gate.
      expect(screen.queryByTestId('steering-approve')).toBeNull();
      expect(screen.queryByTestId('steering-approve-steer')).toBeNull();
    });

    it('Retry → confirmGate({approve:true}) — re-dispatches the failed unit', async () => {
      const user = userEvent.setup();
      const onResolved = vi.fn();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} onResolved={onResolved} />);
      await user.click(screen.getByTestId('steering-retry'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: true });
      expect(onResolved).toHaveBeenCalledOnce();
    });

    it('Request changes is disabled until the note textarea has text', async () => {
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      expect(screen.getByTestId('steering-request-changes')).toBeDisabled();
      await user.type(screen.getByTestId('steering-amend'), 'fix the timeout in the build script');
      expect(screen.getByTestId('steering-request-changes')).toBeEnabled();
    });

    it('Request changes → confirmGate({approve:false, action:"request_changes", amend}) with the note', async () => {
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      await user.type(screen.getByTestId('steering-amend'), 'increase the timeout to 300s');
      await user.click(screen.getByTestId('steering-request-changes'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, {
        approve: false,
        action: 'request_changes',
        amend: 'increase the timeout to 300s',
      });
    });

    it('Reject → confirmGate({approve:false}) — note optional', async () => {
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      await user.click(screen.getByTestId('steering-reject'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: false });
    });

    it('Reject carries the note when the textarea has text', async () => {
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      await user.type(screen.getByTestId('steering-amend'), 'not acceptable');
      await user.click(screen.getByTestId('steering-reject'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: false, amend: 'not acceptable' });
    });

    it('Cancel run → cancelRun (distinct from confirmGate)', async () => {
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      await user.click(screen.getByTestId('steering-cancel'));
      expect(client.api.cancelRun).toHaveBeenCalledWith(RUN);
      expect(client.api.confirmGate).not.toHaveBeenCalled();
    });

    it('confirm line names each verb — does not say "Workflow-declared gate"', () => {
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      const gate = screen.getByTestId('steering-gate');
      expect(gate.textContent).toMatch(/Retry re-runs the failed unit/);
      expect(gate.textContent).toMatch(/Request changes rewinds to the last creator phase/);
      expect(gate.textContent).toMatch(/Reject cancels the run/);
      expect(gate.textContent).toMatch(/Cancel run stops the run without a gate decision/);
      expect(gate.textContent).not.toMatch(/Workflow-declared gate/);
    });

    it('records "request-changes" in the steering store with the note', async () => {
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      await user.type(screen.getByTestId('steering-amend'), 'fix the build');
      await user.click(screen.getByTestId('steering-request-changes'));
      const entry = useSteeringStore.getState().entries.at(-1);
      expect(entry).toMatchObject({ runId: RUN, action: 'request-changes', amend: 'fix the build', ord: 2 });
    });
  });

  describe('non-escalation gate keeps the standard layout', () => {
    it('shows Approve / Approve+steer / Reject / Cancel run — not the escalation layout', () => {
      render(<SteeringGate runId={RUN} ord={3} prompt={NORMAL_PROMPT} />);
      expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve');
      expect(screen.getByTestId('steering-approve-steer')).toBeInTheDocument();
      expect(screen.queryByTestId('steering-retry')).toBeNull();
      expect(screen.queryByTestId('steering-request-changes')).toBeNull();
    });

    it('confirm line says "Workflow-declared gate" for non-escalation', () => {
      render(<SteeringGate runId={RUN} ord={3} prompt={NORMAL_PROMPT} />);
      expect(screen.getByTestId('steering-gate').textContent).toMatch(/Workflow-declared gate/);
    });
  });

  // floor_failed prompt shape (condition=floor_failed, denialSource=repo_checks)
  describe('floor_failed escalation gate (repo_checks denial)', () => {
    const FLOOR_FAILED_PROMPT =
      'Unit 3 failed its deterministic floor (repo_checks): typecheck exited 1. ' +
      'confirm to retry the phase, or reject to cancel the run.';

    function seedRepoChecksEvent(): void {
      useRunEventStore.setState({
        byRun: {
          [RUN]: [
            {
              type: 'gateEvaluated',
              ord: 3,
              combined: false,
              hasDeterministicFloor: true,
              agentVerdict: null,
              evaluatorPolicies: [],
              denial: { source: 'repo_checks', reason: 'Repository checks failed on head', claimId: null, ruleIds: [], deniedTool: null, phase: 'build' },
            } as unknown as CoreEvent,
          ],
        },
      });
    }

    it('renders Retry, Request changes, Reject, Cancel run — not the standard Approve layout', () => {
      seedRepoChecksEvent();
      render(<SteeringGate runId={RUN} ord={3} prompt={FLOOR_FAILED_PROMPT} />);
      expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
      expect(screen.getByTestId('steering-request-changes')).toBeInTheDocument();
      expect(screen.getByTestId('steering-reject')).toBeInTheDocument();
      expect(screen.getByTestId('steering-cancel')).toBeInTheDocument();
      expect(screen.queryByTestId('steering-approve')).toBeNull();
      expect(screen.queryByTestId('steering-approve-steer')).toBeNull();
    });

    it('Request changes → confirmGate({approve:false, action:"request_changes", amend}) with the note', async () => {
      seedRepoChecksEvent();
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={3} prompt={FLOOR_FAILED_PROMPT} />);
      await user.type(screen.getByTestId('steering-amend'), 'fix the typecheck error');
      await user.click(screen.getByTestId('steering-request-changes'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, {
        approve: false,
        action: 'request_changes',
        amend: 'fix the typecheck error',
      });
    });

    it('reassign row does NOT appear (no seat failure on a repo_checks denial)', () => {
      seedRepoChecksEvent();
      render(<SteeringGate runId={RUN} ord={3} prompt={FLOOR_FAILED_PROMPT} clis={['claude', 'codex']} units={[]} />);
      expect(screen.queryByTestId('steering-reassign-status')).toBeNull();
    });
  });

  // verdict_not_pass prompt shape (condition=verdict_not_pass, denialSource=evaluator_verdict)
  describe('verdict_not_pass escalation gate (evaluator_verdict denial)', () => {
    const VERDICT_NOT_PASS_PROMPT =
      'Unit 4 verdict is NOT PASS — evaluator denied this phase. ' +
      'confirm to retry the phase, request changes to send the review back to the creator phase, ' +
      'or reject to cancel the run.';

    function seedEvaluatorVerdictEvent(): void {
      useRunEventStore.setState({
        byRun: {
          [RUN]: [
            { type: 'unitDispatched', ord: 4, attempt: 0 } as unknown as CoreEvent,
            {
              type: 'gateEvaluated',
              ord: 4,
              combined: false,
              hasDeterministicFloor: false,
              agentVerdict: 'NOT PASS',
              evaluatorPolicies: [],
              denial: { source: 'evaluator_verdict', reason: 'Evaluator judged this NOT PASS', claimId: null, ruleIds: [], deniedTool: null, phase: 'verify' },
            } as unknown as CoreEvent,
          ],
        },
      });
    }

    it('renders Retry, Request changes, Reject, Cancel run — not the standard Approve layout', () => {
      seedEvaluatorVerdictEvent();
      render(<SteeringGate runId={RUN} ord={4} prompt={VERDICT_NOT_PASS_PROMPT} />);
      expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
      expect(screen.getByTestId('steering-request-changes')).toBeInTheDocument();
      expect(screen.getByTestId('steering-reject')).toBeInTheDocument();
      expect(screen.getByTestId('steering-cancel')).toBeInTheDocument();
      expect(screen.queryByTestId('steering-approve')).toBeNull();
      expect(screen.queryByTestId('steering-approve-steer')).toBeNull();
    });

    it('Request changes → confirmGate({approve:false, action:"request_changes", amend}) with the note', async () => {
      seedEvaluatorVerdictEvent();
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={4} prompt={VERDICT_NOT_PASS_PROMPT} />);
      await user.type(screen.getByTestId('steering-amend'), 'address the evaluator feedback');
      await user.click(screen.getByTestId('steering-request-changes'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, {
        approve: false,
        action: 'request_changes',
        amend: 'address the evaluator feedback',
      });
    });

    it('reassign row does NOT appear (no seat failure on an evaluator_verdict denial)', () => {
      seedEvaluatorVerdictEvent();
      render(<SteeringGate runId={RUN} ord={4} prompt={VERDICT_NOT_PASS_PROMPT} clis={['claude', 'codex']} units={[]} />);
      expect(screen.queryByTestId('steering-reassign-status')).toBeNull();
    });
  });

  describe('Retry carries amend when the textarea has text', () => {
    it('non-deliver escalation: Retry carries the note as {approve:true, amend}', async () => {
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      await user.type(screen.getByTestId('steering-amend'), 'try a larger timeout');
      await user.click(screen.getByTestId('steering-retry'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: true, amend: 'try a larger timeout' });
    });

    it('non-deliver escalation: Retry without a note sends bare {approve:true}', async () => {
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={2} prompt={ESCALATION_PROMPT} />);
      await user.click(screen.getByTestId('steering-retry'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: true });
    });
  });
});
