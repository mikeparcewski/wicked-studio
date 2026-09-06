import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The reusable proposal-REVIEW section (DES-MEM-FACETED-001, unified surface) — the "proposals
 * (review)" half both Steering sub-sections embed, parameterized by a fixed kind:
 *  - it lists only the PENDING proposals of its own kind (a memory section hides policy proposals,
 *    and vice-versa), narrowing the one `GET /proposals?state=pending` load client-side;
 *  - Approve / Reject ride `POST /proposals/:id/{approve,reject}`; on success the row leaves the
 *    queue, a note confirms it, and the list reloads for the server's state;
 *  - loading / error / empty / forward-compat-unsupported all render honestly in-band.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { ProposalsSection } = await import('../src/components/ProposalsSection.js');
const { ApiError } = await import('../src/api/errors.js');
type Proposal = import('../src/api/proposals.js').Proposal;

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p-mem',
    kind_type: 'memory',
    payload: { content: 'Remember the gh account flip', tier: 'session' },
    facets: { project: 'wicked' },
    provenance: { run_id: 'run-1', agent: 'claude' },
    state: 'pending',
    created_at: 1_700_000_000,
    ...over,
  };
}

const MEM = proposal();
const POL = proposal({
  id: 'p-pol',
  kind_type: 'policy:security',
  payload: { rule: 'Never log secrets', severity: 'critical' },
});

/** A stateful wire: GET returns the current pending set; approve/reject remove from it. */
function wire(initial: Proposal[]): { calls: string[] } {
  let pending = [...initial];
  const calls: string[] = [];
  apiFetch.mockImplementation((path: unknown) => {
    const s = String(path);
    calls.push(s);
    const parts = s.split('/');
    if (s.endsWith('/approve')) { pending = pending.filter((p) => p.id !== parts[2]); return Promise.resolve({ ok: true, id: parts[2] }); }
    if (s.endsWith('/reject')) { pending = pending.filter((p) => p.id !== parts[2]); return Promise.resolve({ ok: true }); }
    return Promise.resolve({ proposals: pending });
  });
  return { calls };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('ProposalsSection — a fixed-kind review queue', () => {
  it('policy section shows only policy proposals; memory section only memory proposals', async () => {
    wire([MEM, POL]);
    const { unmount } = render(<ProposalsSection kind="policy" heading="Policy proposals" />);

    const polCards = await screen.findAllByTestId('proposal-card');
    expect(polCards).toHaveLength(1);
    expect(polCards[0]).toHaveAttribute('data-proposal-id', 'p-pol');
    // The heading carries the visible count.
    expect(screen.getByTestId('proposals-section')).toHaveAttribute('data-kind', 'policy');
    expect(screen.getByText('Policy proposals').textContent).toContain('(1)');
    unmount();

    wire([MEM, POL]);
    render(<ProposalsSection kind="memory" heading="Memory proposals" />);
    const memCards = await screen.findAllByTestId('proposal-card');
    expect(memCards).toHaveLength(1);
    expect(memCards[0]).toHaveAttribute('data-proposal-id', 'p-mem');

    // The default review view asks the wire for pending only.
    expect(apiFetch).toHaveBeenCalledWith('/proposals?state=pending');
  });

  it('shows the empty state when nothing of this kind is pending', async () => {
    wire([POL]); // only a policy proposal exists
    render(<ProposalsSection kind="memory" heading="Memory proposals" />);
    expect(await screen.findByTestId('proposals-empty')).toHaveTextContent('No proposals to review.');
  });

  it('approve POSTs the approve wire, drops the row, notes it, and reloads', async () => {
    const { calls } = wire([MEM, POL]);
    render(<ProposalsSection kind="policy" heading="Policy proposals" />);
    const user = userEvent.setup();

    const card = await screen.findByTestId('proposal-card');
    await user.click(within(card).getByTestId('proposal-approve'));

    await waitFor(() => expect(calls).toContain('/proposals/p-pol/approve'));
    expect(await screen.findByTestId('proposals-section-note')).toHaveTextContent('Approved p-pol.');
    // Reloaded (GET twice — mount + after-decision).
    expect(calls.filter((c) => c === '/proposals?state=pending')).toHaveLength(2);
    await waitFor(() => expect(screen.queryByTestId('proposal-card')).toBeNull());
  });

  it('reject POSTs the reject wire and drops the row', async () => {
    const { calls } = wire([MEM]);
    render(<ProposalsSection kind="memory" heading="Memory proposals" />);
    const user = userEvent.setup();

    const card = await screen.findByTestId('proposal-card');
    await user.click(within(card).getByTestId('proposal-reject'));

    await waitFor(() => expect(calls).toContain('/proposals/p-mem/reject'));
    expect(await screen.findByTestId('proposals-section-note')).toHaveTextContent('Rejected p-mem.');
  });

  it('a failed decision keeps the row and notes the failure', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const s = String(path);
      if (s.endsWith('/approve')) return Promise.reject(new ApiError(409, 'already decided'));
      return Promise.resolve({ proposals: [MEM] });
    });
    render(<ProposalsSection kind="memory" heading="Memory proposals" />);
    const user = userEvent.setup();

    const card = await screen.findByTestId('proposal-card');
    await user.click(within(card).getByTestId('proposal-approve'));

    expect(await screen.findByTestId('proposals-section-note')).toHaveTextContent(/Could not approve p-mem/);
    expect(screen.getByTestId('proposal-card')).toBeInTheDocument();
  });

  it('renders the honest unsupported state on a daemon that predates the routes', async () => {
    apiFetch.mockRejectedValue(new ApiError(404, 'Not Found'));
    render(<ProposalsSection kind="policy" heading="Policy proposals" />);
    expect(await screen.findByTestId('proposals-section-unsupported')).toHaveTextContent(/predates the proposal queue/);
  });

  it('surfaces a real error as an error card', async () => {
    apiFetch.mockRejectedValue(new ApiError(500, 'boom'));
    render(<ProposalsSection kind="memory" heading="Memory proposals" />);
    expect(await screen.findByTestId('proposals-error')).toBeInTheDocument();
  });
});
