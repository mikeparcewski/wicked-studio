// Issue #301 — Delivered run's Delivery panel: "Revise this PR" button opens the Build
// composer prefilled with the revisesPr shape (repo, base=PR branch, intent from session).
//
// The button appears only when:
//   - claim is 'pr-open' (the run has a delivered PR URL)
//   - `navigate` is provided by the host (App threads it; isolated renders pass it as a prop)
//   - the URL parses to a pull number (/pull/NNN)
//
// On click: setRetryPrefill is called with revisesPr.{number, title, headRef}, then navigate('/runs/new').

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunDelivery } from '../src/components/RunDelivery.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { takeRetryPrefill } from '../src/store/retryPrefill.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionWithDelivery } from '../src/api/types.js';

const PR_URL = 'https://github.com/acme/studio/pull/42';
const RUN = 'delivered-run-rev';
const PROBLEM = 'implement the escalation gate verbs';
const RUN_BRANCH = 'wicked/92f796f1-foo-bar';

function deliveredView(prUrl = PR_URL): ReturnType<typeof makeView> {
  const v = makeView(
    {
      id: RUN,
      workflow_id: 'feature',
      status: 'completed',
      workdir: '/w/trees/delivered-run-rev',
      repo_ref: 'studio',
      problem: PROBLEM,
      clis: ['claude'],
      run_branch: RUN_BRANCH,
    },
    [makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 5, status: 'done' })],
  );
  (v.session as SessionWithDelivery).delivery = 'delivered';
  (v.session as SessionWithDelivery).deliverUrl = prUrl;
  return v;
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  useDeliveryStore.setState({ byRun: {} });
  usePostHocDeliverStore.setState({ byRun: {} });
  // Clear any leftover prefill from a prior test.
  takeRetryPrefill();
});
afterEach(() => { cleanup(); clearCachedWorkflows(); });

describe('RunDelivery — "Revise this PR" button (#301)', () => {
  it('renders the button when claim is pr-open and navigate is provided', () => {
    const navigate = vi.fn();
    render(<RunDelivery view={deliveredView()} navigate={navigate} />);
    expect(screen.getByTestId('run-revise-pr')).toBeInTheDocument();
    expect(screen.getByTestId('run-revise-pr')).toHaveTextContent('Revise this PR');
  });

  it('button carries data-pr equal to the PR number parsed from the URL', () => {
    const navigate = vi.fn();
    render(<RunDelivery view={deliveredView()} navigate={navigate} />);
    expect(screen.getByTestId('run-revise-pr')).toHaveAttribute('data-pr', '42');
  });

  it('does NOT render when navigate is absent', () => {
    render(<RunDelivery view={deliveredView()} />);
    expect(screen.queryByTestId('run-revise-pr')).toBeNull();
  });

  it('does NOT render when the delivery URL has no pull number', () => {
    const navigate = vi.fn();
    render(<RunDelivery view={deliveredView('https://github.com/acme/studio/compare/feature')} navigate={navigate} />);
    expect(screen.queryByTestId('run-revise-pr')).toBeNull();
  });

  it('does NOT render when the run is not in pr-open state (no PR URL)', () => {
    const v = makeView(
      { id: RUN, workflow_id: 'feature', status: 'completed', problem: PROBLEM, run_branch: RUN_BRANCH },
      [makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 5, status: 'done' })],
    );
    const navigate = vi.fn();
    render(<RunDelivery view={v} navigate={navigate} />);
    expect(screen.queryByTestId('run-revise-pr')).toBeNull();
  });

  it('on click: deposits revisesPr prefill and calls navigate("/runs/new")', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<RunDelivery view={deliveredView()} navigate={navigate} />);
    await user.click(screen.getByTestId('run-revise-pr'));
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    const prefill = takeRetryPrefill();
    expect(prefill).not.toBeNull();
    expect(prefill!.retryOf).toBeNull();
    expect(prefill!.revisesPr).toMatchObject({
      number: 42,
      title: PROBLEM,
      headRef: RUN_BRANCH,
    });
  });

  it('prefill problem is prefixed with "Revise PR #N (<headRef>):" and seeds from the session problem', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<RunDelivery view={deliveredView()} navigate={navigate} />);
    await user.click(screen.getByTestId('run-revise-pr'));
    const prefill = takeRetryPrefill();
    expect(prefill!.problem).toBe(`Revise PR #42 (${RUN_BRANCH}): ${PROBLEM}`);
  });

  it('headRef falls back to empty string when run_branch is absent', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const v = deliveredView();
    delete (v.session as { run_branch?: string }).run_branch;
    render(<RunDelivery view={v} navigate={navigate} />);
    await user.click(screen.getByTestId('run-revise-pr'));
    const prefill = takeRetryPrefill();
    expect(prefill!.revisesPr?.headRef).toBe('');
  });

  it('does NOT render when the PR URL has a query string (isPrUrl rejects it before prNumberFromUrl)', () => {
    // isPrUrl enforces no search/hash — a url like ?diff=split would be rejected upstream.
    const navigate = vi.fn();
    render(<RunDelivery view={deliveredView('https://github.com/acme/studio/pull/42?diff=split')} navigate={navigate} />);
    expect(screen.queryByTestId('run-revise-pr')).toBeNull();
  });
});
