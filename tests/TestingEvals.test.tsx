import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestingPage } from '../src/components/TestingPage.js';
import { ApiError } from '../src/api/errors.js';
import type { EvalReport } from '../src/api/testing.js';
import { useGateStore } from '../src/store/gates.js';

/**
 * The Evals sub-page over the PINNED testing wire (`POST /testing/evals/run`,
 * `POST /testing/corpora/import` — see src/api/testing.ts):
 *  - the run POSTs exactly {type?, corpus?} (omitted = all types / the built-in corpus) and
 *    renders the report's summary + results table verbatim from the serde output;
 *  - GAP rows expand to their nearest_rules with similarity values (an empty array renders the
 *    honest "nothing nearby" words — never a blank);
 *  - `degraded: "facet-only"` renders a VISIBLE no-embedder notice;
 *  - 501 / route-absent renders the honest engine-gap callout naming core-ts 0.7.5;
 *  - an empty corpus is an empty state in words — never a spinner that cannot settle;
 *  - corpus upload parses the picked JSON and POSTs {name, samples}, then pre-fills the corpus
 *    field with the returned scope.
 */

const apiFetch = vi.fn();
const listRepos = vi.fn(() => Promise.resolve({ repos: [] }));

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    launchRun: vi.fn(),
    confirmGate: vi.fn(),
    cancelRun: vi.fn(),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

/** Route the mocked wire: known paths answer, everything else is route-absent. */
function wire(handlers: Record<string, (body: unknown) => Promise<unknown>> = {}): void {
  apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
    const h = handlers[String(path)];
    if (h !== undefined) return h(init?.body === undefined ? undefined : JSON.parse(init.body));
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
}

function page(): ReturnType<typeof render> {
  return render(<TestingPage page="evals" campaignId={null} runs={[]} navigate={() => {}} />);
}

/** The fixture report — the serde output shape, verbatim snake_case. */
const REPORT: EvalReport = {
  results: [
    {
      sample: { id: 'S-1', description: 'rm -rf ridden into a build phase', kind: 'bad', steering_type: 'security' },
      expected: 'deny',
      fired: ['POL-101'],
      verdict: 'caught',
    },
    {
      sample: { id: 'S-2', description: 'secret echoed into the run log', kind: 'bad', steering_type: 'security' },
      expected: 'deny',
      fired: [],
      verdict: 'gap',
      nearest_rules: [
        { rule_id: 'POL-104', similarity: 0.82 },
        { rule_id: 'PAT-201', similarity: 0.61 },
      ],
    },
    {
      sample: { id: 'S-3', description: 'a plain rename refactor', kind: 'good', steering_type: 'development' },
      expected: 'allow',
      fired: ['PAT-300'],
      verdict: 'false_positive',
    },
  ],
  summary: { total: 3, caught: 1, gaps: 1, false_positives: 1 },
  degraded: null,
};

beforeEach(() => {
  apiFetch.mockReset();
  listRepos.mockClear();
  useGateStore.setState({ gates: {}, approaching: {} });
});

