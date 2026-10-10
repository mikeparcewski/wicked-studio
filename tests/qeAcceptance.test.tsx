/**
 * QE-IN-APP-WORKFLOWS (studio half): the run's QE acceptance decision is spelled one way on the
 * plan (session header), every gate and the delivery — "QE acceptance: required / waived (score N) /
 * skipped by operator (reason)" — and the launch form offers the operator's explicit "Skip QE
 * acceptance" (a reason required before it can be sent) and "Force QE acceptance" for a workflow that
 * requires it, sending either only when ticked and only to a daemon that takes it.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, LaunchBodyWithDeliver } from '../src/api/types.js';
import { qeDecisionOf, qeWords, receiptOf, sessionQe, workflowRequiresQe } from '../src/board/assuranceModel.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { AssuranceReceipt, DeliveryAssuranceLines, QeAcceptanceLabel } from '../src/components/session/AssuranceReceipt.js';
import { setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';
import { makeView } from './factories.js';

const RUN = 'r-qe';
const WAIVED = {
  status: 'waived', basis: 'diff', score: 20, threshold: 20, ord: 4, tree: 't1',
  reason: 'waived: impact score 20 at or below the waiver line 20, every dimension in its lowest band (reach 20: 1 changed symbol(s))',
  reasons: ['reach 20: 1 changed symbol(s), 0 dependent(s) within 3 hops'],
};
const SKIPPED = {
  status: 'skipped', basis: 'operator', score: null, threshold: 20, ord: null, tree: null,
  reason: 'QE acceptance skipped by operator: docs-only hotfix', reasons: [],
};
const PROVISIONAL = {
  status: 'required', basis: 'plan', score: null, threshold: 20, ord: null, tree: null,
  reason: 'required (provisional): the binding decision is made from the run\'s diff when its QE phase starts', reasons: [],
};
const DIFF_REQUIRED = { ...PROVISIONAL, basis: 'diff', score: 60, reason: 'required: impact score 60 above the waiver line 20 (novelty +20: 1 new dependency(ies))' };

describe('the decision, spelled once', () => {
  it('required (provisional / scored / forced), waived (score N), skipped by operator (reason)', () => {
    expect(qeWords(qeDecisionOf(PROVISIONAL)!).text).toBe('QE acceptance: required, provisional');
    expect(qeWords(qeDecisionOf(DIFF_REQUIRED)!).text).toBe('QE acceptance: required (score 60)');
    expect(qeWords(qeDecisionOf({ ...PROVISIONAL, basis: 'operator', reason: 'QE acceptance forced by operator: no score waives it' })!).text)
      .toBe('QE acceptance: required, forced by operator');
    expect(qeWords(qeDecisionOf(WAIVED)!).text).toBe('QE acceptance: waived (score 20)');
    expect(qeWords(qeDecisionOf(SKIPPED)!).text).toBe('QE acceptance: skipped by operator (docs-only hotfix)');
    expect(qeDecisionOf({ status: '' })).toBeNull();
    expect(workflowRequiresQe({ required_instruments: ['distinct_evaluator', 'judge', 'qe_acceptance'] })).toBe(true);
    expect(workflowRequiresQe({ required_instruments: null })).toBe(false);
  });

  it('the run\'s CURRENT decision: the newest qeAcceptanceDecided, else the contract', () => {
    const view = makeView({ id: RUN, assurance: { mode: 'full', required: ['qe_acceptance'], qe: PROVISIONAL } } as never, []);
    expect(sessionQe(view, [])?.status).toBe('required');
    const events = [{ type: 'qeAcceptanceDecided', session: RUN, ord: 4, qe: WAIVED }] as unknown as CoreEvent[];
    expect(sessionQe(view, events)?.status).toBe('waived');
  });

  it('a receipt carrying the decision shows it; the hover holds the engine\'s words', () => {
    const receipt = receiptOf({ mode: 'full', required: ['qe_acceptance'], ran: ['repo_checks'], skipped: [{ instrument: 'qe_acceptance', reason: 'qe_waived_by_score', detail: WAIVED.reason }], creator: 'claude', evaluator: 'codex', judge: null, tree: 't1', attempt: 0, qe: WAIVED })!;
    render(<AssuranceReceipt receipt={receipt} />);
    const line = screen.getByTestId('assurance-qe');
    expect(line.textContent).toBe('QE acceptance: waived (score 20)');
    expect(line.getAttribute('data-status')).toBe('waived');
    expect(line.getAttribute('title')).toBe(WAIVED.reason);
    cleanup();
    render(<QeAcceptanceLabel qe={qeDecisionOf(SKIPPED)!} />);
    expect(screen.getByTestId('qe-acceptance').textContent).toBe('QE acceptance: skipped by operator (docs-only hotfix)');
  });

  it('the delivery says waived or skipped instead of a PASS it never read', () => {
    const base = { verified: true, via: 'deliver_lift', receipt: null, treeBefore: null, treeAfter: null };
    render(<DeliveryAssuranceLines recorded={{ ...base, qeAcceptance: { status: 'waived', satisfied: true, reason: WAIVED.reason, verdictId: null, reviewer: null } }} testIdPrefix="d" />);
    expect(screen.getByTestId('d-qe').textContent).toMatch(/^QE acceptance: waived \(impact score 20 at or below the waiver line 20/);
    cleanup();
    render(<DeliveryAssuranceLines recorded={{ ...base, qeAcceptance: { status: 'skipped', satisfied: true, reason: SKIPPED.reason, verdictId: null, reviewer: null } }} testIdPrefix="d" />);
    expect(screen.getByTestId('d-qe').textContent).toBe('QE acceptance: skipped by operator (docs-only hotfix)');
  });
});

describe('the launch form', () => {
  const BUG = { id: 'bug', phases: [{ id: 'fix', kind: 'build', executes_code: true, role: 'creator' }], required_instruments: ['distinct_evaluator', 'judge', 'qe_acceptance'] };
  function health(qeAcceptanceOverride: boolean): void {
    vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: 'test', capabilities: { qeAcceptanceOverride } } as never);
  }
  beforeEach(() => {
    vi.restoreAllMocks();
    takeRetryPrefill();
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ['claude', 'codex'].map((k) => ({ key: k, display_name: k, binary: k, enabled_for_council: true })) } as never);
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'repo-1', name: 'app', root_path: '/srv/app' }] } as never);
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [BUG] } as never);
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue(null as never);
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
    localStorage.clear();
    setRetryPrefill({
      retryOf: RUN, problem: 'fix the signup crash', clis: ['claude', 'codex'], workflowId: 'bug', repoRef: 'repo-1',
      entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null,
    });
  });
  afterEach(() => cleanup());

  async function send(): Promise<void> {
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
  }
  const sent = (): LaunchBodyWithDeliver => vi.mocked(client.api.launchRun).mock.calls[0]![0];

  it('offered for a QE workflow; nothing is sent unless ticked', async () => {
    health(true);
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-qe')).toBeTruthy());
    await send();
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect('skipQeAcceptance' in sent() || 'forceQeAcceptance' in sent()).toBe(false);
  });

  it('a skip needs its reason before anything launches, then carries it', async () => {
    health(true);
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-qe')).toBeTruthy());
    await user.click(screen.getByTestId('launch-qe-skip'));
    await send();
    await waitFor(() => expect(screen.getByText(/Say why QE acceptance is skipped/)).toBeTruthy());
    expect(client.api.launchRun).not.toHaveBeenCalled();
    await user.type(screen.getByTestId('launch-qe-skip-reason'), 'docs-only hotfix');
    await send();
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sent().skipQeAcceptance).toEqual({ reason: 'docs-only hotfix' });
    expect('forceQeAcceptance' in sent()).toBe(false);
  });

  it('force is sent alone, and ticking it clears a skip', async () => {
    health(true);
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-qe')).toBeTruthy());
    await user.click(screen.getByTestId('launch-qe-skip'));
    await user.click(screen.getByTestId('launch-qe-force'));
    expect((screen.getByTestId('launch-qe-skip') as HTMLInputElement).checked).toBe(false);
    await send();
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sent().forceQeAcceptance).toBe(true);
    expect('skipQeAcceptance' in sent()).toBe(false);
  });

  it('codex r1: offered for the workflow the launch SENDS — an override to a non-QE workflow is not offered, and a change of target clears the tick', async () => {
    health(true);
    const user = userEvent.setup();
    const { rerender } = render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-qe')).toBeTruthy());
    await user.click(screen.getByTestId('launch-qe-force'));
    rerender(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} workflowOverride="chat" />);
    await waitFor(() => expect(screen.queryByTestId('launch-qe')).toBeNull());
    rerender(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('launch-qe')).toBeTruthy());
    expect((screen.getByTestId('launch-qe-force') as HTMLInputElement).checked).toBe(false);
  });

  it('a daemon that does not take it: not offered, nothing sent', async () => {
    health(false);
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await send();
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('launch-qe')).toBeNull();
    expect('skipQeAcceptance' in sent() || 'forceQeAcceptance' in sent()).toBe(false);
  });
});
