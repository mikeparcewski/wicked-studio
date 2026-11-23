// studio#1357 — an Azure DevOps pull request is a pull request: the URL crew records for one
// (`https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequest/<n>`, its deliver helper's ADOWEB + `/pullrequest/<id>`)
// passes the one PR-href gate, reads its number, shows the link on the Delivery card and offers Revise this PR, which
// prefills `revisesPr` for it. Every look-alike stays refused.
//
// Real shape: the run record's `deliverUrl` and the deliver phase's last lines, as the live Azure DevOps proof served
// them (lanes/ado-proof evidence run-leg2-final.json / run-leg2-deliver-output.txt, crew 0.18.20, 2026-11-23).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RunDelivery } from '../src/components/RunDelivery.js';
import { deliveryOf, isPrUrl, prNumberOf, prUrlFrom } from '../src/components/delivery.js';
import { deliverySummary } from '../src/board/proposalCard.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { takeRetryPrefill } from '../src/store/retryPrefill.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionWithDelivery } from '../src/api/types.js';

/** `session.deliverUrl` of run 71fe752f, the live proof's Azure DevOps delivery. */
const ADO_PR = 'https://dev.azure.com/mikeparcewski/wicked/_git/wicked/pullrequest/1';
const RUN = '71fe752f-f17b-5978-9631-73fb3e11c7de';
const BRANCH = `wicked/${RUN}`;
/** The deliver phase's last lines (the URL, then the trusted sentinel). */
const DELIVER_TAIL = `deliver: Azure DevOps origin — https://dev.azure.com/mikeparcewski/wicked/_git/wicked (the push and the pull request use the daemon's Azure DevOps credential; gh is not used)\n${ADO_PR}\ndeliver: OUTCOME 0123456789abcdef0123456789abcdef pr\n`;

function delivered(url = ADO_PR): ReturnType<typeof makeView> {
  const v = makeView(
    { id: RUN, workflow_id: 'bug', status: 'completed', repo_ref: 'wicked', problem: 'In the wicked repo, fix AB#1: sum() in src/math.js returns the wrong total.', clis: ['claude', 'codex'], run_branch: BRANCH },
    [makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 5, status: 'done' })],
  );
  (v.session as SessionWithDelivery).delivery = 'delivered';
  (v.session as SessionWithDelivery).deliverUrl = url;
  return v;
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  useDeliveryStore.setState({ byRun: {} });
  usePostHocDeliverStore.setState({ byRun: {} });
  takeRetryPrefill();
});
afterEach(() => { cleanup(); clearCachedWorkflows(); });

describe('studio#1357 the Azure DevOps PR url', () => {
  it('passes the PR-href gate and reads its number; GitHub is unchanged', () => {
    expect(isPrUrl(ADO_PR)).toBe(true);
    expect(prNumberOf(ADO_PR)).toBe(1);
    expect(prNumberOf('https://github.com/acme/studio/pull/42')).toBe(42);
  });

  it.each([
    ['a query', `${ADO_PR}?_a=files`],
    ['a fragment', `${ADO_PR}#overview`],
    ['http', ADO_PR.replace('https:', 'http:')],
    ['userinfo', ADO_PR.replace('https://', 'https://someone@')],
    ['another host', ADO_PR.replace('dev.azure.com', 'dev.azure.com.evil.example')],
    ['no _git segment', 'https://dev.azure.com/mikeparcewski/wicked/wicked/pullrequest/1'],
    ['an extra segment', 'https://dev.azure.com/mikeparcewski/wicked/_git/wicked/x/pullrequest/1'],
    ['the PR list', 'https://dev.azure.com/mikeparcewski/wicked/_git/wicked/pullrequests'],
    ['the create form', 'https://dev.azure.com/mikeparcewski/wicked/_git/wicked/pullrequestcreate?sourceRef=x'],
    ['no number', 'https://dev.azure.com/mikeparcewski/wicked/_git/wicked/pullrequest/'],
    ['javascript:', 'javascript:alert(1)//dev.azure.com/o/p/_git/r/pullrequest/1'],
  ])('refuses %s', (_name, url) => {
    expect(isPrUrl(url)).toBe(false);
    expect(prNumberOf(url)).toBeNull();
  });

  it('is the delivery the deliver transcript names (crew\'s last-line URL)', () => {
    expect(prUrlFrom(DELIVER_TAIL)).toBe(ADO_PR);
  });

  it('the run record\'s deliverUrl is the delivery: a PR link, and "Pull request #1"', () => {
    const v = delivered();
    expect(deliveryOf(v).url).toBe(ADO_PR);
    expect(deliverySummary(v)).toBe('Pull request #1');
  });
});

describe('studio#1357 the Delivery card on an Azure DevOps PR', () => {
  it('shows the PR link, never "no PR link"', () => {
    render(<RunDelivery view={delivered()} navigate={vi.fn()} />);
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'pr-open');
    expect(screen.getByTestId('run-delivery-link')).toHaveAttribute('href', ADO_PR);
    expect(screen.getByTestId('run-delivery').textContent).not.toMatch(/recorded no PR link/);
  });

  it('offers Revise this PR, which prefills revisesPr 1 on the run branch', async () => {
    const navigate = vi.fn();
    render(<RunDelivery view={delivered()} navigate={navigate} />);
    const button = screen.getByTestId('run-revise-pr');
    expect(button).toHaveAttribute('data-pr', '1');
    await userEvent.setup().click(button);
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    const prefill = takeRetryPrefill();
    expect(prefill!.revisesPr).toMatchObject({ number: 1, headRef: BRANCH });
    expect(prefill!.repoRef).toBe('wicked');
    expect(prefill!.problem.startsWith(`Revise PR #1 (${BRANCH}): `)).toBe(true);
  });
});
