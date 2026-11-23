/**
 * crew#1165: "Close N runs nobody finished" does what it says. Accept on a resolve-stale recommendation answers
 * `{ kind: 'runs', runIds }` (crew `ReviewService.targetOf`, packages/crew/src/insights/review-service.ts:412), and the
 * decide panel lists those runs: Archive all with a note (`POST /runs/:id/resolve`, one call per run, each failure named
 * beside its run) and a per-run Retry (the run's own launch, prefilled).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { InsightsRecommendation } from '../src/api/insights.js';
import type { SessionView } from '../src/api/types.js';
import recorded from './fixtures/watch-real-runs-7701.json';

const accept = vi.fn();
vi.mock('../src/api/insights.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/insights.js')>()),
  insightsApi: { accept: (id: string) => accept(id), dismiss: vi.fn() },
}));
const resolveRun = vi.fn();
const getRun = vi.fn();
vi.mock('../src/api/client.js', async (orig) => {
  const real = await orig<typeof import('../src/api/client.js')>();
  return { ...real, api: { ...real.api, resolveRun: (id: string, b: unknown) => resolveRun(id, b), getRun: (id: string) => getRun(id) } };
});
const setRetryPrefill = vi.fn();
vi.mock('../src/store/retryPrefill.js', async (orig) => ({
  ...(await orig<typeof import('../src/store/retryPrefill.js')>()),
  setRetryPrefill: (p: unknown) => setRetryPrefill(p),
}));

const { InsightsDecide } = await import('../src/components/insights/InsightsDecide.js');
const { sessionPath } = await import('../src/board/sessionModel.js');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const A = 'aaaa1111-0000-4000-8000-000000000001';
const B = 'bbbb2222-0000-4000-8000-000000000002';
const C = 'cccc3333-0000-4000-8000-000000000003';

/** The resolve-stale candidate as crew's analyze writes it (packages/crew/src/insights/analyze.ts:288-299), merged into
 *  a recommendation by `mergeReport` (review-service.ts). */
function staleRec(): InsightsRecommendation {
  return {
    id: 'rev-1:resolve-stale', candidate: 'resolve-stale', kind: 'resolve-stale', title: 'Resolve 3 runs nobody closed',
    evidence: { line: '3 runs failed or sat open over a day and were neither retried nor archived.', runs: [{ id: A, title: 'Fix the export button' }, { id: B, title: 'Add the CSV import' }], n: 3 },
    expectedEffect: 'The run list shows only live work, and the work these runs held is either finished or written off.',
    confidence: 'medium', changeMind: 'If these runs are deliberately parked (waiting on an outside answer), archive them with a note instead.',
    impact: 9, basis: 'pattern', action: { runs: [A, B, C] }, state: 'new', reason: null, decidedAt: null, proposalId: null, proposalError: null,
  };
}

function renderDecide(navigate = vi.fn()) {
  const rec = staleRec();
  render(<InsightsDecide selected={rec} metrics={[]} navigate={navigate} onDecided={async () => undefined} />);
  return { rec, navigate };
}

