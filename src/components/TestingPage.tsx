import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, SessionView } from '../api/types.js';
import { STEERING_TYPE_LABELS, STEERING_TYPES } from '../api/steering.js';
import {
  importEvalCorpus,
  isTestingUnsupported,
  runEvals,
  testingPath,
  TESTING_PAGE_LABELS,
  TESTING_PAGES,
  TESTING_UNSUPPORTED_COPY,
  type CorpusImportResult,
  type EvalReport,
  type EvalResult,
  type EvalSample,
  type TestingSubPage,
} from '../api/testing.js';
import { useGateStore } from '../store/gates.js';
import { CampaignScoreboard } from './CampaignScoreboard.js';
import { CampaignsPage } from './CampaignsPage.js';
import { readFileText } from './fileText.js';
import { AuthorPanel } from './SteeringAuthorPanel.js';
import { SteeringGate } from './SteeringGate.js';

/**
 * The Testing surface (`/testing/:page`) — ONE page component parameterized by sub-page,
 * three sub-pages:
 *
 *  - **Harness** — where a testing effort starts: trigger a CAMPAIGN RECON (a governed run,
 *    launched over the SHIPPING `POST /runs` wire, that surveys the target and proposes a test
 *    campaign), render its INTAKE gate through the EXISTING SteeringGate card (the run's
 *    `awaitingHuman` frame arrives on the app's one /ws fold — no second gate UI, no polling),
 *    and approve to launch. Plus "add with chat": the steering AuthorPanel REUSED VERBATIM
 *    with type `testing` — the same governed authoring run + propose gate as SteeringPage.
 *  - **Campaigns** — the campaign list + scoreboard, MOVED here from the flat `/campaigns`
 *    addresses (which now redirect). The components are the EXISTING CampaignsPage /
 *    CampaignScoreboard, rendered — never forked.
 *  - **Evals** — the steering-rule eval runner over the PINNED testing wire
 *    (`POST /testing/evals/run`, `POST /testing/corpora/import` — see `../api/testing.ts`):
 *    run per steering type or all, caught/gap/false-positive summary + results table, gap rows
 *    expanding to nearest-rule similarities, and corpus upload. HONEST states throughout:
 *    501 names the engine gap (core-ts 0.7.5), `degraded: "facet-only"` renders a visible
 *    no-embedder notice, an empty corpus is an empty state in words — never a spinner that
 *    cannot settle, never fabricated numbers.
 */

// ── Harness: the campaign recon ───────────────────────────────────────────────────────────────

/**
 * The recon framing the Harness prepends to the operator's brief — exported so the composition
 * is contract-visible (and pinned by test): what the launch button sends is this prefix, a
 * blank line, then the operator's own words, verbatim.
 */
export const RECON_PROBLEM_PREFIX =
  'Campaign recon: survey the target and propose a test campaign — the scenarios, their ' +
  'dependencies, and which are deterministic tool checks vs governed agent runs. Present the ' +
  'proposed campaign at the intake gate and launch nothing until it is approved.';

