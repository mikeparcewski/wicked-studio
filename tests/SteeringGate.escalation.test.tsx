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
import type { CoreEvent, WorkUnit } from '../src/api/types.js';

const RUN = 'esc-gate-test';
const ESCALATION_PROMPT = 'Unit 2 failed and triage escalated: the build phase timed out (Failed): [timeout after 120s]';
const NORMAL_PROMPT = 'Approve unit 3 before it runs: verify — the acceptance suite';

/** A seated unit the reassign lever COULD move: its absence in an assertion then means something (#310 R7). */
function seatedUnit(ord: number, extra: Partial<WorkUnit> = {}): WorkUnit {
  return { id: `${RUN}:phase${ord}`, ord, stage: 'build', status: 'rejected', assigned_cli: 'claude', phase_ref: null, ...extra } as unknown as WorkUnit;
}

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

    it('names a workflow-declared gate only when the engine says the def declared it (studio#232)', () => {
      useRunEventStore.setState({ byRun: { [RUN]: [{ type: 'awaitingHuman', ord: 3, prompt: NORMAL_PROMPT, gateKind: 'def' } as unknown as CoreEvent] } });
      render(<SteeringGate runId={RUN} ord={3} prompt={NORMAL_PROMPT} />);
      expect(screen.getByTestId('gate-source')).toHaveAttribute('data-gate-source', 'def');
      expect(screen.getByTestId('steering-gate').textContent).toMatch(/Workflow-declared gate/);
    });

    it('a run-level gate reads as the run-level setting, never "Workflow-declared" (studio#232)', () => {
      useRunEventStore.setState({ byRun: { [RUN]: [{ type: 'awaitingHuman', ord: 3, prompt: NORMAL_PROMPT, gateKind: 'run_level' } as unknown as CoreEvent] } });
      render(<SteeringGate runId={RUN} ord={3} prompt={NORMAL_PROMPT} />);
      expect(screen.getByTestId('gate-source')).toHaveAttribute('data-gate-source', 'run_level');
      expect(screen.getByTestId('gate-source')).toHaveTextContent(/Run-level gate/);
      expect(screen.getByTestId('steering-gate').textContent).not.toMatch(/Workflow-declared gate/);
    });

    it('an engine that names no gate kind gets no source claim at all (studio#232)', () => {
      render(<SteeringGate runId={RUN} ord={3} prompt={NORMAL_PROMPT} />);
      expect(screen.queryByTestId('gate-source')).toBeNull();
      expect(screen.getByTestId('steering-gate').textContent).not.toMatch(/Workflow-declared gate/);
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
      render(<SteeringGate runId={RUN} ord={3} prompt={FLOOR_FAILED_PROMPT} clis={['claude', 'codex']} units={[seatedUnit(3)]} />);
      expect(screen.queryByTestId('steering-reassign-row')).toBeNull();
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

    it('recommends sending it back (the Request changes arm, named) above Retry, Reject, Cancel run — not the standard Approve layout', () => {
      seedEvaluatorVerdictEvent();
      render(<SteeringGate runId={RUN} ord={4} prompt={VERDICT_NOT_PASS_PROMPT} />);
      expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
      // Brainstorm idea 1: the recommended move IS the request-changes arm, so it is not repeated.
      expect(screen.getByTestId('gate-recommended')).toHaveTextContent('Send back to the creator: Evaluator judged this NOT PASS');
      expect(screen.queryByTestId('steering-request-changes')).toBeNull();
      expect(screen.getByTestId('steering-reject')).toBeInTheDocument();
      expect(screen.getByTestId('steering-cancel')).toBeInTheDocument();
      expect(screen.queryByTestId('steering-approve')).toBeNull();
      expect(screen.queryByTestId('steering-approve-steer')).toBeNull();
    });

    it('Request changes → confirmGate({approve:false, action:"request_changes", amend}) with the note', async () => {
      seedEvaluatorVerdictEvent();
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={4} prompt={VERDICT_NOT_PASS_PROMPT} />);
      // The note arrives pre-filled with the reviewer's line; the operator's own words replace it.
      expect(screen.getByTestId('steering-amend')).toHaveValue("Fix the reviewer's failing items:\n- Evaluator judged this NOT PASS");
      await user.clear(screen.getByTestId('steering-amend'));
      await user.type(screen.getByTestId('steering-amend'), 'address the evaluator feedback');
      await user.click(screen.getByTestId('gate-recommended'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, {
        approve: false,
        action: 'request_changes',
        amend: 'address the evaluator feedback',
      });
    });

    it('reassign row does NOT appear (no seat failure on an evaluator_verdict denial)', () => {
      seedEvaluatorVerdictEvent();
      render(<SteeringGate runId={RUN} ord={4} prompt={VERDICT_NOT_PASS_PROMPT} clis={['claude', 'codex']} units={[seatedUnit(4)]} />);
      expect(screen.queryByTestId('steering-reassign-row')).toBeNull();
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
  // #310 R6: every worker-failure escalation renders the escalation layout.
  describe('worker-failure escalations that are not the triage spelling (#310 R6)', () => {
    it('a dead-seat escalation (worker_failure denial) renders Retry, not Approve', () => {
      const prompt = "Unit 2 (claude) failed on a dead seat: 401 from the provider. Reassign the unit to a different CLI (sign one in first if needed) and approve to retry, or reject to stop the run";
      useRunEventStore.setState({ byRun: { [RUN]: [
        { type: 'unitDispatched', ord: 2, attempt: 0 } as unknown as CoreEvent,
        { type: 'gateEvaluated', ord: 2, combined: false, hasDeterministicFloor: false, agentVerdict: null, evaluatorPolicies: [],
          denial: { source: 'worker_failure', reason: 'Worker FAILED on unit 2: 401', claimId: null, ruleIds: [], deniedTool: null, phase: 'build' } } as unknown as CoreEvent,
      ] } });
      render(<SteeringGate runId={RUN} ord={2} prompt={prompt} />);
      expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
      expect(screen.queryByTestId('steering-approve')).toBeNull();
    });
  });

  // #310 R9: a host that does not hydrate events still gets the escalation layout off the prompt.
  describe('escalation layout without a hydrated event log (#310 R9)', () => {
    it('the floor_failed prompt alone renders the escalation layout', () => {
      render(<SteeringGate runId={RUN} ord={3} prompt={'Unit 3 failed its deterministic floor (repo_checks): typecheck exited 1 — confirm to retry the phase, or reject to cancel the run'} />);
      expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
      expect(screen.queryByTestId('steering-approve')).toBeNull();
    });

    it('the verdict prompt that names request changes alone renders the escalation layout', () => {
      render(<SteeringGate runId={RUN} ord={4} prompt={'Unit 4 verdict is NOT PASS — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run'} />);
      expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
    });

    it('the legacy worktree-guard prompt (same "confirm to retry" words, no request changes) keeps Approve', () => {
      render(<SteeringGate runId={RUN} ord={4} prompt={'Unit 4 verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run'} />);
      expect(screen.getByTestId('steering-approve')).toBeInTheDocument();
      expect(screen.queryByTestId('steering-retry')).toBeNull();
    });
  });

  // W1-K1 studio half (core#469, crew#699): a floor that did not finish offers extend / targeted / accept.
  describe('repo-checks timeout gate: extend, targeted and accept_partial (core#469)', () => {
    const TIMEOUT_PROMPT = 'Unit 3 failed its deterministic floor (repo_checks_timeout): test timed out after 600s — confirm to retry the phase, or reject to cancel the run';
    function seedTimeout(checks: unknown[] = [
      { name: 'lint', argv: ['npm', 'run', 'lint'], source: 'declared', exitCode: 0, timedOut: false, spawnError: null, durationMs: 4000 },
      { name: 'test', argv: ['npm', 'test'], source: 'declared', exitCode: null, timedOut: true, spawnError: null, durationMs: 600000 },
    ], skipped: string[] = []): void {
      useRunEventStore.setState({ byRun: { [RUN]: [
        { type: 'unitDispatched', ord: 3, attempt: 0 } as unknown as CoreEvent,
        { type: 'repoChecksEvaluated', ord: 3, passed: false, criterion: 'repo checks', attempt: 0, checks, skipped } as unknown as CoreEvent,
        { type: 'gateEvaluated', ord: 3, combined: false, hasDeterministicFloor: true, agentVerdict: null, evaluatorPolicies: [],
          denial: { source: 'repo_checks_timeout', reason: 'Repository checks did not finish: test timed out', claimId: null, ruleIds: [], deniedTool: null, phase: 'build' } } as unknown as CoreEvent,
      ] } });
    }

    it('renders the escalation layout with the three arms, each consequence first', () => {
      seedTimeout();
      render(<SteeringGate runId={RUN} ord={3} prompt={TIMEOUT_PROMPT} />);
      expect(screen.getByTestId('steering-retry')).toBeInTheDocument();
      for (const a of ['extend', 'targeted', 'accept_partial']) {
        const offer = screen.getByTestId(`gate-escalation-${a}`);
        const consequence = screen.getByTestId(`gate-escalation-consequence-${a}`);
        // The consequence reads BEFORE its button.
        expect(consequence.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect(screen.getByTestId('gate-escalation-consequence-extend')).toHaveTextContent(/twice its time bound/);
      expect(screen.getByTestId('gate-escalation-consequence-accept_partial')).toHaveTextContent(/waives test/);
      expect(screen.queryByTestId('gate-escalation-accept_suggestion')).toBeNull();
    });

    it.each(['extend', 'targeted', 'accept_partial'] as const)('%s → confirmGate({approve:true, action}) and nothing else', async (a) => {
      seedTimeout();
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={3} prompt={TIMEOUT_PROMPT} />);
      await user.type(screen.getByTestId('steering-amend'), 'a note the arm must not carry');
      await user.click(screen.getByTestId(`gate-escalation-${a}`));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: true, action: a });
    });

    it('accept_partial is not offered when the floor report names no unfinished check', () => {
      // The engine refuses accept_partial when its waiver is empty; an unhydrated floor frame is the same.
      useRunEventStore.setState({ byRun: { [RUN]: [
        { type: 'gateEvaluated', ord: 3, combined: false, hasDeterministicFloor: true, agentVerdict: null, evaluatorPolicies: [],
          denial: { source: 'repo_checks_timeout', reason: 'Repository checks did not finish', claimId: null, ruleIds: [], deniedTool: null, phase: 'build' } } as unknown as CoreEvent,
      ] } });
      render(<SteeringGate runId={RUN} ord={3} prompt={TIMEOUT_PROMPT} />);
      expect(screen.getByTestId('gate-escalation-extend')).toBeInTheDocument();
      expect(screen.queryByTestId('gate-escalation-accept_partial')).toBeNull();
    });

    it('an ordinary repo_checks failure offers none of the timeout arms', () => {
      useRunEventStore.setState({ byRun: { [RUN]: [
        { type: 'gateEvaluated', ord: 3, combined: false, hasDeterministicFloor: true, agentVerdict: null, evaluatorPolicies: [],
          denial: { source: 'repo_checks', reason: 'Repository checks failed on head', claimId: null, ruleIds: [], deniedTool: null, phase: 'build' } } as unknown as CoreEvent,
      ] } });
      render(<SteeringGate runId={RUN} ord={3} prompt={'Unit 3 failed its deterministic floor (repo_checks): typecheck exited 1 — confirm to retry the phase, or reject to cancel the run'} />);
      expect(screen.queryByTestId('gate-escalation-offers')).toBeNull();
    });
  });

  // W1-K1 studio half (core#467, crew#699): adopt a guard-denied evaluator's pinned edit.
  describe('worktree-guard-denied evaluator gate: accept_suggestion (core#467)', () => {
    const PROMPT = "Unit 3 verdict is NOT PASS — the read-only `verify` phase changed the tree under review (M src/a.ts); its edit was discarded and the creator's verified tree restored. Approve to retry the phase against the restored tree, or reject to cancel the run";
    const UNITS = [
      { id: `${RUN}:fix`, ord: 2, stage: 'build', status: 'done', assigned_cli: 'claude', phase_ref: 'fix', role: 'creator' },
      { id: `${RUN}:verify`, ord: 3, stage: 'review', status: 'rejected', assigned_cli: 'codex', phase_ref: 'verify', role: 'evaluator' },
    ] as unknown as WorkUnit[];
    function seed(suggestionRef: string | null): void {
      useRunEventStore.setState({ byRun: { [RUN]: [
        { type: 'unitDispatched', ord: 3, attempt: 0 } as unknown as CoreEvent,
        { type: 'evaluatorMutatedWorktree', ord: 3, cli: 'codex', phase: 'verify', beforeTree: 'aaaa', afterTree: 'bbbb', headMoved: false, changed: [{ status: 'M', path: 'src/a.ts' }], restored: true } as unknown as CoreEvent,
        { type: 'worktreeRestored', ord: 3, tree: 'aaaa', head: null, discarded: [{ status: 'M', path: 'src/a.ts' }], suggestionRef } as unknown as CoreEvent,
        { type: 'gateEvaluated', ord: 3, combined: false, hasDeterministicFloor: false, agentVerdict: null, evaluatorPolicies: [],
          denial: { source: 'worktree_guard', reason: 'the read-only verify phase changed the tree', claimId: null, ruleIds: [], deniedTool: null, phase: 'verify' } } as unknown as CoreEvent,
      ] } });
    }

    it('offers the suggestion with its consequence, and sends {approve:true, action:"accept_suggestion"}', async () => {
      seed('refs/wicked/suggestions/r/3/0');
      const user = userEvent.setup();
      render(<SteeringGate runId={RUN} ord={3} prompt={PROMPT} units={UNITS} />);
      expect(screen.getByTestId('gate-escalation-consequence-accept_suggestion')).toHaveTextContent(/src\/a\.ts/);
      expect(screen.getByTestId('gate-escalation-consequence-accept_suggestion')).toHaveTextContent(/fix/);
      expect(screen.queryByTestId('gate-escalation-extend')).toBeNull();
      await user.click(screen.getByTestId('gate-escalation-accept_suggestion'));
      expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: true, action: 'accept_suggestion' });
    });

    it('is not offered when the edit was not pinned', () => {
      seed(null);
      render(<SteeringGate runId={RUN} ord={3} prompt={PROMPT} units={UNITS} />);
      expect(screen.queryByTestId('gate-escalation-accept_suggestion')).toBeNull();
    });

    it('is not offered when the denied unit is not an evaluator, or no creator precedes it', () => {
      seed('refs/wicked/suggestions/r/3/0');
      const noCreator = [{ ...UNITS[1]! }];
      const { unmount } = render(<SteeringGate runId={RUN} ord={3} prompt={PROMPT} units={noCreator} />);
      expect(screen.queryByTestId('gate-escalation-accept_suggestion')).toBeNull();
      unmount();
      const creatorDenied = [UNITS[0]!, { ...UNITS[1]!, role: 'creator' }] as unknown as WorkUnit[];
      render(<SteeringGate runId={RUN} ord={3} prompt={PROMPT} units={creatorDenied} />);
      expect(screen.queryByTestId('gate-escalation-accept_suggestion')).toBeNull();
    });
  });
});