describe('Evals — the run', () => {
  it('POSTs {type, corpus} exactly as pinned and renders summary + table from the report', async () => {
    const user = userEvent.setup();
    let runBody: unknown = null;
    wire({
      '/testing/evals/run': (body) => {
        runBody = body;
        return Promise.resolve(REPORT);
      },
    });
    page();

    await user.selectOptions(screen.getByTestId('testing-evals-type'), 'security');
    await user.type(screen.getByTestId('testing-evals-corpus'), 'evals:dev-behaviors');
    await user.click(screen.getByTestId('testing-evals-run'));

    expect(await screen.findByTestId('testing-evals-summary')).toHaveTextContent('3 samples');
    expect(runBody).toEqual({ type: 'security', corpus: 'evals:dev-behaviors' });

    // The qe finding: "caught" split into its two honest halves (S-1 is a bad
    // sample the rules BLOCKED; no good sample was caught here), and the gap
    // count framed as uncovered behaviors — work to do, not red failure.
    const summary = screen.getByTestId('testing-evals-summary');
    expect(summary).toHaveTextContent('1 blocked');
    expect(summary).toHaveTextContent('0 passed');
    expect(summary).toHaveTextContent('1 uncovered behavior');
    expect(summary).toHaveTextContent('1 false positives');

    // The report header names its corpus (provenance, qe finding).
    expect(screen.getByTestId('testing-evals-provenance')).toHaveTextContent(
      'corpus: evals:dev-behaviors · 3 samples',
    );

    const rows = screen.getAllByTestId('testing-evals-row');
    expect(rows.map((r) => r.getAttribute('data-verdict'))).toEqual(['caught', 'gap', 'false_positive']);
    // The verdict WORD distinguishes a blocked bad sample from a passed good one.
    expect(rows[0]).toHaveTextContent('blocked');
    expect(rows[0]).toHaveTextContent('POL-101');
    // A sample that fired nothing says so — never a blank cell.
    expect(rows[1]).toHaveTextContent('—');
    // No degraded notice on a full-recall run.
    expect(screen.queryByTestId('testing-evals-degraded')).toBeNull();
  });

  it('omits type and corpus from the body when neither is chosen (all types, built-in corpus)', async () => {
    const user = userEvent.setup();
    let runBody: unknown = null;
    wire({
      '/testing/evals/run': (body) => {
        runBody = body;
        return Promise.resolve(REPORT);
      },
    });
    page();

    await user.click(screen.getByTestId('testing-evals-run'));
    await screen.findByTestId('testing-evals-summary');
    expect(runBody).toEqual({});
  });

  it('GAP rows expand to nearest_rules with similarity values; the other verdicts carry no toggle', async () => {
    const user = userEvent.setup();
    wire({ '/testing/evals/run': () => Promise.resolve(REPORT) });
    page();

    await user.click(screen.getByTestId('testing-evals-run'));
    await screen.findByTestId('testing-evals-table');

    // Exactly one toggle — the one gap row's.
    const toggles = screen.getAllByTestId('testing-evals-gap-toggle');
    expect(toggles).toHaveLength(1);
    expect(screen.queryByTestId('testing-evals-nearest')).toBeNull();

    await user.click(toggles[0]!);
    const nearest = await screen.findByTestId('testing-evals-nearest');
    const ruleRows = within(nearest).getAllByTestId('testing-evals-nearest-rule');
    expect(ruleRows).toHaveLength(2);
    expect(ruleRows[0]).toHaveTextContent('POL-104');
    expect(ruleRows[0]).toHaveTextContent('similarity 0.82');
    expect(ruleRows[1]).toHaveTextContent('PAT-201');
    expect(ruleRows[1]).toHaveTextContent('similarity 0.61');

    // Toggling again collapses.
    await user.click(screen.getByTestId('testing-evals-gap-toggle'));
    expect(screen.queryByTestId('testing-evals-nearest')).toBeNull();
  });

  it('a nearest-rule hint is a LINK into Steering that deep-links the rule drawer (qe finding)', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    wire({ '/testing/evals/run': () => Promise.resolve(REPORT) });
    render(<TestingPage page="evals" campaignId={null} runs={[]} navigate={navigate} />);

    await user.click(screen.getByTestId('testing-evals-run'));
    await screen.findByTestId('testing-evals-table');
    await user.click(screen.getByTestId('testing-evals-gap-toggle'));

    const links = await screen.findAllByTestId('testing-evals-nearest-link');
    expect(links[0]).toHaveAttribute('href', '/steering/security?rule=POL-104');
    await user.click(links[0]!);
    // The sample's type page, with ?rule opening that rule's drawer.
    expect(navigate).toHaveBeenCalledWith('/steering/security?rule=POL-104');
  });

  it('a gap whose nearest_rules is EMPTY says "nothing nearby" in words — never a blank panel', async () => {
    const user = userEvent.setup();
    const report: EvalReport = {
      results: [{ ...REPORT.results[1]!, nearest_rules: [] }],
      summary: { total: 1, caught: 0, gaps: 1, false_positives: 0 },
      degraded: null,
    };
    wire({ '/testing/evals/run': () => Promise.resolve(report) });
    page();

    await user.click(screen.getByTestId('testing-evals-run'));
    await user.click(await screen.findByTestId('testing-evals-gap-toggle'));
    expect(await screen.findByTestId('testing-evals-nearest-empty')).toHaveTextContent(/No nearby rules recalled/);
  });

  it('degraded: "facet-only" renders the VISIBLE no-embedder notice beside the real numbers', async () => {
    const user = userEvent.setup();
    wire({ '/testing/evals/run': () => Promise.resolve({ ...REPORT, degraded: 'facet-only' }) });
    page();

    await user.click(screen.getByTestId('testing-evals-run'));
    expect(await screen.findByTestId('testing-evals-degraded')).toHaveTextContent(/no embedder/);
    // The report still renders — degraded is a caveat, not a refusal.
    expect(screen.getByTestId('testing-evals-summary')).toHaveTextContent('3 samples');
  });

  it('501 renders the honest engine-gap callout naming core-ts 0.7.5 — never a raw refusal', async () => {
    const user = userEvent.setup();
    wire({ '/testing/evals/run': () => Promise.reject(new ApiError(501, 'governanceEvals is not a function')) });
    page();

    await user.click(screen.getByTestId('testing-evals-run'));
    expect(await screen.findByTestId('testing-evals-unsupported')).toHaveTextContent(/requires core-ts 0\.7\.5/);
    expect(screen.queryByTestId('testing-evals-error')).toBeNull();
  });

  it('a route-absent daemon (bare 404) folds into the same honest callout', async () => {
    const user = userEvent.setup();
    wire(); // no testing routes at all
    page();

    await user.click(screen.getByTestId('testing-evals-run'));
    expect(await screen.findByTestId('testing-evals-unsupported')).toHaveTextContent(/requires core-ts 0\.7\.5/);
  });

  it('an empty corpus is an empty state in words — the run settles, no spinner survives', async () => {
    const user = userEvent.setup();
    wire({
      '/testing/evals/run': () =>
        Promise.resolve({ results: [], summary: { total: 0, caught: 0, gaps: 0, false_positives: 0 }, degraded: null }),
    });
    page();

    await user.click(screen.getByTestId('testing-evals-run'));
    expect(await screen.findByTestId('testing-evals-empty')).toHaveTextContent(/served no samples/);
    expect(screen.queryByTestId('testing-evals-busy')).toBeNull();
    expect(screen.queryByTestId('testing-evals-table')).toBeNull();
  });

  it('a named 4xx surfaces as the translated error, not the unsupported callout', async () => {
    const user = userEvent.setup();
    wire({
      '/testing/evals/run': () => Promise.reject(new ApiError(400, 'Invalid request body: unknown field `corpsu`')),
    });
    page();

    await user.click(screen.getByTestId('testing-evals-run'));
    expect(await screen.findByTestId('testing-evals-error')).toHaveTextContent(/corpsu/);
    expect(screen.queryByTestId('testing-evals-unsupported')).toBeNull();
  });
});