function ReconPanel({ navigate, onClose }: {
  navigate: (path: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [instructions, setInstructions] = useState('');
  const [repoRef, setRepoRef] = useState('');
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  // The intake gate arrives as a normal awaitingHuman frame on the launched run — the app's
  // one /ws subscription already folds it into the gate store; this panel just watches for it
  // and renders the EXISTING gate card (the AuthorPanel grammar). No second gate UI, no polling.
  const gate = useGateStore((s) => (runId !== null ? s.gates[runId] : undefined));

  useEffect(() => {
    let disposed = false;
    api
      .listRepos()
      .then(({ repos: rs }) => {
        if (!disposed) setRepos(rs);
      })
      .catch(() => {
        /* repo picker stays empty — the recon can still launch unscoped */
      });
    return () => {
      disposed = true;
    };
  }, []);

  const launch = async (): Promise<void> => {
    if (busy || instructions.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const { runId: id } = await api.launchRun({
        problem: `${RECON_PROBLEM_PREFIX}\n\n${instructions.trim()}`,
        ...(repoRef !== '' ? { repoRef } : {}),
      });
      setRunId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="testing-recon-panel"
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          Run a campaign recon
        </span>
        <button
          data-testid="testing-recon-close"
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Close
        </button>
      </div>

      {runId === null ? (
        <>
          <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            Launches a governed recon run: it surveys the target, drafts a test campaign — the
            scenarios and their dependencies — and stops at its intake gate. Nothing runs until
            you approve the gate here.
          </p>
          <textarea
            data-testid="testing-recon-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should this campaign cover? Name the surfaces, risks, or behaviors to test."
            className="min-h-[4rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
          <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            repository
            <select
              data-testid="testing-recon-repo"
              value={repoRef}
              onChange={(e) => setRepoRef(e.target.value)}
              className="rounded px-1 py-0.5 text-[10px] font-mono"
              style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            >
              <option value="">all repositories</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {error !== null && (
            <p data-testid="testing-recon-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
              {error}
            </p>
          )}
          <div>
            <button
              data-testid="testing-recon-launch"
              type="button"
              disabled={busy || instructions.trim() === ''}
              onClick={() => void launch()}
              className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {busy ? 'Launching…' : 'Launch recon'}
            </button>
          </div>
        </>
      ) : resolved ? (
        <p data-testid="testing-recon-resolved" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Intake gate answered — the campaign&rsquo;s progress lands on{' '}
          <button
            type="button"
            data-testid="testing-recon-to-campaigns"
            onClick={() => navigate(testingPath('campaigns'))}
            className="underline"
            style={{ color: 'var(--accent)' }}
          >
            Campaigns
          </button>
          , and the recon run itself is at{' '}
          <button
            type="button"
            onClick={() => navigate(`/runs/${encodeURIComponent(runId)}`)}
            className="font-mono underline"
            style={{ color: 'var(--accent)' }}
          >
            {runId.slice(0, 8)}
          </button>
          .
        </p>
      ) : gate === undefined ? (
        <p data-testid="testing-recon-waiting" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Recon run <span className="font-mono">{runId.slice(0, 8)}</span> launched — its intake
          gate will appear here the moment the run asks. It also shows up everywhere gates do.
        </p>
      ) : (
        // The intake gate — the EXISTING gate card, reused verbatim. Approving (optionally
        // with steer text) is what launches the proposed campaign; rejecting launches nothing.
        <SteeringGate
          runId={runId}
          ord={gate.ord}
          prompt={gate.prompt}
          onResolved={() => setResolved(true)}
        />
      )}
    </div>
  );
}

function HarnessPage({ navigate }: { navigate: (path: string) => void }): React.ReactElement {
  /** Which harness panel is open — one at a time, the SteeringPage management-bar grammar. */
  const [panel, setPanel] = useState<'recon' | 'author' | null>(null);
  const openPanel = (p: 'recon' | 'author'): void => setPanel((cur) => (cur === p ? null : p));

  return (
    <div data-testid="testing-harness" className="flex flex-col gap-4">
      {/* The plain-language explainer (usability review #6 + qe findings): what
          this page is FOR, in words a first-time tester can act on. */}
      <p data-testid="testing-harness-explainer" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Start a testing effort here. A recon run looks over your code and proposes a test
        campaign — you see the proposal and approve or reject it before anything runs. You can
        also draft testing rules in chat, with the same approval step. Approved campaigns and
        their progress live on the Campaigns tab.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          data-testid="testing-recon-open"
          type="button"
          aria-expanded={panel === 'recon'}
          onClick={() => openPanel('recon')}
          className="rounded px-2 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Run campaign recon
        </button>
        <button
          data-testid="testing-author-open"
          type="button"
          aria-expanded={panel === 'author'}
          onClick={() => openPanel('author')}
          className="rounded px-2 py-1 text-[11px] font-semibold"
          style={{ color: 'var(--ink-high)', border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
        >
          Add with chat
        </button>
      </div>

      {panel === 'recon' && <ReconPanel navigate={navigate} onClose={() => setPanel(null)} />}
      {/* The steering AuthorPanel, REUSED VERBATIM with this surface's type: the authoring run
          drafts `testing` steering rules and stops at its propose gate — one component set. */}
      {panel === 'author' && <AuthorPanel type="testing" onClose={() => setPanel(null)} onAuthored={() => {}} />}
    </div>
  );
}

// ── Evals ─────────────────────────────────────────────────────────────────────────────────────

type EvalsRunState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
  // `corpus` records what THIS report ran against (null = the built-in default
  // set) — the report header's provenance line, pinned at run time so a later
  // edit of the corpus field cannot relabel finished numbers.
  | { kind: 'done'; report: EvalReport; corpus: string | null };

type CorpusImportState =
  | { kind: 'idle' }
  | { kind: 'busy'; filename: string }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
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
    <p data-testid={testid} className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
      {TESTING_UNSUPPORTED_COPY}
    </p>
  );
}

function GapNearestRules({ result, navigate }: {
  result: EvalResult;
  navigate: (path: string) => void;
}): React.ReactElement {
  const nearest = result.nearest_rules ?? [];
  // Where a nearest-rule link lands (qe finding: hints become LINKS): the
  // sample's own type page, with `?rule=<id>` opening that rule's drawer.
  const rulePath = (id: string): string =>
    `/steering/${encodeURIComponent(result.sample.steering_type)}?rule=${encodeURIComponent(id)}`;
  return (
    <div
      data-testid="testing-evals-nearest"
      className="flex flex-col gap-1 rounded px-3 py-2"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <span className="text-[10px] font-semibold" style={{ color: 'var(--ink-muted)' }}>
        Nearest rules — how close recall came to firing the right one
      </span>
      {nearest.length === 0 ? (
        <span data-testid="testing-evals-nearest-empty" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          No nearby rules recalled — nothing in the store is close to this sample.
        </span>
      ) : (
        nearest.map((n) => (
          <span key={n.rule_id} data-testid="testing-evals-nearest-rule" className="flex items-baseline gap-2 text-[10px] font-mono">
            <a
              data-testid="testing-evals-nearest-link"
              data-rule-id={n.rule_id}
              href={rulePath(n.rule_id)}
              onClick={(e) => {
                e.preventDefault();
                navigate(rulePath(n.rule_id));
              }}
              className="underline"
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
      <p data-testid="testing-evals-provenance" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
        corpus: {corpus ?? 'built-in default'} · {s.total} sample{s.total === 1 ? '' : 's'}
      </p>
      {report.degraded === 'facet-only' && (
        <p
          data-testid="testing-evals-degraded"
          className="rounded px-2 py-1 text-[10px]"
          style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}
        >
          Degraded run — this engine has no embedder, so recall matched on facets alone and
          nearest-rule similarity is unavailable. The verdicts are real; the gap analysis is
          weaker than an embedded run&rsquo;s.
        </p>
      )}

      <p data-testid="testing-evals-summary" className="flex flex-wrap items-baseline gap-3 text-[11px]">
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

      {report.results.length === 0 ? (
        <p data-testid="testing-evals-empty" className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          The corpus served no samples — import one below, or run against the built-in default
          corpus by leaving the corpus field blank.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid="testing-evals-table" className="w-full text-left text-[11px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--ink-dim)' }}>
                <th className="px-2 py-1 font-semibold">sample</th>
                <th className="px-2 py-1 font-semibold">type</th>
                <th className="px-2 py-1 font-semibold">expected</th>
                <th className="px-2 py-1 font-semibold">fired</th>
                <th className="px-2 py-1 font-semibold">verdict</th>
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
                      <td className="px-2 py-1.5 align-top font-mono" style={{ color: 'var(--ink-muted)' }}>
                        {r.sample.steering_type}
                      </td>
                      <td className="px-2 py-1.5 align-top font-mono" style={{ color: 'var(--ink-muted)' }}>{r.expected}</td>
                      <td className="px-2 py-1.5 align-top font-mono" style={{ color: 'var(--ink-muted)' }}>
                        {r.fired.length === 0 ? '—' : r.fired.join(', ')}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <span
                          data-testid="testing-evals-verdict-word"
                          className="rounded px-1.5 text-[10px] font-semibold"
                          style={{ color: EVAL_VERDICT_COLOR[r.verdict], border: `1px solid ${EVAL_VERDICT_COLOR[r.verdict]}` }}
                        >
                          {evalVerdictWord(r)}
                        </span>
                        {isGap && (
                          <button
                            type="button"
                            data-testid="testing-evals-gap-toggle"
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : r.sample.id)}
                            className="ml-2 text-[10px] underline"
                            style={{ color: 'var(--ink-dim)' }}
                          >
                            {expanded ? 'hide nearest' : 'nearest rules'}
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
  const [importState, setImportState] = useState<CorpusImportState>({ kind: 'idle' });

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
    } catch (e) {
      if (isTestingUnsupported(e)) setState({ kind: 'unsupported' });
      else setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
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
        // The imported scope is what the next run should target — pre-fill it, editable.
        setCorpus(result.scope);
      })
      .catch((e: unknown) => {
        if (isTestingUnsupported(e)) setImportState({ kind: 'unsupported' });
        else setImportState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
  };

  return (
    <div data-testid="testing-evals" className="flex flex-col gap-4">
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Evals replay a corpus of good/bad behavior samples against the steering-rule store and
        report what recall caught, what it missed, and what it flagged wrongly — the measured
        answer to &ldquo;do the rules actually steer?&rdquo;.
      </p>

      {/* The run controls — type (one of the seven, or all) + corpus scope. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          steering type
          <select
            data-testid="testing-evals-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded px-1 py-0.5 text-[11px] font-mono"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            <option value="">all types</option>
            {STEERING_TYPES.map((t) => (
              <option key={t} value={t}>
                {STEERING_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          corpus (leave blank for the built-in sample set)
          <input
            data-testid="testing-evals-corpus"
            value={corpus}
            onChange={(e) => setCorpus(e.target.value)}
            placeholder="evals:dev-behaviors"
            className="rounded px-2 py-0.5 text-[11px] font-mono"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        <button
          data-testid="testing-evals-run"
          type="button"
          disabled={state.kind === 'busy'}
          onClick={() => void run()}
          className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {state.kind === 'busy' ? 'Running…' : 'Run evals'}
        </button>
      </div>

      {state.kind === 'busy' && (
        <p data-testid="testing-evals-busy" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          Running evals…
        </p>
      )}
      {state.kind === 'unsupported' && <UnsupportedNote testid="testing-evals-unsupported" />}
      {state.kind === 'failed' && (
        <p data-testid="testing-evals-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {state.message}
        </p>
      )}
      {state.kind === 'done' && (
        <EvalReportView report={state.report} corpus={state.corpus} navigate={navigate} />
      )}

      {/* Corpus import — a JSON file of samples lands in the estate as `evals:<name>`. */}
      <div
        className="flex flex-col gap-2 rounded p-3"
        style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
      >
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          Import a corpus
        </span>
        <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          A .json file — a bare array of samples, or {'{name, samples}'}. Each sample:{' '}
          <span className="font-mono">
            {'{id, description, kind: good|bad, steering_type, signals}'}
          </span>
          .
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            data-testid="testing-corpus-name"
            value={corpusName}
            onChange={(e) => setCorpusName(e.target.value)}
            placeholder="corpus name (blank = from the file)"
            className="rounded px-2 py-0.5 text-[11px] font-mono"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
          <input
            data-testid="testing-corpus-file"
            type="file"
            accept=".json,application/json"
            aria-label="Import an eval corpus"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) onCorpusPick(file);
              e.target.value = '';
            }}
            className="text-[10px]"
            style={{ color: 'var(--ink-muted)' }}
          />
        </div>
        {importState.kind === 'busy' && (
          <p data-testid="testing-corpus-busy" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            Importing {importState.filename}…
          </p>
        )}
        {importState.kind === 'unsupported' && <UnsupportedNote testid="testing-corpus-unsupported" />}
        {importState.kind === 'failed' && (
          <p data-testid="testing-corpus-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {importState.message}
          </p>
        )}
        {importState.kind === 'done' && (
          <p data-testid="testing-corpus-summary" className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            {importState.filename}: imported {importState.result.imported} sample
            {importState.result.imported === 1 ? '' : 's'} into{' '}
            <span className="font-mono" style={{ color: 'var(--ink-high)' }}>{importState.result.scope}</span>
            {importState.result.embedded ? ' (embedded)' : ' — stored facet-only: this engine has no embedder, so evals over it run degraded'}
            .
          </p>
        )}
      </div>
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────────────────────

export function TestingPage({ page, campaignId, runs, navigate }: {
  page: TestingSubPage;
  /** Non-null only on `/testing/campaigns/:id` — renders that campaign's scoreboard. */
  campaignId: string | null;
  /** The board's live run list — the campaign scoreboard reads sibling status from it. */
  runs: SessionView[];
  navigate: (path: string) => void;
}): React.ReactElement {
  return (
    <div data-testid="testing-page" data-testing-page={page} className="flex flex-col">
      <div className="flex max-w-5xl flex-col gap-4 px-6 pt-6">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>
          Testing · {TESTING_PAGE_LABELS[page]}
        </h2>

        {/* The sub-page strip: three real navigations — the SteeringPage tab grammar. */}
        <nav data-testid="testing-tabs" aria-label="Testing pages" className="flex flex-wrap gap-1">
          {TESTING_PAGES.map((p) => (
            <a
              key={p}
              data-testid="testing-tab"
              data-page={p}
              href={testingPath(p)}
              aria-current={p === page ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(testingPath(p));
              }}
              className="rounded px-2 py-1 text-[11px] font-semibold"
              style={{
                textDecoration: 'none',
                color: p === page ? 'var(--ink-high)' : 'var(--ink-muted)',
                background: p === page ? 'var(--surface-raised)' : 'transparent',
                border: `1px solid ${p === page ? 'var(--surface-raised)' : 'transparent'}`,
              }}
            >
              {TESTING_PAGE_LABELS[p]}
            </a>
          ))}
        </nav>
      </div>

      {/* Campaigns keep their own internal padding (the moved pages, unforked); Harness and
          Evals content shares this shell's gutter. */}
      {page === 'campaigns' ? (
        campaignId !== null ? (
          <CampaignScoreboard campaignId={campaignId} runs={runs} navigate={navigate} />
        ) : (
          <CampaignsPage navigate={navigate} />
        )
      ) : (
        <div className="max-w-5xl px-6 py-4">
          {page === 'harness' ? <HarnessPage navigate={navigate} /> : <EvalsPage navigate={navigate} />}
        </div>
      )}
    </div>
  );
}
