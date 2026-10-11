import { Fragment, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { readErrorKind } from '../api/errors.js';
import { rulePath } from '../api/decisions.js';
import { STEERING_TYPE_LABELS, STEERING_TYPES } from '../api/steering.js';
import {
  importEvalCorpus,
  isTestingUnsupported,
  runEvals,
  TESTING_PAGE_LABELS,
  TESTING_UNSUPPORTED_COPY,
  type CorpusImportResult,
  type EvalReport,
  type EvalResult,
  type EvalSample,
  type LaunchIntent,
  type TestingSubPage,
} from '../api/testing.js';
import type { Navigate } from '../hooks/useRoute.js';
import { useEvalReportStore } from '../store/evalReport.js';
import { CampaignScoreboard } from './CampaignScoreboard.js';
import { CampaignsPage } from './CampaignsPage.js';
import { EVAL_FACET_MATCH_EXPLANATION, EvalHistory } from './EvalHistory.js';
import { readFileText } from './fileText.js';
import { EmptyState, FilePick, PageFrame, StateBanner, TechDetails } from './ui/index.js';

/**
 * The Testing surface (`/testing/:page`) — ONE page component parameterized by sub-page,
 * two sub-pages (the testing-UX wave folded the Harness into the landing):
 *
 *  - **Campaigns** — THE LANDING: the campaign command surface (`CampaignsPage` — KPI band,
 *    creation verbs, filterable card grid; the retired Harness's recon / new-campaign /
 *    add-with-chat verbs live in its header), with `/testing/campaigns/:id` rendering one
 *    campaign's scoreboard. The retired `/testing/harness` and the flat `/campaigns`
 *    addresses redirect here (`useTestingRedirect`).
 *  - **Evals** — the steering-rule eval runner over the PINNED testing wire
 *    (`POST /testing/evals/run`, `POST /testing/corpora/import` — see `../api/testing.ts`):
 *    run per steering type or all, caught/gap/false-positive summary + results table, gap rows
 *    expanding to nearest-rule similarities, and corpus upload. HONEST states throughout:
 *    501 names the engine gap (core-ts 0.7.5), `degraded: "facet-only"` renders a visible
 *    no-embedder notice, an empty corpus is an empty state in words — never a spinner that
 *    cannot settle, never fabricated numbers.
 */

// ── Evals ─────────────────────────────────────────────────────────────────────────────────────

type EvalsRunState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; error: unknown }
  // `corpus` records what THIS report ran against (null = the built-in default
  // set) — the report header's provenance line, pinned at run time so a later
  // edit of the corpus field cannot relabel finished numbers.
  | { kind: 'done'; report: EvalReport; corpus: string | null };

type CorpusImportState =
  | { kind: 'idle' }
  | { kind: 'busy'; filename: string }
  | { kind: 'unsupported' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'done'; filename: string; result: CorpusImportResult };

// Gap wears the attention amber, not failure red (qe finding: a gap is an
// UNCOVERED BEHAVIOR — a place to write a rule — not a red failure).
const EVAL_VERDICT_COLOR: Record<EvalResult['verdict'], string> = {
  caught: 'var(--status-done)',
  gap: 'var(--status-gate)',
  false_positive: 'var(--status-gate)',
};

/**
 * The verdict word, split by what "caught" actually meant (qe finding): a BAD
 * sample the rules fired on was **blocked**; a GOOD sample the rules let
 * through **passed**. One word for both hid which half the store is good at.
 */
export function evalVerdictWord(r: { verdict: EvalResult['verdict']; sample: { kind: string } }): string {
  if (r.verdict === 'gap') return 'gap';
  if (r.verdict === 'false_positive') return 'false positive';
  // A sample kind the report echo doesn't name keeps the unsplit word — never
  // a guessed half.
  return r.sample.kind === 'bad' ? 'blocked' : r.sample.kind === 'good' ? 'passed' : 'caught';
}

/** The honest engine-gap callout — 501 / route-absent, shared by run + import. */
function UnsupportedNote({ testid }: { testid: string }): React.ReactElement {
  return (
    <EmptyState data-testid={testid} title={TESTING_UNSUPPORTED_COPY} />
  );
}

