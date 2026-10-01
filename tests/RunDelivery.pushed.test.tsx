// N1 (ship re-proof, the half of F2 that did not hold): a SUCCESSFUL push-only delivery — a
// non-GitHub origin, branch pushed, run completed — read "Stranded — this run finished, but its
// work is sitting uncommitted in its worktree. No PR is on record." with a "Deliver — open a PR"
// button. The work was committed and on the remote; the button could only fail. The wire now
// says `delivery: 'pushed'` with the branch and the remote, and the card says exactly that.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { DeliveryBadge, RunDelivery } from '../src/components/RunDelivery.js';
import { deliveryOf, deliverySummary } from '../src/components/delivery.js';
import { deliveryCounts } from '../src/board/windowStats.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';

function pushedView(id = 'r-push'): SessionView {
  const v = makeView(
    { id, workflow_id: 'feature', status: 'completed', workdir: `/w/trees/${id}`, repo_ref: 'tally-kit' },
    [
      makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'done' }),
    ],
  );
  const s = v.session as SessionWithDelivery;
  s.delivery = 'pushed';
  s.deliverBranch = `wicked/${id}`;
  s.deliverRemote = '/srv/proof/remote.git';
  return v;
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  useDeliveryStore.setState({ byRun: {} });
  usePostHocDeliverStore.setState({ byRun: {} });
});
afterEach(() => { cleanup(); clearCachedWorkflows(); });

describe("N1 — delivery: 'pushed' reads as delivered, never stranded", () => {
  it('names the branch and the remote, claims no PR, and offers no impossible action', () => {
    const getUnitOutput = vi.spyOn(client.api, 'getUnitOutput');
    const v = pushedView();
    render(
      <>
        <DeliveryBadge view={v} />
        <RunDelivery view={v} />
      </>,
    );
    const card = screen.getByTestId('run-delivery');
    expect(card.getAttribute('data-state')).toBe('pushed');
    expect(card.textContent).toContain('Delivered as a pushed branch');
    expect(card.textContent).toContain('the origin is not a GitHub host gh can resolve');
    expect(screen.getByTestId('run-delivery-pushed').textContent).toContain('wicked/r-push is on');
    expect(screen.getByTestId('run-delivery-pushed').textContent).toContain('remote.git');
    // The full remote is always one hover away (Copilot on #397).
    expect(screen.getByTestId('run-delivery-pushed').getAttribute('title')).toBe('/srv/proof/remote.git');
    // The re-proof's false sentence and its impossible button are gone.
    expect(card.textContent).not.toContain('Stranded');
    expect(card.textContent).not.toContain('No PR is on record');
    expect(screen.queryByTestId('run-deliver-button')).toBeNull();
    expect(screen.queryByTestId('run-delivery-link')).toBeNull();
    expect(screen.getByTestId('run-delivery-badge').textContent).toBe('branch pushed');
    // A wire-carried verdict needs no transcript read.
    expect(getUnitOutput).not.toHaveBeenCalled();
  });

  it('the derivation and the rollups count it as delivered work, not as needing review', () => {
    const v = pushedView();
    expect(deliveryOf(v)).toMatchObject({
      state: 'pushed',
      pushed: { branch: 'wicked/r-push', remote: '/srv/proof/remote.git' },
    });
    expect(deliveryCounts([v])).toEqual({ delivered: 1, stranded: 0, vacuous: 0 });
    expect(deliverySummary([v])).toBe('1 branch pushed');
  });
});

describe('N1 — a hosted remote keeps its host visible', () => {
  it('a URL or scp-like remote is shown whole; only a filesystem path is compacted', () => {
    for (const remote of ['https://gitlab.example.com/acme/tools/deep/repo.git', 'git@gitlab.example.com:acme/tools/repo.git']) {
      const v = pushedView('r-host');
      (v.session as SessionWithDelivery).deliverRemote = remote;
      render(<RunDelivery view={v} />);
      expect(screen.getByTestId('run-delivery-pushed').textContent).toContain(remote);
      cleanup();
    }
  });
});
