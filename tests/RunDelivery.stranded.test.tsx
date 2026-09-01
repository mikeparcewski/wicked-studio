import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { DeliveryBadge, RunDelivery } from '../src/components/RunDelivery.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';

/**
 * The STRANDED Delivery card (crew#393, issue #393's run 83052f0b): a completed
 * run whose reviewable work sits uncommitted in its worktree must be LOUD —
 * amber state, the worktree named, and the one-click remedy in place:
 * `POST /runs/:id/deliver`.
 *
 *  - success swaps the whole arm for the ordinary pr-open link (one claim path
 *    — `resolveDelivery` with the answered `prUrl` as its readUrl), and the
 *    header badge flips in the same paint (the D1 rule);
 *  - failure renders denialCopy-style: studio's plain headline, then the
 *    daemon's own words VERBATIM — never re-worded, never silent — and the
 *    button re-arms (the endpoint is idempotent, so a retry cannot double a PR);
 *  - a double-click while in flight fires ONE POST.
 */

const PR = 'https://github.com/o/r/pull/77';
const REFUSAL =
  'rebase onto origin/main hit a conflict in src/api/routes.ts — nothing was pushed';

function strandedView(id = 'r-str'): SessionView {
  const v = makeView(
    { id, workflow_id: 'feature', status: 'completed', workdir: '/w/trees/r-str', repo_ref: 'studio-api' },
    [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' })],
  );
  (v.session as SessionWithDelivery).delivery = 'stranded';
  return v;
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  useDeliveryStore.setState({ byRun: {} });
  usePostHocDeliverStore.setState({ byRun: {} });
});
afterEach(() => { cleanup(); clearCachedWorkflows(); });

describe('the delivered card off the 0.18.0 wire', () => {
  it("delivery: 'delivered' + deliverUrl renders the PR link straight off the DTO — zero fetches", () => {
    const getUnitOutput = vi.spyOn(client.api, 'getUnitOutput');
    const v = strandedView('r-del');
    (v.session as SessionWithDelivery).delivery = 'delivered';
    (v.session as SessionWithDelivery).deliverUrl = PR;
    render(
      <>
        <DeliveryBadge view={v} />
        <RunDelivery view={v} />
      </>,
    );
    expect(screen.getByTestId('run-delivery').dataset.state).toBe('pr-open');
    expect(screen.getByTestId('run-delivery-link')).toHaveAttribute('href', PR);
    expect(screen.getByTestId('run-delivery-badge').textContent).toBe('PR open');
    expect(screen.queryByTestId('run-deliver-button')).toBeNull();
    // The wire carried the url, so the one sanctioned transcript read never fires.
    expect(getUnitOutput).not.toHaveBeenCalled();
  });
});

