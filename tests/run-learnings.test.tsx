import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Run learnings in studio (crew `GET /runs/:id/learnings`, api-types 0.152.0):
 *  - a finished run's end card says what it proposed ("3 learnings proposed · 2 waiting for you · Review") and links
 *    to the Memory queue narrowed to that run; nothing on an older crew or when the run proposed nothing;
 *  - while its distil seat works the line says so and is read again;
 *  - the queue shows who proposed each learning (the engine's `run_agent`) and which run it came from, and narrows to
 *    one run's learnings with a way back to every proposal.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { RunLearningsLine } = await import('../src/components/session/RunLearningsLine.js');
const { runLearningsWords, runLearningsPath } = await import('../src/api/runLearnings.js');
const { ProposalsSection } = await import('../src/components/ProposalsSection.js');
const { ApiError } = await import('../src/api/errors.js');
type Proposal = import('../src/api/proposals.js').Proposal;

const learnings = (over: Record<string, unknown> = {}) => ({ runId: 'run-1', proposed: 3, pending: 2, approved: 1, rejected: 0, distilling: false, items: [], ...over });

beforeEach(() => {
  apiFetch.mockReset();
});

describe('the end card line', () => {
  it('words: counts, what waits, and nothing when there is nothing', () => {
    expect(runLearningsWords(learnings())).toBe('3 learnings proposed · 2 waiting for you');
    expect(runLearningsWords(learnings({ proposed: 1, pending: 0, approved: 1 }))).toBe('1 learning proposed · 1 kept');
    expect(runLearningsWords(learnings({ proposed: 2, pending: 0, approved: 0, rejected: 2 }))).toBe('2 learnings proposed · all decided');
    expect(runLearningsWords(learnings({ proposed: 0, pending: 0, approved: 0 }))).toBeNull();
    expect(runLearningsWords(learnings({ proposed: 0, pending: 0, approved: 0, distilling: true }))).toBe('Distilling what this run learned…');
    expect(runLearningsWords(null)).toBeNull();
    expect(runLearningsPath('a b')).toBe('/memory?view=proposals&run=a%20b');
  });

  it('renders with a Review link that navigates to the narrowed queue', async () => {
    apiFetch.mockResolvedValue(learnings());
    const navigate = vi.fn();
    render(<RunLearningsLine runId="run-1" navigate={navigate} />);
    const line = await screen.findByTestId('run-learnings-line');
    expect(line).toHaveTextContent('3 learnings proposed · 2 waiting for you · Review');
    expect(apiFetch).toHaveBeenCalledWith('/runs/run-1/learnings');
    await userEvent.click(screen.getByTestId('run-learnings-review'));
    expect(navigate).toHaveBeenCalledWith('/memory?view=proposals&run=run-1');
  });

  it('says nothing on an older crew (no route), on a failed read, or when nothing was proposed', async () => {
    apiFetch.mockRejectedValue(new ApiError(404, 'Route GET:/api/v1/runs/run-1/learnings not found'));
    const a = render(<RunLearningsLine runId="run-1" />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('run-learnings-line')).toBeNull();
    a.unmount();
    apiFetch.mockReset();
    apiFetch.mockResolvedValue(learnings({ proposed: 0, pending: 0, approved: 0 }));
    render(<RunLearningsLine runId="run-1" />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('run-learnings-line')).toBeNull();
  });

  it('while the distil seat works, says so and reads again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      apiFetch.mockResolvedValueOnce(learnings({ proposed: 0, pending: 0, approved: 0, distilling: true })).mockResolvedValue(learnings({ proposed: 2, pending: 2, approved: 0 }));
      render(<RunLearningsLine runId="run-1" />);
      expect(await screen.findByTestId('run-learnings-line')).toHaveAttribute('data-distilling', 'true');
      await vi.advanceTimersByTimeAsync(15_000);
      await waitFor(() => expect(screen.getByTestId('run-learnings-line')).toHaveTextContent('2 learnings proposed · 2 waiting for you'));
      expect(screen.getByTestId('run-learnings-line')).toHaveAttribute('data-distilling', 'false');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the Memory queue, from a run', () => {
  const p = (id: string, run: string, agent: string): Proposal => ({
    id, kind_type: 'memory', payload: { content: `Learning ${id} long enough to read`, tier: 'semantic' }, facets: { repo: 'wicked-core' },
    provenance: { run_id: run, run_agent: agent, run_unit: '0' }, state: 'pending', created_at: 1_700_000_000,
  });

  it('names who proposed it and links the source run', async () => {
    apiFetch.mockResolvedValue({ proposals: [p('a', 'run-1', 'codex'), p('b', 'run-2', 'crew')] });
    render(<ProposalsSection kind="memory" heading="Memory proposals" />);
    const cards = await screen.findAllByTestId('proposal-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector('[data-testid="proposal-provenance"]')).toHaveTextContent('Proposed by codex · Open its run');
    expect(cards[0]!.querySelector('[data-testid="proposal-source-run"]')).toHaveAttribute('href', '/s/run%3Arun-1');
    expect(cards[1]!.querySelector('[data-testid="proposal-provenance"]')).toHaveTextContent('Proposed by crew (from the run’s record)');
  });

  it('narrows to one run\'s learnings, with a way back to every proposal', async () => {
    apiFetch.mockResolvedValue({ proposals: [p('a', 'run-1', 'codex'), p('b', 'run-2', 'crew'), p('c', 'run-1', 'crew')] });
    const showAll = vi.fn();
    render(<ProposalsSection kind="memory" heading="Memory proposals" runId="run-1" onShowAll={showAll} />);
    const cards = await screen.findAllByTestId('proposal-card');
    expect(cards.map((c) => c.getAttribute('data-proposal-id'))).toEqual(['a', 'c']);
    expect(screen.getByTestId('proposals-section-run-filter')).toHaveTextContent('What one run learned.');
    await userEvent.click(screen.getByTestId('proposals-section-show-all'));
    expect(showAll).toHaveBeenCalled();
  });
});
