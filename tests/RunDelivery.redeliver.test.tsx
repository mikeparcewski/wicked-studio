import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { sourceAgentsApi } from '../src/api/sourceAgents.js';
import type { RedeliverRunResult, RunPullRequest, SessionWithDelivery } from '../src/api/types.js';
import { RunDelivery } from '../src/components/RunDelivery.js';
import * as delivery from '../src/components/delivery.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { useRedeliverStore } from '../src/store/redeliver.js';
import { takeRetryPrefill } from '../src/store/retryPrefill.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeView } from './factories.js';

const URL = 'https://github.com/acme/studio/pull/42';
const OLD = '1234567890abcdef';
const NEW = 'abcdef0123456789';
const PR: RunPullRequest = {
  number: 42, url: URL, state: 'OPEN', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY',
  baseRefName: 'release', headRefName: 'wicked/run', headSha: OLD, deliveredHead: OLD,
  headMoved: false, failingChecks: [],
};
const RESULT: RedeliverRunResult = {
  prUrl: URL, oldHead: OLD, newHead: NEW,
  checks: { passed: true, count: 3, names: ['lint', 'types', 'unit'] },
  conflictsResolved: ['CHANGELOG.md'],
};
let nextRun = 0;
let runId: string;

function deliveredView() {
  const view = makeView({
    id: runId, status: 'completed', workflow_id: 'feature', repo_ref: 'studio',
    problem: 'Add the delivery action', clis: ['claude'], run_branch: 'wicked/run',
  });
  (view.session as SessionWithDelivery).delivery = 'delivered';
  (view.session as SessionWithDelivery).deliverUrl = URL;
  return view;
}

beforeEach(() => {
  vi.restoreAllMocks();
  runId = `redeliver-${++nextRun}`;
  clearCachedWorkflows();
  useDeliveryStore.setState({ byRun: {} });
  usePostHocDeliverStore.setState({ byRun: {} });
  useRedeliverStore.setState({ byRun: {} });
  takeRetryPrefill();
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(sourceAgentsApi, 'runDataUse').mockRejectedValue(new ApiError(404, 'not found'));
  vi.spyOn(client.api, 'runPullRequest').mockResolvedValue(PR);
  vi.spyOn(client.api, 'redeliverRun').mockResolvedValue(RESULT);
});
afterEach(() => { cleanup(); clearCachedWorkflows(); });