describe('the stranded card', () => {
  it('renders amber, names the worktree, and offers the one-click Deliver', () => {
    render(<RunDelivery view={strandedView()} />);
    const card = screen.getByTestId('run-delivery');
    expect(card.dataset.state).toBe('stranded');
    // The loud sentence, in the stranded (gate) color — not fail, not accent.
    expect(card.textContent).toMatch(/sitting uncommitted in its worktree/i);
    expect(card.textContent).toMatch(/No PR is on record/);
    // The DTO fact: where the work is.
    expect(card.textContent).toContain('the work is in');
    expect(screen.getByTitle('/w/trees/r-str')).toBeInTheDocument();
    // The remedy, armed.
    expect(screen.getByTestId('run-deliver-button')).toBeEnabled();
    expect(screen.getByTestId('run-deliver-button').textContent).toMatch(/Deliver/);
  });

  it('the header badge says stranded off the same resolution the body renders', () => {
    render(<DeliveryBadge view={strandedView()} />);
    const badge = screen.getByTestId('run-delivery-badge');
    expect(badge.dataset.state).toBe('stranded');
    expect(badge.textContent).toBe('stranded');
  });

  it('Deliver → POST /runs/:id/deliver: loading, then the pr-open link in place', async () => {
    let resolvePost!: (v: { prUrl: string }) => void;
    vi.spyOn(client.api, 'deliverRun').mockReturnValue(
      new Promise((r) => { resolvePost = r; }),
    );
    const user = userEvent.setup();
    render(
      <>
        <DeliveryBadge view={strandedView()} />
        <RunDelivery view={strandedView()} />
      </>,
    );

    await user.click(screen.getByTestId('run-deliver-button'));
    expect(client.api.deliverRun).toHaveBeenCalledExactlyOnceWith('r-str');
    // In flight: the button says so and disarms.
    const button = screen.getByTestId('run-deliver-button');
    expect(button).toBeDisabled();
    expect(button.textContent).toMatch(/Delivering…/);

    resolvePost({ prUrl: PR });
    // Success IS the ordinary pr-open arm — link, accent claim, no leftover
    // stranded copy — and the badge flipped with it (D1: one resolution).
    await waitFor(() => expect(screen.getByTestId('run-delivery-link')).toBeInTheDocument());
    expect(screen.getByTestId('run-delivery-link')).toHaveAttribute('href', PR);
    expect(screen.getByTestId('run-delivery').dataset.state).toBe('pr-open');
    expect(screen.getByTestId('run-delivery-badge').dataset.state).toBe('pr-open');
    expect(screen.queryByTestId('run-deliver-button')).toBeNull();
    expect(screen.getByTestId('run-delivery').textContent).not.toMatch(/stranded/i);
  });

  it('a double-click while in flight fires ONE POST', async () => {
    vi.spyOn(client.api, 'deliverRun').mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<RunDelivery view={strandedView()} />);
    const button = screen.getByTestId('run-deliver-button');
    await user.click(button);
    // The DOM disables it, and the store's synchronous in-flight guard holds
    // even if a stale handler fires anyway.
    usePostHocDeliverStore.getState().deliver('r-str');
    expect(client.api.deliverRun).toHaveBeenCalledTimes(1);
  });

  it('failure is LOUD and VERBATIM — the daemon’s own words, then the button re-arms', async () => {
    // The 409 shape: apiFetch already extracted the body's `error` into the
    // ApiError message — the deliver script's own refusal, e.g. the rebase
    // conflict with nothing pushed.
    vi.spyOn(client.api, 'deliverRun').mockRejectedValue(new ApiError(409, REFUSAL));
    const user = userEvent.setup();
    render(<RunDelivery view={strandedView()} />);

    await user.click(screen.getByTestId('run-deliver-button'));
    const error = await screen.findByTestId('run-deliver-error');
    // denialCopy conventions: studio's plain headline…
    expect(error.textContent).toMatch(/Delivery failed — the run is still stranded\./);
    // …and the engine detail VERBATIM inside the EC33 translated sentence,
    // never re-worded (ApiError.message carries the daemon's words whole).
    expect(error.textContent).toContain(REFUSAL);
    // The card stays stranded (nothing was delivered) and the remedy re-arms —
    // idempotent server-side, so a retry can never open a second PR.
    expect(screen.getByTestId('run-delivery').dataset.state).toBe('stranded');
    expect(screen.getByTestId('run-deliver-button')).toBeEnabled();
  });

  it('a retry after failure fires a fresh POST and can succeed', async () => {
    const spy = vi
      .spyOn(client.api, 'deliverRun')
      .mockRejectedValueOnce(new ApiError(409, REFUSAL))
      .mockResolvedValueOnce({ prUrl: PR });
    const user = userEvent.setup();
    render(<RunDelivery view={strandedView()} />);

    await user.click(screen.getByTestId('run-deliver-button'));
    await screen.findByTestId('run-deliver-error');
    await user.click(screen.getByTestId('run-deliver-button'));
    await waitFor(() => expect(screen.getByTestId('run-delivery-link')).toBeInTheDocument());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('run-deliver-error')).toBeNull();
  });

  it('a DETAIL-LESS refusal still renders a complete sentence, never a blank red paragraph', async () => {
    // ApiError itself mints the honest fallback for an empty wire body (EC33);
    // the store's own empty-degrade covers non-ApiError throws.
    vi.spyOn(client.api, 'deliverRun').mockRejectedValue(new ApiError(500, '   '));
    const user = userEvent.setup();
    render(<RunDelivery view={strandedView()} />);
    await user.click(screen.getByTestId('run-deliver-button'));
    const error = await screen.findByTestId('run-deliver-error');
    expect(error.textContent).toMatch(/HTTP 500 with no detail/);
  });
});
