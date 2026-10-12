import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { decisionsApi, type DecisionView } from '../src/api/decisions.js';
import { gateDecisionRows } from '../src/board/gateDecisionRows.js';
import { ApiError } from '../src/api/errors.js';
import { WatchtowerPage } from '../src/components/watch/WatchtowerPage.js';
import { useWatchStore } from '../src/store/watch.js';
import recordedRuns from './fixtures/watch-real-runs-7701.json';
import recordedDecisions from './fixtures/watch-real-decisions-7701.json';

/**
 * Operator ruling 2026-10-12: Approved and Rejected filters beside Decisions, from crew's decision
 * record (`GET /decisions`, host=gate) over the RECORDED wire. On :7701 every gate row names a crew
 * test run (crew#986) that `GET /runs` does not list: those never show. The same rows pointed at a
 * listed session do.
 */

const runs = recordedRuns.runs as unknown as SessionView[];
const real = recordedDecisions.decisions as unknown as DecisionView[];
const done = runs.filter((v) => v.session.status === 'completed');
const onRun = (d: DecisionView, runId: string, over: Partial<DecisionView['origin']> = {}): DecisionView =>
  ({ ...d, id: `${d.id}-${runId}-${over.choice ?? d.origin.choice}`, origin: { ...d.origin, run_id: runId, ...over } });
const NOW = 1_791_800_000_000;
const pick = (kind: string): void => {
  fireEvent.click(screen.getAllByTestId('watchtower-kind').find((b) => b.getAttribute('data-kind') === kind)!);
};

beforeEach(() => { useWatchStore.getState().reset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('gateDecisionRows over the recorded record', () => {
  it('the recorded rows name runs the session list lacks: none shows (crew#986)', () => {
    expect(real.length).toBeGreaterThan(0);
    expect(gateDecisionRows(real, runs)).toStrictEqual([]);
  });

  it('a listed session’s answers sort into Approved and Rejected, each saying which', () => {
    const approve = real.find((d) => d.origin.choice === 'approve' && d.origin.words === '')!;
    const note = real.find((d) => d.origin.choice === 'approve' && d.origin.words !== '')!;
    const reject = real.find((d) => d.origin.choice === 'reject')!;
    const rows = gateDecisionRows([
      onRun(approve, done[0]!.session.id, { ord: 0 }), onRun(note, done[0]!.session.id),
      onRun(reject, done[1]!.session.id), onRun(reject, done[1]!.session.id, { choice: 'request_changes' }),
    ], runs);
    expect(rows.filter((r) => r.answer === 'approved').map((r) => r.verb).sort()).toStrictEqual(['Approved', 'Approved with a note']);
    expect(rows.filter((r) => r.answer === 'rejected').map((r) => r.verb).sort()).toStrictEqual(['Rejected', 'Sent back']);
    expect(rows.find((r) => r.verb === 'Approved with a note')!.note).toBe(note.origin.words.trim());
    expect(rows.find((r) => r.verb === 'Approved')!.step).toBe('Step 1');
  });
});

describe('the Approved and Rejected filters', () => {
  it('sit beside Decisions; a row shows the work, the answer, when, the note, and opens the session', async () => {
    const note = real.find((d) => d.origin.choice === 'approve' && d.origin.words !== '')!;
    const reject = real.find((d) => d.origin.choice === 'reject')!;
    vi.spyOn(decisionsApi, 'list').mockResolvedValue({ mode: 'ledger', decisions: [...real, onRun(note, done[0]!.session.id), onRun(reject, done[1]!.session.id, { choice: 'request_changes' })] } as never);
    const navigate = vi.fn();
    render(<WatchtowerPage count={0} runs={runs} navigate={navigate} now={NOW} />);
    const labels = screen.getAllByTestId('watchtower-kind').map((b) => b.textContent);
    expect(labels.slice(0, 5)).toStrictEqual(['Everything', 'Problems', 'Decisions', 'Approved', 'Rejected']);
    pick('approved');
    await waitFor(() => expect(screen.getAllByTestId('watchtower-row').length).toBe(1));
    const row = screen.getByTestId('watchtower-row');
    expect(within(row).getByTestId('watchtower-row-verb').textContent).toBe('Approved with a note');
    expect(within(row).getByTestId('watchtower-row-note').textContent).toBe(`“${note.origin.words.trim()}”`);
    expect(within(row).getByTestId('watchtower-row-work').textContent).not.toBe('A session');
    fireEvent.click(within(row).getByTestId('watchtower-open'));
    expect(navigate).toHaveBeenCalledWith(`/s/run%3A${done[0]!.session.id}`);
    pick('rejected');
    expect(within(screen.getByTestId('watchtower-row')).getByTestId('watchtower-row-verb').textContent).toBe('Sent back');
  });

  it('with only the recorded (test-run) rows, the filters are empty and say why', async () => {
    vi.spyOn(decisionsApi, 'list').mockResolvedValue({ mode: 'ledger', decisions: real } as never);
    render(<WatchtowerPage count={0} runs={runs} navigate={() => {}} now={NOW} />);
    pick('approved');
    await waitFor(() => expect(screen.getByTestId('watchtower-empty').textContent).toContain('You have not approved anything at a gate yet.'));
    expect(screen.getByTestId('watchtower-show-all')).toBeTruthy();
    pick('rejected');
    expect(screen.getByTestId('watchtower-empty').textContent).toContain('You have not rejected or sent back anything at a gate yet.');
  });

  it('a service without the record says so, never "you have not approved" (codex r1)', async () => {
    vi.spyOn(decisionsApi, 'list').mockRejectedValue(new ApiError(404, 'Not Found'));
    render(<WatchtowerPage count={0} runs={runs} navigate={() => {}} now={NOW} />);
    pick('approved');
    await waitFor(() => expect(screen.getByTestId('watchtower-empty')).toBeTruthy());
    expect(screen.getByTestId('watchtower-empty').textContent).not.toContain('You have not approved');
  });

  it('a failed read of the record is a banner, never an empty list', async () => {
    vi.spyOn(decisionsApi, 'list').mockRejectedValue(new Error('500 boom'));
    render(<WatchtowerPage count={0} runs={runs} navigate={() => {}} now={NOW} />);
    pick('approved');
    await waitFor(() => expect(screen.getByTestId('watchtower-ledger-failed')).toBeTruthy());
    expect(screen.queryByTestId('watchtower-empty')).toBeNull();
  });
});