describe('RunDelivery rebase and re-deliver', () => {
  it('R1 names the conflicting base, disables while running, sends one POST, and re-reads after success', async () => {
    let finish!: (result: RedeliverRunResult) => void;
    vi.mocked(client.api.redeliverRun).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    render(<RunDelivery view={deliveredView()} />);
    expect(await screen.findByTestId('run-pr-status')).toHaveTextContent(
      'GitHub: OPEN · mergeable CONFLICTING · merge state DIRTY',
    );
    expect(screen.getByTestId('run-pr-conflict')).toHaveTextContent('This PR conflicts with release');
    expect(screen.getByTestId('run-pr-conflict')).toHaveTextContent('CONFLICTING');
    expect(screen.getAllByRole('button', { name: 'Rebase and re-deliver' })).toHaveLength(1);
    const button = screen.getByTestId('run-redeliver-button');
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Rebasing and re-delivering…');
    await user.click(button);
    act(() => { useRedeliverStore.getState().redeliver(runId); });
    expect(client.api.redeliverRun).toHaveBeenCalledExactlyOnceWith(runId);

    let refresh!: (pr: RunPullRequest) => void;
    vi.mocked(client.api.runPullRequest).mockReturnValueOnce(new Promise((resolve) => { refresh = resolve; }));
    await act(async () => { finish(RESULT); });
    const result = await screen.findByTestId('run-redeliver-result');
    expect(result).toHaveTextContent('Re-delivered: 1234567 → abcdef0. Repo checks on the new tree: PASS (3 checks: lint, types, unit). Changelog conflicts resolved: CHANGELOG.md.');
    await waitFor(() => expect(client.api.runPullRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('run-pr-status')).toHaveTextContent('mergeable CONFLICTING');
    // The shown PR is still the pre-push read: no second POST can start off it.
    expect(screen.queryByTestId('run-redeliver-button')).toBeNull();
    await act(async () => { refresh({ ...PR, mergeable: 'MERGEABLE', headSha: NEW, deliveredHead: NEW }); });
    expect(screen.getByTestId('run-pr-status')).toHaveTextContent('mergeable MERGEABLE');
  });

  it('R2 keeps refused conflicts and the captured base through a pending remount re-read and seeds a revision', async () => {
    const error = 'rebase conflicts outside the additive changelog resolver';
    vi.mocked(client.api.redeliverRun).mockRejectedValue(new ApiError(409, error, {
      error, conflicts: ['src/one.ts', 'src/two.ts'],
    }));
    const navigate = vi.fn();
    const user = userEvent.setup();
    const view = deliveredView();
    const card = render(<RunDelivery view={view} navigate={navigate} />);
    await user.click(await screen.findByTestId('run-redeliver-button'));
    const refusal = await screen.findByTestId('run-redeliver-conflicts');
    expect(refusal).toHaveTextContent('Rebase stopped: these files conflict with release outside the changelog. Nothing was pushed.');
    expect(screen.getAllByTestId('run-redeliver-conflict-file').map((li) => li.textContent)).toEqual(['src/one.ts', 'src/two.ts']);
    expect(refusal.querySelectorAll('ul > li.font-mono')).toHaveLength(2);

    card.unmount();
    let refresh!: (pr: RunPullRequest) => void;
    vi.mocked(client.api.runPullRequest).mockReturnValueOnce(new Promise((resolve) => { refresh = resolve; }));
    render(<RunDelivery view={view} navigate={navigate} />);
    expect(client.api.runPullRequest).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('run-pr-status')).toHaveTextContent('mergeable CONFLICTING');
    expect(screen.getByTestId('run-redeliver-conflicts')).toHaveTextContent('conflict with release outside the changelog. Nothing was pushed.');
    expect(screen.getAllByTestId('run-redeliver-conflict-file').map((li) => li.textContent)).toEqual(['src/one.ts', 'src/two.ts']);
    expect(screen.getByTestId('run-redeliver-revise')).toBeInTheDocument();
    expect(screen.queryByTestId('run-redeliver-error')).toBeNull();

    await act(async () => { refresh({ ...PR, baseRefName: 'main' }); });
    expect(screen.getByTestId('run-pr-conflict')).toHaveTextContent('conflicts with main');
    expect(screen.getByTestId('run-redeliver-conflicts')).toHaveTextContent('conflict with release');
    await user.click(screen.getByTestId('run-redeliver-revise'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/runs/new');
    const prefill = takeRetryPrefill();
    expect(prefill?.revisesPr?.number).toBe(PR.number);
    expect(prefill?.problem).toContain('resolve the merge conflict with origin/release in src/one.ts, src/two.ts (merge origin/release)');
  });

  it('R3 lists failed checks on the rebased tree and seeds a revision with their names', async () => {
    const error = 'repo checks failed on the rebased tree';
    vi.mocked(client.api.redeliverRun).mockRejectedValue(new ApiError(409, error, {
      error, failingChecks: ['lint'], report: 'lint output',
    }));
    const user = userEvent.setup();
    render(<RunDelivery view={deliveredView()} navigate={vi.fn()} />);
    await user.click(await screen.findByTestId('run-redeliver-button'));
    expect(await screen.findByTestId('run-redeliver-failing')).toHaveTextContent('Repo checks failed on the rebased tree: lint. Nothing was pushed.');
    await user.click(screen.getByTestId('run-redeliver-revise'));
    const prefill = takeRetryPrefill();
    expect(prefill?.problem).toBe('Revise PR #42 (wicked/run): Add the delivery action — fix the failing checks: lint');
    expect(prefill?.revisesPr?.number).toBe(PR.number);
  });

  it.each([404, 500])('keeps the base captured at click time and conflicts after a re-read loses the PR (%s)', async (status) => {
    let refuse!: (error: ApiError) => void;
    vi.mocked(client.api.redeliverRun).mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
    const view = deliveredView();
    const card = render(<RunDelivery view={view} navigate={vi.fn()} />);
    await userEvent.setup().click(await screen.findByTestId('run-redeliver-button'));
    vi.mocked(client.api.runPullRequest).mockResolvedValueOnce({ ...PR, baseRefName: 'main' });
    await act(async () => { useRedeliverStore.getState().load(runId); });
    expect(screen.getByTestId('run-pr-conflict')).toHaveTextContent('conflicts with main');
    await act(async () => { refuse(new ApiError(409, 'conflicts', { conflicts: ['src/one.ts'] })); });
    expect(screen.getByTestId('run-redeliver-conflicts')).toHaveTextContent('conflict with release');

    card.unmount();
    vi.mocked(client.api.runPullRequest).mockRejectedValueOnce(new ApiError(status, status === 404 ? 'not found' : 'gh failed'));
    render(<RunDelivery view={view} navigate={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('run-pr-status')).toBeNull());
    expect(screen.getByTestId('run-redeliver-conflicts')).toHaveTextContent('conflict with release outside the changelog. Nothing was pushed.');
    expect(screen.getByTestId('run-redeliver-conflict-file')).toHaveTextContent('src/one.ts');
    expect(screen.queryByTestId('run-redeliver-error')).toBeNull();
    await userEvent.setup().click(screen.getByTestId('run-redeliver-revise'));
    expect(takeRetryPrefill()?.problem).toContain('merge origin/release');
  });

  it('uses the generic PR base wording for a conflicts body when no base was captured', async () => {
    vi.mocked(client.api.runPullRequest).mockRejectedValueOnce(new ApiError(500, 'gh failed'));
    vi.mocked(client.api.redeliverRun).mockRejectedValueOnce(new ApiError(409, 'conflicts', { conflicts: ['src/one.ts'] }));
    render(<RunDelivery view={deliveredView()} navigate={vi.fn()} />);
    await screen.findByTestId('run-pr-unread');
    await act(async () => { useRedeliverStore.getState().redeliver(runId); });
    expect(screen.getByTestId('run-redeliver-conflicts')).toHaveTextContent("Rebase stopped: these files conflict with the PR's base outside the changelog. Nothing was pushed.");
    expect(screen.getByTestId('run-redeliver-conflict-file')).toHaveTextContent('src/one.ts');
    await userEvent.setup().click(screen.getByTestId('run-redeliver-revise'));
    expect(takeRetryPrefill()?.problem).toContain("merge the PR's base branch");
  });

  it.each([
    [409, 'PR branch moved since delivery', {}],
    [409, 'delivery is frozen', { code: 'delivery_frozen' }],
    [409, 'redeliver push failed: remote rejected', {}],
    [501, 'engine addon lacks checkRunTree', {}],
    [500, 'unexpected failure', {}],
    [409, 'malformed details', { conflicts: ['one.ts', 3], failingChecks: 'lint' }],
  ])('R4 keeps a %s refusal verbatim without a no-push claim (%s)', async (status, wire, body) => {
    const error = new ApiError(status, wire, { error: wire, ...body });
    vi.mocked(client.api.redeliverRun).mockRejectedValue(error);
    render(<RunDelivery view={deliveredView()} navigate={vi.fn()} />);
    await userEvent.setup().click(await screen.findByTestId('run-redeliver-button'));
    const refusal = await screen.findByTestId('run-redeliver-error');
    expect(refusal.querySelector('p:first-child')).toHaveTextContent(/^Re-delivery refused\.$/);
    expect(refusal.querySelector('p.font-mono.break-words.whitespace-pre-wrap')?.textContent).toBe(error.message);
    expect(screen.getByTestId('run-delivery')).not.toHaveTextContent('Nothing was pushed');
    expect(screen.queryByTestId('run-redeliver-revise')).toBeNull();
  });

  it('R5 refuses to offer redelivery over a moved head and names both heads', async () => {
    vi.mocked(client.api.runPullRequest).mockResolvedValue({ ...PR, headMoved: true, headSha: NEW });
    render(<RunDelivery view={deliveredView()} />);
    expect(await screen.findByTestId('run-pr-moved')).toHaveTextContent(
      'The PR branch moved since crew delivered it (now abcdef0, delivered 1234567); crew will not re-deliver over it.',
    );
    expect(screen.queryByTestId('run-redeliver-button')).toBeNull();
  });

  it('R5 offers no redelivery without a recorded delivered head', async () => {
    const pr = { ...PR };
    delete pr.deliveredHead;
    vi.mocked(client.api.runPullRequest).mockResolvedValue(pr);
    render(<RunDelivery view={deliveredView()} />);
    await screen.findByTestId('run-pr-status');
    expect(screen.getByTestId('run-pr-no-delivered-head')).toHaveTextContent('Crew has no recorded delivered head for this PR, so it cannot re-deliver it.');
    expect(screen.queryByTestId('run-redeliver-button')).toBeNull();
  });

  it.each([
    { state: 'OPEN', mergeable: 'MERGEABLE' },
    { state: 'CLOSED', mergeable: 'CONFLICTING' },
    { state: 'MERGED', mergeable: 'UNKNOWN' },
  ])('R6 shows status only for $state / $mergeable', async (fields) => {
    vi.mocked(client.api.runPullRequest).mockResolvedValue({ ...PR, ...fields });
    render(<RunDelivery view={deliveredView()} />);
    expect(await screen.findByTestId('run-pr-status')).toHaveTextContent(`GitHub: ${fields.state} · mergeable ${fields.mergeable} · merge state DIRTY`);
    expect(screen.queryByTestId('run-redeliver-button')).toBeNull();
    expect(screen.queryByTestId('run-pr-conflict')).toBeNull();
  });

  it.each(['not found', 'Not Found'])('R7 renders nothing for route-absent 404 (%s)', async (wire) => {
    vi.mocked(client.api.runPullRequest).mockRejectedValue(new ApiError(404, wire));
    render(<RunDelivery view={deliveredView()} navigate={vi.fn()} />);
    // No wrapper at all, before or after crew answers: the link is followed by the generic Revise button.
    expect(screen.getByTestId('run-delivery-link').nextElementSibling).toBe(screen.getByTestId('run-revise-pr'));
    await act(async () => {});
    expect(client.api.runPullRequest).toHaveBeenCalledExactlyOnceWith(runId);
    expect(screen.getByTestId('run-delivery-link').nextElementSibling).toBe(screen.getByTestId('run-revise-pr'));
    expect(screen.queryByTestId('run-pr-status')).toBeNull();
    expect(screen.queryByTestId('run-pr-unread')).toBeNull();
  });

  it.each([404, 409, 500])('R7 shows a real GET failure (%s) under Technical details', async (status) => {
    const error = new ApiError(status, status === 404 ? 'Run not found' : 'gh could not read');
    vi.mocked(client.api.runPullRequest).mockRejectedValue(error);
    render(<RunDelivery view={deliveredView()} />);
    const unread = await screen.findByTestId('run-pr-unread');
    expect(unread).toHaveTextContent("Crew can't show this PR's state.");
    expect(unread.querySelector('details')).not.toHaveAttribute('open');
    expect(unread.querySelector('pre')?.textContent).toBe(error.message);
    expect(screen.queryByTestId('run-redeliver-button')).toBeNull();
  });

  it('R8 names GitHub checks and prefills a revision even when the PR is mergeable', async () => {
    vi.mocked(client.api.runPullRequest).mockResolvedValue({ ...PR, mergeable: 'MERGEABLE', failingChecks: ['lint', 'types'] });
    render(<RunDelivery view={deliveredView()} navigate={vi.fn()} />);
    expect(await screen.findByTestId('run-pr-checks-failing')).toHaveTextContent('Failing checks on GitHub: lint, types');
    await userEvent.setup().click(screen.getByTestId('run-pr-checks-revise'));
    const prefill = takeRetryPrefill();
    expect(prefill?.problem).toBe('Revise PR #42 (wicked/run): Add the delivery action — fix the failing checks: lint, types');
    expect(prefill?.revisesPr?.number).toBe(PR.number);
  });

  it('R8 keeps the facts and redeliver action without navigation, hiding only the revision buttons', async () => {
    vi.mocked(client.api.runPullRequest).mockResolvedValue({ ...PR, failingChecks: ['lint'] });
    vi.mocked(client.api.redeliverRun).mockRejectedValue(new ApiError(409, 'checks failed', { failingChecks: ['lint'] }));
    render(<RunDelivery view={deliveredView()} />);
    await screen.findByTestId('run-pr-checks-failing');
    expect(screen.queryByTestId('run-pr-checks-revise')).toBeNull();
    await userEvent.setup().click(screen.getByTestId('run-redeliver-button'));
    await screen.findByTestId('run-redeliver-failing');
    expect(screen.queryByTestId('run-redeliver-revise')).toBeNull();
  });

  it.each([
    { conflicts: ['src/one.ts'] },
    { failingChecks: ['lint'] },
  ])('hides revision actions for a compare URL with refusal %j', async (body) => {
    const view = deliveredView();
    const href = 'https://github.com/acme/studio/compare/main...wicked/run';
    // The URL validator currently rejects compare URLs; supply one at the resolved-href
    // boundary so this tests the callback guard with the GitHub actions actually rendered.
    const resolved = delivery.resolveDelivery(delivery.deliveryOf(view));
    vi.spyOn(delivery, 'resolveDelivery').mockReturnValue({ ...resolved, claim: 'pr-open', href });
    vi.mocked(client.api.runPullRequest).mockResolvedValue({ ...PR, failingChecks: ['lint'] });
    vi.mocked(client.api.redeliverRun).mockRejectedValueOnce(new ApiError(409, 'refused', body));
    render(<RunDelivery view={view} navigate={vi.fn()} />);
    await screen.findByTestId('run-pr-checks-failing');
    expect(screen.queryByTestId('run-pr-checks-revise')).toBeNull();
    await userEvent.setup().click(screen.getByTestId('run-redeliver-button'));
    await screen.findByTestId('conflicts' in body ? 'run-redeliver-conflicts' : 'run-redeliver-failing');
    expect(screen.queryByTestId('run-redeliver-revise')).toBeNull();
    expect(screen.queryByTestId('run-revise-pr')).toBeNull();
  });

  it('places the GitHub state directly after the PR link and before the generic Revise button', async () => {
    render(<RunDelivery view={deliveredView()} navigate={vi.fn()} />);
    const status = await screen.findByTestId('run-pr-status');
    const stateBlock = screen.getByTestId('run-delivery-link').nextElementSibling;
    expect(stateBlock).toContainElement(status);
    expect(stateBlock?.nextElementSibling).toBe(screen.getByTestId('run-revise-pr'));
  });

  it.each(['executing', 'failed', 'cancelled'] as const)('R9 does not read the PR for a %s run', async (status) => {
    const view = deliveredView();
    view.session.status = status;
    render(<RunDelivery view={view} navigate={vi.fn()} />);
    await act(async () => {});
    expect(client.api.runPullRequest).not.toHaveBeenCalled();
    expect(screen.queryByTestId('run-pr-status')).toBeNull();
  });

  it('shares in-flight reads per run, keeps runs separate, and reads again on remount', async () => {
    let finish!: (pr: RunPullRequest) => void;
    vi.mocked(client.api.runPullRequest).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = deliveredView();
    const first = render(<RunDelivery view={view} />);
    const second = render(<RunDelivery view={view} />);
    expect(screen.queryByTestId('run-pr-status')).toBeNull();
    expect(screen.queryByTestId('run-redeliver-button')).toBeNull();
    expect(client.api.runPullRequest).toHaveBeenCalledExactlyOnceWith(runId);
    const other = deliveredView();
    other.session.id = `${runId}-other`;
    render(<RunDelivery view={other} />);
    await screen.findByTestId('run-pr-status');
    expect(client.api.runPullRequest).toHaveBeenCalledTimes(2);
    await act(async () => { finish(PR); });
    expect(screen.getAllByTestId('run-pr-status')).toHaveLength(3);
    first.unmount();
    second.unmount();
    render(<RunDelivery view={view} />);
    await waitFor(() => expect(client.api.runPullRequest).toHaveBeenCalledTimes(3));
  });

  it('keeps the successful result when the PR re-read fails, without inventing resolved conflicts', async () => {
    vi.mocked(client.api.redeliverRun).mockResolvedValue({ ...RESULT, conflictsResolved: [] });
    vi.mocked(client.api.runPullRequest).mockResolvedValueOnce(PR).mockRejectedValueOnce(new ApiError(500, 'gh could not read'));
    render(<RunDelivery view={deliveredView()} />);
    await userEvent.setup().click(await screen.findByTestId('run-redeliver-button'));
    await screen.findByTestId('run-pr-unread');
    expect(screen.getByTestId('run-redeliver-result')).toHaveTextContent('PASS (3 checks: lint, types, unit)');
    expect(screen.getByTestId('run-redeliver-result')).not.toHaveTextContent('Changelog conflicts resolved');
  });

  it('omits the names separator when the successful result has no check names', async () => {
    vi.mocked(client.api.redeliverRun).mockResolvedValueOnce({ ...RESULT, checks: { passed: true, count: 0, names: [] }, conflictsResolved: [] });
    render(<RunDelivery view={deliveredView()} />);
    await userEvent.setup().click(await screen.findByTestId('run-redeliver-button'));
    expect(await screen.findByTestId('run-redeliver-result')).toHaveTextContent(/^Re-delivered: 1234567 → abcdef0\. Repo checks on the new tree: PASS \(0 checks\)\.$/);
  });

  it('runs the post-redelivery re-read after a read that was already in flight (never dropped)', async () => {
    let finish!: (result: RedeliverRunResult) => void;
    vi.mocked(client.api.redeliverRun).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = deliveredView();
    const card = render(<RunDelivery view={view} />);
    await userEvent.setup().click(await screen.findByTestId('run-redeliver-button'));
    // A remount during the long POST starts a read that sees the pre-push PR.
    card.unmount();
    let prePush!: (pr: RunPullRequest) => void;
    vi.mocked(client.api.runPullRequest).mockReturnValueOnce(new Promise((resolve) => { prePush = resolve; }));
    render(<RunDelivery view={view} />);
    expect(client.api.runPullRequest).toHaveBeenCalledTimes(2);
    vi.mocked(client.api.runPullRequest).mockResolvedValue({ ...PR, mergeable: 'MERGEABLE', headSha: NEW, deliveredHead: NEW });
    await act(async () => { finish(RESULT); });
    expect(client.api.runPullRequest).toHaveBeenCalledTimes(2);
    await act(async () => { prePush(PR); });
    await waitFor(() => expect(client.api.runPullRequest).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByTestId('run-pr-status')).toHaveTextContent('mergeable MERGEABLE'));
  });

  it('re-reads the PR after a refusal and drops the refusal once GitHub says the branch moved', async () => {
    vi.mocked(client.api.redeliverRun).mockRejectedValue(new ApiError(409, 'PR branch moved since delivery', { error: 'PR branch moved since delivery' }));
    vi.mocked(client.api.runPullRequest).mockResolvedValueOnce(PR).mockResolvedValue({ ...PR, headMoved: true, headSha: NEW });
    render(<RunDelivery view={deliveredView()} />);
    await userEvent.setup().click(await screen.findByTestId('run-redeliver-button'));
    expect(await screen.findByTestId('run-pr-moved')).toHaveTextContent('now abcdef0, delivered 1234567');
    expect(client.api.runPullRequest).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('run-redeliver-error')).toBeNull();
    expect(screen.queryByTestId('run-redeliver-button')).toBeNull();
  });

  it('keeps a conflicts refusal when the re-read still shows the same conflicting PR', async () => {
    vi.mocked(client.api.redeliverRun).mockRejectedValue(new ApiError(409, 'rebase conflicts', { conflicts: ['a.ts', 'a.ts', 'b.ts'] }));
    render(<RunDelivery view={deliveredView()} />);
    await userEvent.setup().click(await screen.findByTestId('run-redeliver-button'));
    await waitFor(() => expect(client.api.runPullRequest).toHaveBeenCalledTimes(2));
    // Repeated paths are listed once.
    await waitFor(() => expect(screen.getAllByTestId('run-redeliver-conflict-file').map((li) => li.textContent)).toEqual(['a.ts', 'b.ts']));
  });

  it('says checks failed with no names when crew names none, and an empty conflict list is not a conflicts card', async () => {
    vi.mocked(client.api.redeliverRun)
      .mockRejectedValueOnce(new ApiError(409, 'repo checks failed on the rebased tree', { failingChecks: [], report: { checks: [] } }))
      .mockRejectedValueOnce(new ApiError(409, 'rebase conflicts', { conflicts: [] }));
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<RunDelivery view={deliveredView()} navigate={navigate} />);
    await user.click(await screen.findByTestId('run-redeliver-button'));
    expect(await screen.findByTestId('run-redeliver-failing')).toHaveTextContent(/^Repo checks failed on the rebased tree\. Nothing was pushed\.$/);
    await user.click(screen.getByTestId('run-redeliver-revise'));
    expect(takeRetryPrefill()?.problem).toBe('Revise PR #42 (wicked/run): Add the delivery action — fix the repo checks that failed on the rebased tree');
    await user.click(screen.getByTestId('run-redeliver-button'));
    expect(await screen.findByTestId('run-redeliver-error')).toHaveTextContent('rebase conflicts');
    expect(screen.queryByTestId('run-redeliver-conflicts')).toBeNull();
  });
});

describe('redelivery client wire', () => {
  it('encodes the run id for GET /pr and POST /redeliver, without a POST body', async () => {
    vi.mocked(client.api.runPullRequest).mockRestore();
    vi.mocked(client.api.redeliverRun).mockRestore();
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(PR)))
      .mockResolvedValueOnce(new Response(JSON.stringify(RESULT)));
    expect(await client.api.runPullRequest('run/a')).toEqual(PR);
    expect(await client.api.redeliverRun('run/a')).toEqual(RESULT);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${client.apiBase()}/runs/run%2Fa/pr`);
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(fetch.mock.calls[1]?.[0]).toBe(`${client.apiBase()}/runs/run%2Fa/redeliver`);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(fetch.mock.calls[1]?.[1]?.body).toBeUndefined();
  });
});
