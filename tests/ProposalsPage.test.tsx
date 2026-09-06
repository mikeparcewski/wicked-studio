import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The proposal-queue surface (DES-MEM-FACETED-001), the read/decide twin of SteeringPage:
 *  - lists the PENDING proposals (`GET /proposals?state=pending`), rendering memory content+tier
 *    and policy rule+severity, plus each proposal's facets and provenance;
 *  - the first-class type filter (all | memory | policy) narrows the loaded rows client-side and
 *    deep-links via `?type=` (a chip click navigates, the page reads `search`);
 *  - Approve / Reject ride `POST /proposals/:id/{approve,reject}`; on success the row leaves the
 *    queue and the list reloads for the server's state;
 *  - loading / error / empty / forward-compat-unsupported all render honestly in-band.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { ProposalsPage } = await import('../src/components/ProposalsPage.js');
const { ApiError } = await import('../src/api/errors.js');
type Proposal = import('../src/api/proposals.js').Proposal;

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p-mem',
    kind_type: 'memory',
    payload: { content: 'Remember the gh account flip', tier: 'session' },
    facets: { project: 'wicked', domain: 'ops' },
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
  provenance: { run_id: 'run-2', agent: 'codex' },
});

/** A stateful wire: GET returns the current pending set; approve/reject remove from it. */
function wire(initial: Proposal[]): { calls: string[] } {
  let pending = [...initial];
  const calls: string[] = [];
  apiFetch.mockImplementation((path: unknown) => {
    const s = String(path);
    calls.push(s);
    const parts = s.split('/'); // ['', 'proposals', '<id>', 'approve']
    if (s.endsWith('/approve')) {
      pending = pending.filter((p) => p.id !== parts[2]);
      return Promise.resolve({ ok: true, id: parts[2] });
    }
    if (s.endsWith('/reject')) {
      pending = pending.filter((p) => p.id !== parts[2]);
      return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ proposals: pending });
  });
  return { calls };
}

