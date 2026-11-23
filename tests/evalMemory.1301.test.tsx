import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestingPage } from '../src/components/TestingPage.js';
import { ApiError } from '../src/api/errors.js';
import type { EvalReport, EvalResult } from '../src/api/testing.js';
import { useGateStore } from '../src/store/gates.js';
import { useEvalReportStore } from '../src/store/evalReport.js';
import { evalMemoryView, memoryVerdictWords } from '../src/board/evalMemory.js';

/**
 * studio#1301 (studio half of crew#1128): Evaluate shows the memory axis of a governance eval run.
 *
 * Fixture shapes are crew's wire as `POST /testing/evals/run` answers it (crew `api/testing.ts`: the engine report passed
 * through verbatim) and as the history keeps it (`evalStore.record`: summary, per_type, degraded, rule_coverage and the
 * results verbatim, no `memory` axis): `report.memory` is `GovernanceEvalMemoryAxis | null`, each `results[].memory` a
 * `GovernanceEvalMemoryResult | null` (crew-api-types index.d.ts, crew main e8e9d96).
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => Promise.resolve({ repos: [] }),
    listConformanceRules: () => Promise.resolve({ rules: [] }),
    launchRun: vi.fn(),
    confirmGate: vi.fn(),
    cancelRun: vi.fn(),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const RESULTS: EvalResult[] = [
  {
    sample: { id: 'M-1', description: 'a run that should recall the deploy freeze', kind: 'bad', steering_type: 'process' },
    expected: 'deny', fired: [], verdict: 'gap', nearest_rules: [],
    memory: { surfaced: ['mem-b'], missing: ['mem-freeze'], unexpected_surfaced: [], verdict: 'gap' },
  },
  {
    sample: { id: 'M-2', description: 'a refactor that must not see the old secrets note', kind: 'good', steering_type: 'security' },
    expected: 'allow', fired: [], verdict: 'caught',
    memory: { surfaced: ['mem-secrets'], missing: [], unexpected_surfaced: ['mem-secrets'], verdict: 'false_positive' },
  },
  {
    sample: { id: 'M-3', description: 'a doc change that recalls the style guide', kind: 'good', steering_type: 'development' },
    expected: 'allow', fired: [], verdict: 'caught',
    memory: { surfaced: ['mem-style'], missing: [], unexpected_surfaced: [], verdict: 'caught' },
  },
  {
    sample: { id: 'R-1', description: 'rm -rf in a build phase', kind: 'bad', steering_type: 'security' },
    expected: 'deny', fired: ['POL-1'], verdict: 'caught', memory: null,
  },
];

const HISTORY_RESULTS: EvalResult[] = [
  { ...RESULTS[2]!, sample: { ...RESULTS[2]!.sample, id: 'H-1' } },
  { ...RESULTS[2]!, sample: { ...RESULTS[2]!.sample, id: 'H-2', description: 'another doc change' } },
  RESULTS[3]!,
];

const AXIS = {
  summary: { total: 3, caught: 1, gaps: 1, false_positives: 1 },
  coverage: { memories: 5, surfaced: 3, unsurfaced: [{ memory_id: 'mem-old', scope: 'project:billing' }, { memory_id: 'mem-x', scope: 'repo:svc' }] },
};
const REPORT: EvalReport = { results: RESULTS, summary: { total: 4, caught: 3, gaps: 1, false_positives: 0 }, degraded: null, memory: AXIS };

function wire(handlers: Record<string, () => Promise<unknown>>): void {
  apiFetch.mockImplementation((path: unknown) => {
    const h = handlers[String(path)];
    return h !== undefined ? h() : Promise.reject(new ApiError(404, 'Not Found'));
  });
}
const page = (): ReturnType<typeof render> => render(<TestingPage page="evals" campaignId={null} runs={[]} navigate={() => {}} />);

beforeEach(() => {
  apiFetch.mockReset();
  useGateStore.setState({ gates: {}, approaching: {} });
  useEvalReportStore.setState({ latest: null, memory: null });
});

describe('Evaluate: the memory axis (studio#1301)', () => {
  it('a run made here shows the memory counts, the store coverage and the memories nothing surfaced', async () => {
    const user = userEvent.setup();
    wire({ '/testing/evals/run': () => Promise.resolve(REPORT) });
    page();
    await user.click(screen.getByTestId('testing-evals-run'));
    const section = await screen.findByTestId('evaluate-memory');
    expect(within(section).getByTestId('evaluate-memory-summary')).toHaveTextContent('3 behaviours name memories: 1 surfaced what it should, 1 missed one, 1 surfaced one it should not.');
    expect(within(section).getByTestId('evaluate-memory-coverage')).toHaveTextContent('3 of 5 stored memories surfaced for some behaviour');
    expect(within(section).getAllByTestId('evaluate-memory-unsurfaced-row').map((r) => r.textContent)).toEqual(['mem-old · project:billing', 'mem-x · repo:svc']);
  });

  it('each behaviour carries its memory verdict, with what was missing or surfaced when it should not have been', async () => {
    const user = userEvent.setup();
    wire({ '/testing/evals/run': () => Promise.resolve(REPORT) });
    page();
    await user.click(screen.getByTestId('testing-evals-run'));
    await user.click(await screen.findByTestId('evaluate-all-behaviours'));
    const lines = Object.fromEntries(screen.getAllByTestId('testing-evals-row').map((row) => [row.dataset.sampleId, within(row).queryByTestId('testing-evals-memory')?.textContent ?? null]));
    expect(lines).toEqual({
      'M-1': 'Memories: missed mem-freeze',
      'M-2': 'Memories: surfaced mem-secrets, which it should not',
      'M-3': 'Memories: every expected memory surfaced',
      'R-1': null,
    });
  });

  it('a run with no memory store says so (report.memory: null)', async () => {
    const user = userEvent.setup();
    const noStore: EvalReport = { results: RESULTS.map((r) => ({ ...r, memory: null })), summary: REPORT.summary, degraded: null, memory: null };
    wire({ '/testing/evals/run': () => Promise.resolve(noStore) });
    page();
    await user.click(screen.getByTestId('testing-evals-run'));
    expect(await screen.findByTestId('evaluate-memory-nostore')).toHaveTextContent('had no memory store, so no memory was checked');
    expect(screen.queryByTestId('evaluate-memory-coverage')).toBeNull();
  });

  it('an older crew (no memory key anywhere) shows no memory section', async () => {
    const user = userEvent.setup();
    const older: EvalReport = { results: RESULTS.map((r) => { const o: EvalResult = { ...r }; delete o.memory; return o; }), summary: REPORT.summary, degraded: null };
    wire({ '/testing/evals/run': () => Promise.resolve(older) });
    page();
    await user.click(screen.getByTestId('testing-evals-run'));
    await screen.findByTestId('testing-evals-summary');
    expect(screen.queryByTestId('evaluate-memory')).toBeNull();
  });

  it('read back from the history (which keeps no axis), the counts still come from the results; the coverage stays the run made here', async () => {
    const user = userEvent.setup();
    let listed = false;
    const row = { id: 'e1', created_at: 1_700_000_000, actor: 'local', corpus: null, type_filter: null, rule_store: '/s/rules.db', summary: REPORT.summary, per_type: {}, degraded: null };
    wire({
      '/testing/evals/run': () => { listed = true; return Promise.resolve(REPORT); },
      '/testing/evals': () => Promise.resolve({ runs: listed ? [row] : [] }),
      // A distinct history row: two memory samples, both caught (the run's own answer had three: 1/1/1).
      '/testing/evals/e1': () => Promise.resolve({ ...row, results: HISTORY_RESULTS }),
    });
    page();
    await user.click(screen.getByTestId('testing-evals-run'));
    // The history read that follows the run supersedes the run's own answer (useLatestEval).
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/testing/evals/e1'));
    await waitFor(() => expect(useEvalReportStore.getState().latest).toBeNull());
    const section = await screen.findByTestId('evaluate-memory');
    expect(within(section).getByTestId('evaluate-memory-summary')).toHaveTextContent('2 behaviours name memories: 2 surfaced what they should, 0 missed one, 0 surfaced one they should not.');
    expect(within(section).getByTestId('evaluate-memory-coverage')).toHaveTextContent('3 of 5 stored memories surfaced for some behaviour (the run you made here');
  });

  it('a no-store run made here never hides a later history run\'s memory counts (codex r1 on #1349)', async () => {
    const user = userEvent.setup();
    let listed = false;
    const row = { id: 'e2', created_at: 1_700_000_000, actor: 'other', corpus: null, type_filter: null, rule_store: '/s/rules.db', summary: REPORT.summary, per_type: {}, degraded: null };
    wire({
      '/testing/evals/run': () => { listed = true; return Promise.resolve({ results: RESULTS.map((r) => ({ ...r, memory: null })), summary: REPORT.summary, degraded: null, memory: null }); },
      '/testing/evals': () => Promise.resolve({ runs: listed ? [row] : [] }),
      '/testing/evals/e2': () => Promise.resolve({ ...row, results: HISTORY_RESULTS }),
    });
    page();
    await user.click(screen.getByTestId('testing-evals-run'));
    await waitFor(() => expect(useEvalReportStore.getState().latest).toBeNull());
    const section = await screen.findByTestId('evaluate-memory');
    await waitFor(() => expect(within(section).getByTestId('evaluate-memory-summary')).toHaveTextContent('2 behaviours name memories'));
    expect(within(section).getByTestId('evaluate-memory-nostore')).toHaveTextContent('The run you made here');
  });
});

describe('evalMemoryView (pure)', () => {
  it('nothing to say: no verdicts and no run made here', () => {
    expect(evalMemoryView(RESULTS.map((r) => ({ ...r, memory: null })), null)).toBeNull();
  });
  it('a false positive that also missed one names both', () => {
    expect(memoryVerdictWords({ surfaced: ['a'], missing: ['b'], unexpected_surfaced: ['a'], verdict: 'false_positive' })).toBe('Memories: surfaced a, which it should not; also missed b');
  });
});