describe('Accept on "Close N runs nobody finished" (crew#1165)', () => {
  it('lists the runs it names, titled from the evidence, instead of only telling the person to open each', async () => {
    accept.mockResolvedValue({ recommendation: { ...staleRec(), state: 'accepted' }, open: { kind: 'runs', runIds: [A, B, C] } });
    const { navigate } = renderDecide();
    fireEvent.click(screen.getByTestId('insights-accept'));
    const panel = await screen.findByTestId('insights-resolve');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('insights-decided').textContent).toBe('Accepted. Archive these 3 runs with a note, or retry one.');
    const rows = within(panel).getAllByTestId('insights-resolve-run');
    expect(rows.map((r) => r.querySelector('a')?.textContent)).toEqual(['Fix the export button', 'Add the CSV import', C]);
    expect(within(panel).getAllByTestId('insights-resolve-retry')).toHaveLength(3);
    expect(screen.queryByText(/Open each run below/u)).toBeNull();
  });

  it('Archive all with a note resolves each run in turn with that note; a run crew refuses is named with its reason', async () => {
    accept.mockResolvedValue({ recommendation: { ...staleRec(), state: 'accepted' }, open: { kind: 'runs', runIds: [A, B, C] } });
    // crew `POST /runs/:id/resolve` (routes.ts:4773): the archived answer; a running job is refused (409).
    resolveRun.mockImplementation(async (id: string) => {
      if (id === B) throw new Error(`run ${B} is executing: a running job cannot be resolved; stop it first`);
      return { runId: id, action: 'archive', archived: true, cancelled: false, note: 'resolved: superseded by the v2 import' };
    });
    renderDecide();
    fireEvent.click(screen.getByTestId('insights-accept'));
    fireEvent.click(await screen.findByTestId('insights-resolve-archive'));
    const confirm = screen.getByTestId('insights-resolve-archive-confirm');
    expect((confirm as HTMLButtonElement).disabled).toBe(true); // a note is required
    expect(confirm.textContent).toBe('Archive all 3');
    fireEvent.change(screen.getByTestId('insights-resolve-note'), { target: { value: ' superseded by the v2 import ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId('insights-resolve-said').textContent).toBe('Archived 2 of 3; 1 could not be archived (said beside each).'));
    expect(resolveRun.mock.calls).toEqual([A, B, C].map((id) => [id, { action: 'archive', reason: 'superseded by the v2 import' }]));
    const row = (id: string) => screen.getAllByTestId('insights-resolve-run').find((r) => r.getAttribute('data-run') === id)!;
    expect(row(A).getAttribute('data-outcome')).toBe('archived');
    expect(row(C).getAttribute('data-outcome')).toBe('archived');
    expect(row(B).getAttribute('data-outcome')).toBe('failed');
    expect(within(row(B)).getByRole('alert').textContent).toBe(`Not archived: run ${B} is executing: a running job cannot be resolved; stop it first`);

    // Again: only the run still open is sent, and once it goes through, all are archived.
    resolveRun.mockClear();
    resolveRun.mockResolvedValue({ runId: B, action: 'archive', archived: true, cancelled: true, note: 'resolved: stopped' });
    fireEvent.click(screen.getByTestId('insights-resolve-archive'));
    expect(screen.getByTestId('insights-resolve-archive-confirm').textContent).toBe('Archive it');
    fireEvent.change(screen.getByTestId('insights-resolve-note'), { target: { value: 'stopped' } });
    fireEvent.click(screen.getByTestId('insights-resolve-archive-confirm'));
    await waitFor(() => expect(screen.getByTestId('insights-resolve-said').textContent).toBe('Archived all 3 runs.'));
    expect(resolveRun.mock.calls).toEqual([[B, { action: 'archive', reason: 'stopped' }]]);
    expect(screen.queryByTestId('insights-resolve-archive')).toBeNull();
  });

  it("Retry prefills that run's own launch, as the home page's tidy-up row does; an unreadable run opens its page", async () => {
    accept.mockResolvedValue({ recommendation: { ...staleRec(), state: 'accepted' }, open: { kind: 'runs', runIds: [A, B, C] } });
    const view = (recorded as unknown as { runs: SessionView[] }).runs[0]!;
    getRun.mockImplementation(async (id: string) => {
      if (id === A) return { run: view };
      throw new Error('not found');
    });
    const { navigate } = renderDecide();
    fireEvent.click(screen.getByTestId('insights-accept'));
    const retries = await screen.findAllByTestId('insights-resolve-retry');
    fireEvent.click(retries[0]!);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/runs/new'));
    expect(setRetryPrefill).toHaveBeenCalledWith(expect.objectContaining({ retryOf: view.session.id, workflowId: view.session.workflow_id || null }));
    fireEvent.click(retries[1]!);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(sessionPath(`run:${B}`)));
  });

  it('one run reads in the singular, and a recommendation picked afterwards starts clean', async () => {
    accept.mockResolvedValue({ recommendation: { ...staleRec(), state: 'accepted' }, open: { kind: 'runs', runIds: [A] } });
    const navigate = vi.fn();
    const { rerender } = render(<InsightsDecide selected={staleRec()} metrics={[]} navigate={navigate} onDecided={async () => undefined} />);
    fireEvent.click(screen.getByTestId('insights-accept'));
    await screen.findByTestId('insights-resolve');
    expect(screen.getByTestId('insights-decided').textContent).toBe('Accepted. Archive this run with a note, or retry one.');
    expect(screen.getByTestId('insights-resolve-archive').textContent).toBe('Archive it with a note…');
    rerender(<InsightsDecide selected={{ ...staleRec(), id: 'rev-2:resolve-stale' }} metrics={[]} navigate={navigate} onDecided={async () => undefined} />);
    expect(screen.queryByTestId('insights-resolve')).toBeNull();
    expect(screen.getByTestId('insights-accept')).toBeTruthy();
  });
});
