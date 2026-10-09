import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { StrandedCard } from '../src/components/session/StrandedCard.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';

/**
 * S16a-1a (studio#587): the stranded run's "Deliver — open a PR" door in its own thread. The card
 * sends NOTHING on render or on arrival; the operator's press sends exactly one
 * POST /runs/:id/deliver (a second press while delivering is ignored); a refusal keeps the
 * daemon's words verbatim under studio's headline; a delivered answer swaps in the receipt + PR.
 */

const PR = 'https://github.com/o/r/pull/88';
const REFUSAL = 'the daemon refused this — rebase onto origin/main hit a conflict in src/api/routes.ts; nothing was pushed';

function strandedView(id = 'r-str'): SessionView {
  const v = makeView(
    { id, workflow_id: 'feature', status: 'completed', workdir: '/w/trees/r-str', problem: 'Fix the double charge' },
    [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'rejected', phase_ref: 'deliver' })],
  );
  (v.session as SessionWithDelivery).delivery = 'stranded';
  return v;
}

beforeEach(() => {
  vi.restoreAllMocks();
  usePostHocDeliverStore.setState({ byRun: {} });
  useRunEventStore.setState({ byRun: { 'r-str': [] } });
  window.localStorage.clear();
  window.history.replaceState(null, '', '/s/run%3Ar-str');
});
afterEach(cleanup);

describe('S16a-1a: the stranded card in the thread', () => {
  it('renders the outcome, the worktree and the door — and POSTs nothing on render', () => {
    const deliver = vi.spyOn(client.api, 'deliverRun');
    render(<StrandedCard view={strandedView()} />);
    expect(screen.getByTestId('session-stranded').dataset.state).toBe('ask');
    expect(screen.getByTestId('session-proposal-outcome')).toHaveTextContent('Finished, but the work hasn’t been pushed anywhere yet');
    expect(screen.getByTestId('session-stranded-worktree')).toHaveTextContent('/w/trees/r-str');
    expect(screen.getByTestId('session-stranded-deliver')).toHaveTextContent('Deliver — open a PR');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('a press sends exactly one POST /runs/:id/deliver (a double press is one request); delivered swaps in the receipt + PR', async () => {
    let resolve: (v: { prUrl: string }) => void = () => {};
    const deliver = vi.spyOn(client.api, 'deliverRun').mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<StrandedCard view={strandedView()} />);
    const btn = screen.getByTestId('session-stranded-deliver');
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(deliver).toHaveBeenCalledExactlyOnceWith('r-str');
    expect(screen.getByTestId('session-stranded-deliver')).toBeDisabled();
    expect(screen.getByTestId('session-stranded-deliver')).toHaveTextContent('Delivering…');
    resolve({ prUrl: PR });
    await waitFor(() => { expect(screen.getByTestId('session-stranded').dataset.state).toBe('delivered'); });
    expect(screen.getByTestId('session-proposal-pr')).toHaveAttribute('href', PR);
    expect(screen.getByTestId('session-proposal-outcome')).toHaveTextContent('Finished · delivered');
  });

  it('a refusal keeps the daemon’s words verbatim under the headline, and the door stays', async () => {
    vi.spyOn(client.api, 'deliverRun').mockRejectedValue(new ApiError(409, REFUSAL));
    render(<StrandedCard view={strandedView()} />);
    await userEvent.click(screen.getByTestId('session-stranded-deliver'));
    const err = await screen.findByTestId('session-stranded-error');
    expect(err).toHaveTextContent('Delivery failed — the run is still stranded.');
    expect(err.textContent).toContain(REFUSAL);
    expect(screen.getByTestId('session-stranded-deliver')).not.toBeDisabled();
  });

  it('"Leave it" folds the card to one line for this browser (nothing sent); arriving with #deliver unfolds it and focuses the door', async () => {
    const deliver = vi.spyOn(client.api, 'deliverRun');
    const { unmount } = render(<StrandedCard view={strandedView()} />);
    await userEvent.click(screen.getByTestId('session-stranded-leave'));
    expect(screen.getByTestId('session-stranded').dataset.state).toBe('left');
    expect(screen.queryByTestId('session-stranded-deliver')).toBeNull();
    unmount();
    render(<StrandedCard view={strandedView()} />);
    expect(screen.getByTestId('session-stranded').dataset.state).toBe('left');
    cleanup();
    window.history.replaceState(null, '', '/s/run%3Ar-str#deliver');
    render(<StrandedCard view={strandedView()} />);
    await waitFor(() => { expect(screen.getByTestId('session-stranded-deliver')).toHaveFocus(); });
    expect(deliver).not.toHaveBeenCalled();
  });
});