function page(search = ''): { navigate: ReturnType<typeof vi.fn> } {
  const navigate = vi.fn();
  render(<ProposalsPage navigate={navigate} search={search} />);
  return { navigate };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('ProposalsPage — the pending queue', () => {
  it('lists pending proposals with payload, facets, and provenance', async () => {
    wire([MEM, POL]);
    page();

    const cards = await screen.findAllByTestId('proposal-card');
    expect(cards).toHaveLength(2);

    const mem = cards.find((c) => c.getAttribute('data-proposal-id') === 'p-mem')!;
    expect(mem).toHaveAttribute('data-proposal-id', 'p-mem');
    expect(within(mem).getByTestId('proposal-memory-content')).toHaveTextContent('Remember the gh account flip');
    expect(within(mem).getByTestId('proposal-memory-tier')).toHaveTextContent('session');
    expect(within(mem).getByTestId('proposal-facets-chips')).toHaveTextContent('project:');
    expect(within(mem).getByTestId('proposal-provenance-chips')).toHaveTextContent('run-1');

    // The policy card renders the rule + severity chip and its steering-type target.
    const pol = cards.find((c) => c.getAttribute('data-proposal-id') === 'p-pol')!;
    expect(within(pol).getByTestId('proposal-policy-rule')).toHaveTextContent('Never log secrets');
    expect(within(pol).getByTestId('proposal-policy-severity')).toHaveTextContent('critical');
    expect(within(pol).getByTestId('proposal-policy-target')).toHaveTextContent('security');

    // The default view asks the wire for pending only.
    expect(apiFetch).toHaveBeenCalledWith('/proposals?state=pending');
  });

  it('shows the empty state when nothing is pending', async () => {
    wire([]);
    page();
    expect(await screen.findByTestId('proposals-empty')).toHaveTextContent('No proposals to review.');
  });

  it('surfaces a real error as an error card', async () => {
    apiFetch.mockRejectedValue(new ApiError(500, 'boom'));
    page();
    expect(await screen.findByTestId('proposals-error')).toBeInTheDocument();
    expect(screen.queryByTestId('proposals-list')).toBeNull();
  });

  it('renders the honest unsupported state on a daemon that predates the routes', async () => {
    apiFetch.mockRejectedValue(new ApiError(404, 'Not Found'));
    page();
    expect(await screen.findByTestId('proposals-unsupported')).toHaveTextContent(/predates the proposal queue/);
  });
});

describe('ProposalsPage — the type filter', () => {
  it('narrows to memory when ?type=memory, and the chip counts reflect the full set', async () => {
    wire([MEM, POL]);
    page('?type=memory');

    await screen.findByTestId('proposals-list');
    const cards = screen.getAllByTestId('proposal-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute('data-proposal-id', 'p-mem');

    // Counts are computed over the full loaded set (all=2, memory=1, policy=1).
    const chipText = (kind: string): string =>
      screen.getByTestId('proposals-filter').querySelector(`[data-kind="${kind}"]`)?.textContent ?? '';
    expect(chipText('all')).toContain('(2)');
    expect(chipText('memory')).toContain('(1)');
    expect(chipText('policy')).toContain('(1)');
  });

  it('a filter chip click navigates to the deep-linked queue', async () => {
    wire([MEM, POL]);
    const { navigate } = page();
    const user = userEvent.setup();

    await screen.findByTestId('proposals-list');
    await user.click(screen.getByTestId('proposals-filter').querySelector('[data-kind="policy"]') as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/proposals?type=policy');
  });
});

describe('ProposalsPage — approve / reject', () => {
  it('approve POSTs the approve wire, drops the row, notes it, and reloads', async () => {
    const { calls } = wire([MEM, POL]);
    page();
    const user = userEvent.setup();

    const mem = (await screen.findAllByTestId('proposal-card')).find(
      (c) => c.getAttribute('data-proposal-id') === 'p-mem',
    )!;
    await user.click(within(mem).getByTestId('proposal-approve'));

    await waitFor(() => expect(calls).toContain('/proposals/p-mem/approve'));
    // A note confirms it; the queue reloaded (GET called twice — mount + after-decision).
    expect(await screen.findByTestId('proposals-note')).toHaveTextContent('Approved p-mem.');
    expect(calls.filter((c) => c === '/proposals?state=pending')).toHaveLength(2);
    // The approved row is gone; p-pol remains in the queue.
    await waitFor(() => {
      const remaining = screen.getAllByTestId('proposal-card');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toHaveAttribute('data-proposal-id', 'p-pol');
    });
  });

  it('reject POSTs the reject wire and drops the row', async () => {
    const { calls } = wire([MEM, POL]);
    page();
    const user = userEvent.setup();

    const pol = (await screen.findAllByTestId('proposal-card')).find(
      (c) => c.getAttribute('data-proposal-id') === 'p-pol',
    )!;
    await user.click(within(pol).getByTestId('proposal-reject'));

    await waitFor(() => expect(calls).toContain('/proposals/p-pol/reject'));
    expect(await screen.findByTestId('proposals-note')).toHaveTextContent('Rejected p-pol.');
    await waitFor(() => {
      const remaining = screen.getAllByTestId('proposal-card');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toHaveAttribute('data-proposal-id', 'p-mem');
    });
  });

  it('a failed decision keeps the row and notes the failure', async () => {
    apiFetch.mockImplementation((path: unknown) => {
      const s = String(path);
      if (s.endsWith('/approve')) return Promise.reject(new ApiError(409, 'already decided'));
      return Promise.resolve({ proposals: [MEM] });
    });
    page();
    const user = userEvent.setup();

    const card = await screen.findByTestId('proposal-card');
    await user.click(within(card).getByTestId('proposal-approve'));

    expect(await screen.findByTestId('proposals-note')).toHaveTextContent(/Could not approve p-mem/);
    // The row stays — the decision did not take.
    expect(screen.getByTestId('proposal-card')).toBeInTheDocument();
  });
});