function GapNearestRules({ result, navigate }: {
  result: EvalResult;
  navigate: (path: string) => void;
}): React.ReactElement {
  const nearest = result.nearest_rules ?? [];
  // Where a nearest-rule link lands (qe finding: hints become LINKS): the Rules page, the rule open
  // on its own address (`rulePath`, S12) — the one place every rule link in studio lands.
  return (
    <div
      data-testid="testing-evals-nearest"
      className="flex flex-col gap-1 rounded px-3 py-2"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <span className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
        Nearest rules — how close recall came to firing the right one
      </span>
      {nearest.length === 0 ? (
        <span data-testid="testing-evals-nearest-empty" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          No nearby rules recalled — nothing in the store is close to this sample.
        </span>
      ) : (
        nearest.map((n) => (
          <span key={n.rule_id} data-testid="testing-evals-nearest-rule" className="flex flex-wrap items-baseline gap-2 text-xs">
            <a
              data-testid="testing-evals-nearest-link"
              data-rule-id={n.rule_id}
              href={rulePath(n.rule_id)}
              onClick={(e) => {
                e.preventDefault();
                navigate(rulePath(n.rule_id));
              }}
              className="font-mono underline"
              style={{ color: 'var(--accent)' }}
            >
              {n.rule_id}
            </a>
            <span style={{ color: 'var(--ink-muted)' }}>similarity {n.similarity.toFixed(2)}</span>
          </span>
        ))
      )}
    </div>
  );
}