describe('Evals — corpus import', () => {
  const SAMPLES = [
    {
      id: 'S-1',
      description: 'rm -rf ridden into a build phase',
      kind: 'bad',
      steering_type: 'security',
      signals: { phase: 'build', tool: 'bash', content: 'rm -rf /' },
    },
  ];

  it('POSTs {name, samples} from the picked JSON array and pre-fills the corpus field with the scope', async () => {
    const user = userEvent.setup();
    let importBody: unknown = null;
    wire({
      '/testing/corpora/import': (body) => {
        importBody = body;
        return Promise.resolve({ imported: 1, scope: 'evals:dev-behaviors', embedded: true });
      },
    });
    page();

    await user.type(screen.getByTestId('testing-corpus-name'), 'dev-behaviors');
    await user.upload(
      screen.getByTestId('testing-corpus-file'),
      new File([JSON.stringify(SAMPLES)], 'dev-behaviors.json', { type: 'application/json' }),
    );

    expect(await screen.findByTestId('testing-corpus-summary')).toHaveTextContent(
      'dev-behaviors.json: imported 1 sample into evals:dev-behaviors (embedded)',
    );
    expect(importBody).toEqual({ name: 'dev-behaviors', samples: SAMPLES });
    // The next run targets what just landed.
    expect(screen.getByTestId('testing-evals-corpus')).toHaveValue('evals:dev-behaviors');
  });

  it('embedded: false says so — stored facet-only, evals over it run degraded', async () => {
    const user = userEvent.setup();
    wire({
      '/testing/corpora/import': () => Promise.resolve({ imported: 1, scope: 'evals:x', embedded: false }),
    });
    page();

    await user.type(screen.getByTestId('testing-corpus-name'), 'x');
    await user.upload(
      screen.getByTestId('testing-corpus-file'),
      new File([JSON.stringify(SAMPLES)], 'x.json', { type: 'application/json' }),
    );
    expect(await screen.findByTestId('testing-corpus-summary')).toHaveTextContent(/facet-only/);
  });

  it('501 on import folds into the same honest core-ts callout', async () => {
    const user = userEvent.setup();
    wire({
      '/testing/corpora/import': () => Promise.reject(new ApiError(501, 'governanceCorpusImport is not a function')),
    });
    page();

    await user.upload(
      screen.getByTestId('testing-corpus-file'),
      new File([JSON.stringify(SAMPLES)], 'x.json', { type: 'application/json' }),
    );
    expect(await screen.findByTestId('testing-corpus-unsupported')).toHaveTextContent(/requires core-ts 0\.7\.5/);
  });

  it('a file that is not a corpus fails in words, client-side, without a POST', async () => {
    const user = userEvent.setup();
    let posted = false;
    wire({
      '/testing/corpora/import': () => {
        posted = true;
        return Promise.resolve({ imported: 0, scope: 'evals:x', embedded: true });
      },
    });
    page();

    await user.upload(
      screen.getByTestId('testing-corpus-file'),
      new File(['{"not":"a corpus"}'], 'nope.json', { type: 'application/json' }),
    );
    expect(await screen.findByTestId('testing-corpus-error')).toHaveTextContent(/not an eval corpus/);
    expect(posted).toBe(false);
  });
});