function EvalReportView({ report, corpus, navigate }: {
  report: EvalReport;
  /** The corpus the run targeted — null = the built-in default set. */
  corpus: string | null;
  navigate: (path: string) => void;
}): React.ReactElement {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const s = report.summary;
  // Split "caught" into its two honest halves (qe finding): bad samples the
  // rules BLOCKED vs good samples the rules PASSED. Derived from the result
  // rows; when the report carries none, the unsplit summary count stands.
  const blocked = report.results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'bad').length;
  const passed = report.results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'good').length;

  return (
    <div className="flex flex-col gap-3">
      {/* Corpus provenance (qe finding): which samples produced these numbers. */}
      <p data-testid="testing-evals-provenance" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
        Corpus: {corpus ?? 'built-in sample set'} · {s.total} sample{s.total === 1 ? '' : 's'}
      </p>
      {report.degraded === 'facet-only' && (
        <p
          data-testid="testing-evals-degraded"
          className="wk-field-note"
        >
          <span className="wk-tag wk-tag--gate" title={EVAL_FACET_MATCH_EXPLANATION}
            aria-label={`Facet match only: ${EVAL_FACET_MATCH_EXPLANATION}`}>Facet match only</span>: {EVAL_FACET_MATCH_EXPLANATION}
        </p>
      )}

      <p data-testid="testing-evals-summary" className="flex flex-wrap items-baseline gap-3 text-xs">
        <span style={{ color: 'var(--ink-high)', fontWeight: 600 }}>{s.total} samples</span>
        {report.results.length > 0 ? (
          <>
            <span data-testid="testing-evals-blocked" style={{ color: EVAL_VERDICT_COLOR.caught }}>{blocked} blocked</span>
            <span data-testid="testing-evals-passed" style={{ color: EVAL_VERDICT_COLOR.caught }}>{passed} passed</span>
          </>
        ) : (
          <span style={{ color: EVAL_VERDICT_COLOR.caught }}>{s.caught} caught</span>
        )}
        {/* Gaps are UNCOVERED BEHAVIORS — work to do, not a red failure. */}
        <span data-testid="testing-evals-gaps" style={{ color: EVAL_VERDICT_COLOR.gap }}>
          {s.gaps} uncovered behavior{s.gaps === 1 ? '' : 's'}
        </span>
        <span style={{ color: EVAL_VERDICT_COLOR.false_positive }}>{s.false_positives} false positives</span>
      </p>

      {/* Why gaps happen (content-quality guidance): a gap is a behavior no steering rule matched.
          On the BUILT-IN generic corpus that usually means the corpus tests behaviors your steering
          doesn't target — not that your rules are broken. Import a corpus that mirrors your steering,
          or add rules for the behaviors you DO want caught. Facet-only recall also widens gaps. */}
      {s.gaps > 0 && corpus === null && (
        <p data-testid="testing-evals-gap-hint" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--surface-rail)', color: 'var(--ink-muted)' }}>
          A gap is a behavior no steering rule matched. These are from the built-in <em>generic</em>
          corpus — if your steering targets your own codebase&rsquo;s concerns rather than these, that
          is expected, not broken rules. Import a corpus that mirrors your steering (Import a corpus,
          below), or add rules for the behaviors you want caught.
        </p>
      )}

      {report.results.length === 0 ? (
        <EmptyState data-testid="testing-evals-empty" title="The corpus served no samples."
          body="Import one below, or run against the built-in default corpus by leaving the corpus field blank." />
      ) : (
        <div className="overflow-x-auto">
          <table data-testid="testing-evals-table" className="w-full text-left text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--ink-dim)' }}>
                <th className="px-2 py-1 font-semibold">Sample</th>
                <th className="px-2 py-1 font-semibold">Type</th>
                <th className="px-2 py-1 font-semibold">Expected</th>
                <th className="px-2 py-1 font-semibold">Fired</th>
                <th className="px-2 py-1 font-semibold">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {report.results.map((r) => {
                const isGap = r.verdict === 'gap';
                const expanded = expandedId === r.sample.id;
                return (
                  <Fragment key={r.sample.id}>
                    <tr
                      data-testid="testing-evals-row"
                      data-sample-id={r.sample.id}
                      data-verdict={r.verdict}
                      style={{ borderTop: '1px solid var(--surface-raised)' }}
                    >
                      <td className="px-2 py-1.5 align-top">
                        <span className="font-mono" style={{ color: 'var(--ink-high)' }}>{r.sample.id}</span>
                        <p className="mt-0.5" style={{ color: 'var(--ink-muted)' }}>{r.sample.description}</p>
                      </td>
                      <td className="px-2 py-1.5 align-top" style={{ color: 'var(--ink-muted)' }}>
                        {r.sample.steering_type}
                      </td>
                      <td className="px-2 py-1.5 align-top" style={{ color: 'var(--ink-muted)' }}>{r.expected}</td>
                      <td className="px-2 py-1.5 align-top" style={{ color: 'var(--ink-muted)' }}>
                        {r.fired.length === 0 ? '—' : <span className="font-mono">{r.fired.join(', ')}</span>}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <span
                          data-testid="testing-evals-verdict-word"
                          className={`wk-tag ${r.verdict === 'caught' ? 'wk-tag--ok' : r.verdict === 'gap' ? 'wk-tag--gate' : 'wk-tag--fail'}`}
                        >
                          {evalVerdictWord(r)}
                        </span>
                        {isGap && (
                          <button
                            type="button"
                            data-testid="testing-evals-gap-toggle"
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : r.sample.id)}
                            className="wk-btn wk-btn--quiet wk-btn--sm"
                          >
                            {expanded ? 'Hide nearest rules' : 'Nearest rules'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isGap && expanded && (
                      <tr data-testid="testing-evals-gap-detail">
                        <td colSpan={5} className="px-2 pb-2">
                          <GapNearestRules result={r} navigate={navigate} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EvalsPage({ navigate }: { navigate: (path: string) => void }): React.ReactElement {
  /** `''` = all seven types (the body omits `type`). */
  const [type, setType] = useState('');
  /** `''` = the built-in default corpus (the body omits `corpus`). */
  const [corpus, setCorpus] = useState('');
  const [state, setState] = useState<EvalsRunState>({ kind: 'idle' });
  const [corpusName, setCorpusName] = useState('');
  const [corpusFile, setCorpusFile] = useState<File | null>(null);
  const [importState, setImportState] = useState<CorpusImportState>({ kind: 'idle' });
  /** Bumped after a successful run so the persisted history (EvalHistory) re-fetches. */
  const [historyKey, setHistoryKey] = useState(0);

  const run = async (): Promise<void> => {
    if (state.kind === 'busy') return;
    setState({ kind: 'busy' });
    const corpusUsed = corpus.trim() !== '' ? corpus.trim() : null;
    try {
      const report = await runEvals({
        ...(type !== '' ? { type } : {}),
        ...(corpusUsed !== null ? { corpus: corpusUsed } : {}),
      });
      setState({ kind: 'done', report, corpus: corpusUsed });
      // The daemon now PERSISTS every run (crew-side EvalRunStore) — refresh the history below so
      // this run appears without a reload. The session-local deposit stays as the Steering landing's
      // success-lens tile source (a zero-fetch latest-eval snapshot).
      setHistoryKey((k) => k + 1);
      useEvalReportStore.getState().deposit(report, corpusUsed);
    } catch (e) {
      if (isTestingUnsupported(e)) setState({ kind: 'unsupported' });
      else setState({ kind: 'failed', error: e });
    }
  };

  const onCorpusPick = (file: File): void => {
    setImportState({ kind: 'busy', filename: file.name });
    void readFileText(file)
      .then((content) => {
        // The file is either a bare `Sample[]` or a `{name, samples}` wrapper; the name field
        // above wins over the wrapper's, and the filename stem is the last resort.
        const parsed = JSON.parse(content) as unknown;
        const wrapper = !Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null
          ? (parsed as { name?: unknown; samples?: unknown })
          : null;
        const samples = Array.isArray(parsed) ? parsed : wrapper?.samples;
        if (!Array.isArray(samples)) {
          throw new Error(`${file.name} is not an eval corpus — expected a JSON array of samples, or {name, samples}`);
        }
        const name =
          corpusName.trim() !== ''
            ? corpusName.trim()
            : typeof wrapper?.name === 'string' && wrapper.name.trim() !== ''
              ? wrapper.name.trim()
              : file.name.replace(/\.json$/i, '');
        return importEvalCorpus({ name, samples: samples as EvalSample[] });
      })
      .then((result) => {
        setImportState({ kind: 'done', filename: file.name, result });
        setCorpusFile(null);
        // The imported scope is what the next run should target — pre-fill it, editable.
        setCorpus(result.scope);
      })
      .catch((e: unknown) => {
        if (isTestingUnsupported(e)) setImportState({ kind: 'unsupported' });
        else setImportState({ kind: 'failed', error: e });
      });
  };

  return (
    <div data-testid="testing-evals" className="flex flex-col gap-4">
      {/* The run controls — type (one of the seven, or all) + corpus scope. */}
      <div className="wk-evals-controls">
        <div className="wk-evals-field">
          <label className="wk-field-label" htmlFor="evals-steering-type">Steering type</label>
          <select id="evals-steering-type" data-testid="testing-evals-type" className="wk-field"
            value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {STEERING_TYPES.map((t) => <option key={t} value={t}>{STEERING_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="wk-evals-field">
          <label className="wk-field-label" htmlFor="evals-corpus">Corpus</label>
          <input id="evals-corpus" data-testid="testing-evals-corpus" className="wk-field"
            value={corpus} onChange={(e) => setCorpus(e.target.value)}
            placeholder="Built-in sample set" aria-describedby="evals-corpus-note" />
          <p id="evals-corpus-note" className="wk-field-note">Leave blank to run the built-in sample set.</p>
        </div>
        <button data-testid="testing-evals-run" type="button" disabled={state.kind === 'busy'}
          onClick={() => void run()} className="wk-btn wk-btn--primary">
          {state.kind === 'busy' ? 'Running…' : 'Run evals'}
        </button>
      </div>

      {state.kind === 'busy' && (
        <p data-testid="testing-evals-busy" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          Running evals…
        </p>
      )}
      {state.kind === 'unsupported' && <UnsupportedNote testid="testing-evals-unsupported" />}
      {state.kind === 'failed' && (
        <div data-testid="testing-evals-error">
          <StateBanner kind={readErrorKind(state.error)} what="the eval results"
            error={state.error instanceof Error ? state.error.message : String(state.error)}
            onRetry={() => void run()} />
        </div>
      )}
      {state.kind === 'done' && (
        <EvalReportView report={state.report} corpus={state.corpus} navigate={navigate} />
      )}

      {/* Corpus import — a JSON file of samples lands in the estate as `evals:<name>`. */}
      <div className="wk-card wk-evals-import">
        <h2 className="wk-section-title">Import a corpus</h2>
        <p className="wk-field-note">Choose a JSON file containing an array of samples, or a name and samples.</p>
        <TechDetails summary="Corpus JSON format"
          text={'A JSON array of samples, or {name, samples}. Each sample: {id, description, kind: good|bad, steering_type, signals}.'} />
        <div className="wk-evals-controls">
          <div className="wk-evals-field">
            <label className="wk-field-label" htmlFor="evals-corpus-name">Corpus name</label>
            <input id="evals-corpus-name" data-testid="testing-corpus-name" className="wk-field"
              value={corpusName} onChange={(e) => setCorpusName(e.target.value)}
              placeholder="Name (optional)" aria-describedby="evals-corpus-name-note" />
            <p id="evals-corpus-name-note" className="wk-field-note">Leave blank to use the file's name.</p>
          </div>
          <div className="wk-evals-file">
            <FilePick data-testid="testing-corpus-file" label="Choose a file…"
              accept=".json,application/json" file={corpusFile} onChange={(file) => {
                setCorpusFile(file);
                if (file !== null) onCorpusPick(file);
              }} />
          </div>
        </div>
        {importState.kind === 'busy' && (
          <p data-testid="testing-corpus-busy" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
            Importing {importState.filename}…
          </p>
        )}
        {importState.kind === 'unsupported' && <UnsupportedNote testid="testing-corpus-unsupported" />}
        {importState.kind === 'failed' && (
          <div data-testid="testing-corpus-error">
            {importState.error instanceof Error && importState.error.message.includes('not an eval corpus') ? (
              <>
                <p className="wk-field-note wk-field-note--bad">That file isn&rsquo;t an eval corpus.</p>
                <TechDetails text={importState.error.message} />
              </>
            ) : (
              <StateBanner kind={readErrorKind(importState.error)} what="the corpus"
                error={importState.error instanceof Error ? importState.error.message : String(importState.error)}
                onRetry={() => { if (corpusFile !== null) onCorpusPick(corpusFile); }} />
            )}
          </div>
        )}
        {importState.kind === 'done' && (
          <p data-testid="testing-corpus-summary" className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {importState.filename}: imported {importState.result.imported} sample
            {importState.result.imported === 1 ? '' : 's'} into{' '}
            <span style={{ color: 'var(--ink-high)' }}>{importState.result.scope}</span>
            {importState.result.embedded ? ' (embedded)' : (
              <> · <span className="wk-tag wk-tag--gate" title={EVAL_FACET_MATCH_EXPLANATION}
                aria-label={`Facet match only: ${EVAL_FACET_MATCH_EXPLANATION}`}>Facet match only</span></>
            )}
            .
          </p>
        )}
      </div>

      {/* The persisted run history (crew-side EvalRunStore) — every run above is recorded here,
          drillable. `historyKey` bumps on a successful run so it refreshes without a reload. */}
      <EvalHistory refreshKey={historyKey} />
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────────────────────

export function TestingPage({ page, campaignId, runs, navigate, launchIntent = null, projectId = null }: {
  page: TestingSubPage;
  /** Non-null only on `/testing/campaigns/:id` — renders that campaign's scoreboard. */
  campaignId: string | null;
  /** The board's live run list — the campaign landing + scoreboard read live status from it. */
  runs: SessionView[];
  navigate: Navigate;
  /** The landing's `?new=` arrival intent (`readLaunchIntent(search)`) — opens that launch panel. */
  launchIntent?: LaunchIntent | null;
  /** S16a-4f: the landing's `?project=` — the project a new test's launch panel preselects. */
  projectId?: string | null;
}): React.ReactElement {
  return (
    <div data-testid="testing-page" data-testing-page={page} className="flex flex-col">
      {/* Each sub-page owns its PageFrame (UI-CONTRACT §4.6): the landing and the scoreboard carry
          their own title and actions; Evals is framed here. */}
      {page === 'campaigns' ? (
        campaignId !== null ? (
          <CampaignScoreboard campaignId={campaignId} runs={runs} navigate={navigate} />
        ) : (
          <CampaignsPage runs={runs} navigate={navigate} launchIntent={launchIntent} projectId={projectId} />
        )
      ) : (
        <PageFrame
          title={TESTING_PAGE_LABELS.evals}
          intro="Check whether your steering rules catch what they should: replay good and bad samples and see what was caught, missed or wrongly flagged."
          data-testid="testing-evals-frame"
        >
          <EvalsPage navigate={navigate} />
        </PageFrame>
      )}
    </div>
  );
}
