import { Fragment, useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleDashed, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client.js';
import { rulePath } from '../../api/decisions.js';
import { readErrorKind } from '../../api/errors.js';
import { policiesPath, STEERING_TYPES, STEERING_TYPE_LABELS, type SteeringRule, type SteeringType } from '../../api/steering.js';
import {
  importEvalCorpus,
  isTestingUnsupported,
  runEvals,
  TESTING_UNSUPPORTED_COPY,
  type CorpusImportResult,
  type EvalResult,
  type EvalSample,
} from '../../api/testing.js';
import { coverageByType, draftRequest, evalCaveats, gapsByType, historyStores, storeMatch } from '../../board/evalModel.js';
import { absTime, relTime } from '../../board/relTime.js';
import { steerTotals } from '../../board/steerModel.js';
import { useDaemonRuleStore } from '../../hooks/useDaemonRuleStore.js';
import { useLatestEval } from '../../hooks/useLatestEval.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useEvalReportStore } from '../../store/evalReport.js';
import { useSteerDraft } from '../../store/steerDraft.js';
import { CategoryBars } from '../charts/CategoryBars.js';
import { EVAL_FACET_MATCH_EXPLANATION, EvalHistory } from '../EvalHistory.js';
import { readFileText } from '../fileText.js';
import { FilePick, Segmented, Skeleton, StateBanner, TechDetails } from '../ui/index.js';
import { SeStat, SeStats } from './SeStat.js';

/**
 * THE EVALUATE SURFACE (DES-steer-eval §3; operator-approved concept `concepts/tabs.html#evaluate`).
 * Desk v2's Evaluate tab hosts it; `/testing/evals` renders it too. Replays good and bad samples
 * against the steering rules (TESTING.md) and reads the verdicts at a glance:
 *
 *  - tiles: caught N of M, gaps, false alarms, and Run evals with the last run's line;
 *  - coverage by steering type (caught vs gap vs false alarm per type, one chart);
 *  - gaps to close, by type, each with Draft rules: the steering assistant opens on Steer with a
 *    request naming the uncovered behaviours typed in (the operator sends it; nothing is sent here);
 *  - every result, filterable, a gap opening its nearest rules; the corpus import; the run history.
 *
 * The numbers are the latest run's (the persisted history, or a run made here). The two writes
 * (`POST /testing/evals/run`, `POST /testing/corpora/import`) are the ones the page always had.
 */

/** The verdict word, split by what "caught" meant: a BAD sample blocked, a GOOD sample left alone. */
export function evalVerdictWord(r: { verdict: EvalResult['verdict']; sample: { kind: string } }): string {
  if (r.verdict === 'gap') return 'gap';
  if (r.verdict === 'false_positive') return 'false alarm';
  return r.sample.kind === 'bad' ? 'blocked' : r.sample.kind === 'good' ? 'left alone' : 'caught';
}

/** Blocked (protection) is the only green; a good sample left alone is neutral — it is "caught" in the
 *  engine's word but protects nothing (DES-steer-eval §3.2). */
const VERDICT_COLOR = { blocked: 'var(--status-ok)', passed: 'var(--border-strong)', gaps: 'var(--status-warn)', falsePositives: 'var(--status-fail)' } as const;

type RunState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; error: unknown };

type ImportState =
  | { kind: 'idle' }
  | { kind: 'busy'; filename: string }
  | { kind: 'unsupported' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'done'; filename: string; result: CorpusImportResult };

type ResultFilter = 'all' | 'gap' | 'false_positive' | 'caught';

const GAP_TYPES_SHOWN = 4;

function NearestRules({ result, navigate, foreign }: {
  result: EvalResult;
  navigate: Navigate;
  /** The run was judged against another rule store: its rule ids name THAT store's rules, so they
   *  are not links into this daemon's (an id can match a different rule here) (codex r4 #1). */
  foreign: boolean;
}): React.ReactElement {
  const nearest = result.nearest_rules ?? [];
  return (
    <div data-testid="testing-evals-nearest" className="wk-se-nearest">
      <span className="wk-se-nearest-title">Nearest rules — how close recall came to the right one</span>
      {foreign && nearest.length > 0 && <span className="wk-se-quiet-sm">These are rules in the other rule store this run was judged against, not this daemon&rsquo;s.</span>}
      {nearest.length === 0 ? (
        <span data-testid="testing-evals-nearest-empty" className="wk-se-quiet-sm">No nearby rules — nothing in force is close to this behaviour. It needs a new rule.</span>
      ) : nearest.map((n) => (
        <span key={n.rule_id} data-testid="testing-evals-nearest-rule" className="wk-se-nearest-row">
          {foreign ? (
            <span data-testid="testing-evals-nearest-foreign" data-rule-id={n.rule_id} className="wk-se-mono" title="A rule in the other rule store this run was judged against">{n.rule_id}</span>
          ) : (
            <a data-testid="testing-evals-nearest-link" data-rule-id={n.rule_id} href={rulePath(n.rule_id)} className="wk-link wk-se-mono"
              onClick={(e) => { e.preventDefault(); navigate(rulePath(n.rule_id)); }}>{n.rule_id}</a>
          )}
          <span className="wk-se-quiet-sm">similarity {n.similarity.toFixed(2)}</span>
        </span>
      ))}
    </div>
  );
}

export function EvaluateSurface({ navigate, title, intro = 'Replay good and bad behaviours against your rules: what they catch, what slips through, and what they block by mistake.' }: {
  navigate: Navigate;
  /** A page title — given when the surface stands alone; the Desk tab names it already. */
  title?: string;
  intro?: string;
}): React.ReactElement {
  const [historyKey, setHistoryKey] = useState(0);
  const latest = useLatestEval(historyKey);
  const [rules, setRules] = useState<SteeringRule[] | null>(null);
  useEffect(() => { void api.listConformanceRules().then(({ rules: rs }) => setRules(rs as SteeringRule[])).catch(() => setRules(null)); }, []);

  // ── Run ──────────────────────────────────────────────────────────────────────────────────────
  const [type, setType] = useState('');
  const [corpus, setCorpus] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const doRun = async (): Promise<void> => {
    if (run.kind === 'busy') return;
    setRun({ kind: 'busy' });
    const corpusUsed = corpus.trim() !== '' ? corpus.trim() : null;
    try {
      const report = await runEvals({ ...(type !== '' ? { type } : {}), ...(corpusUsed !== null ? { corpus: corpusUsed } : {}) });
      useEvalReportStore.getState().deposit(report, corpusUsed);
      setRun({ kind: 'idle' });
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setRun(isTestingUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', error: e });
    }
  };

  // ── Import ───────────────────────────────────────────────────────────────────────────────────
  const [corpusName, setCorpusName] = useState('');
  const [corpusFile, setCorpusFile] = useState<File | null>(null);
  const [imp, setImp] = useState<ImportState>({ kind: 'idle' });
  const onCorpusPick = (file: File): void => {
    setImp({ kind: 'busy', filename: file.name });
    void readFileText(file)
      .then((content) => {
        const parsed = JSON.parse(content) as unknown;
        const wrapper = !Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null ? (parsed as { name?: unknown; samples?: unknown }) : null;
        const samples = Array.isArray(parsed) ? parsed : wrapper?.samples;
        if (!Array.isArray(samples)) throw new Error(`${file.name} is not an eval corpus — expected a JSON array of samples, or {name, samples}`);
        const name = corpusName.trim() !== '' ? corpusName.trim()
          : typeof wrapper?.name === 'string' && wrapper.name.trim() !== '' ? wrapper.name.trim() : file.name.replace(/\.json$/i, '');
        return importEvalCorpus({ name, samples: samples as EvalSample[] });
      })
      .then((result) => { setImp({ kind: 'done', filename: file.name, result }); setCorpusFile(null); setCorpus(result.scope); setOptionsOpen(true); })
      .catch((e: unknown) => setImp(isTestingUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', error: e }));
  };

  // ── Folds ────────────────────────────────────────────────────────────────────────────────────
  const ev = latest.kind === 'ok' ? latest.eval : null;
  const results = useMemo(() => ev?.results ?? [], [ev]);
  const coverage = useMemo(() => coverageByType(results), [results]);
  const gapGroups = useMemo(() => gapsByType(results), [results]);
  const blocked = results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'bad').length;
  const passed = results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'good').length;
  const badCount = results.filter((r) => r.sample.kind === 'bad').length;
  const totals = rules !== null ? steerTotals(rules) : null;
  const daemonStore = useDaemonRuleStore();
  const store = ev !== null ? storeMatch(ev.ruleStore, daemonStore) : 'unknown';
  const caveats = ev === null ? [] : evalCaveats({
    summary: ev.summary,
    results,
    totals,
    store,
    history: latest.kind === 'ok' && latest.history.length > 0 && daemonStore != null ? historyStores(latest.history, daemonStore) : null,
  });
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [allGapTypes, setAllGapTypes] = useState(false);
  const rows = results.filter((r) => filter === 'all' || r.verdict === filter);

  const draft = (t: SteeringType, gaps: readonly EvalResult[]): void => {
    useSteerDraft.getState().put(t, draftRequest(t, gaps));
    navigate(policiesPath(t));
  };
  const toResults = (f: ResultFilter): void => {
    setFilter(f);
    document.getElementById('evaluate-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const reading = latest.kind === 'loading';
  // A failed read says so; it never reads as "no eval yet" or "never run" (agy UX gate, live :7701).
  const unread = ev === null && latest.kind === 'failed';
  const noEval = unread ? 'Couldn’t read the last eval' : 'No eval yet';
  const tiles = (
    <SeStats data-testid="evaluate-tiles">
      <SeStat icon={CircleCheck} tone={blocked > 0 ? 'ok' : 'accent'} label="Caught" testId="evaluate-stat-caught"
        value={ev !== null ? String(ev.summary.caught) : reading ? null : '—'}
        of={ev !== null ? `of ${ev.summary.total}` : undefined}
        // The bad-blocked count leads: a caught figure made only of good samples left alone protects nothing.
        note={ev !== null ? `${blocked} of ${badCount} bad blocked · ${passed} good left alone` : noEval}
        onClick={() => toResults('caught')} />
      <SeStat icon={CircleDashed} tone="warn" label="Gaps" testId="evaluate-stat-gaps"
        value={ev !== null ? String(ev.summary.gaps) : reading ? null : '—'}
        note="Behaviours no rule catches yet" onClick={() => toResults('gap')} />
      <SeStat icon={TriangleAlert} tone={ev === null ? 'accent' : ev.summary.false_positives > 0 ? 'fail' : 'ok'} label="False alarms" testId="evaluate-stat-fp"
        value={ev !== null ? String(ev.summary.false_positives) : reading ? null : '—'}
        // No eval, no claim (codex r1 #4).
        note={ev === null ? noEval : ev.summary.false_positives > 0 ? 'Rules that would block good work today' : 'No rule blocked good work'}
        onClick={() => toResults('false_positive')} />
      <li className="wk-card wk-se-runtile" data-testid="evaluate-run">
        <button data-testid="testing-evals-run" type="button" className="wk-btn wk-btn--primary" disabled={run.kind === 'busy'} onClick={() => void doRun()}>
          {run.kind === 'busy' ? 'Running…' : 'Run evals'}
        </button>
        <span className="wk-se-runtile-line" data-testid="evaluate-last-run">
          {ev !== null
            ? <><span title={absTime(ev.at)}>Last run {relTime(ev.at)}</span>{ev.degraded === 'facet-only' && <> · <span title={EVAL_FACET_MATCH_EXPLANATION}>tags only</span></>}</>
            : reading ? 'Reading the last run…' : unread ? 'Couldn’t read the last run' : 'Never run'}
        </span>
        <button type="button" className="wk-link wk-se-linkbtn" aria-expanded={optionsOpen} data-testid="evaluate-options-toggle" onClick={() => setOptionsOpen((o) => !o)}>
          {optionsOpen ? 'Hide options' : type !== '' || corpus.trim() !== '' ? 'Type and corpus (set for the next run)' : 'Type and corpus'}
        </button>
      </li>
    </SeStats>
  );

  const options = optionsOpen && (
    <div className="wk-card wk-se-options" data-testid="evaluate-options">
      <label className="wk-se-field">
        <span>Steering type</span>
        <select id="evals-steering-type" data-testid="testing-evals-type" className="wk-field" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {STEERING_TYPES.map((t) => <option key={t} value={t}>{STEERING_TYPE_LABELS[t]}</option>)}
        </select>
      </label>
      <label className="wk-se-field wk-se-field--grow">
        <span>Corpus</span>
        <input id="evals-corpus" data-testid="testing-evals-corpus" className="wk-field" value={corpus} onChange={(e) => setCorpus(e.target.value)} placeholder="Built-in sample set" />
        <small>Leave blank for the built-in dev behaviours, or name an imported corpus (evals:&lt;name&gt;).</small>
      </label>
    </div>
  );

  const runNotes = (
    <>
      {run.kind === 'busy' && <p data-testid="testing-evals-busy" className="wk-se-filternote" role="status">Running evals… every sample replays through the same selection a live gate uses.</p>}
      {run.kind === 'unsupported' && <p data-testid="testing-evals-unsupported" className="wk-se-filternote">{TESTING_UNSUPPORTED_COPY}</p>}
      {run.kind === 'failed' && (
        <div data-testid="testing-evals-error">
          <StateBanner kind={readErrorKind(run.error)} what="the eval results"
            error={run.error instanceof Error ? run.error.message : String(run.error)} onRetry={() => void doRun()} />
        </div>
      )}
    </>
  );

  // What the numbers can and cannot say (TESTING.md § What an eval measures; DES-steer-eval §3.2).
  // Said beside the numbers, in plain words, whenever it applies — never folded away.
  const measures = caveats.length > 0 && (
    <section className="wk-card wk-se-caveats" data-testid="evaluate-measures" aria-labelledby="evaluate-measures-title" data-store={store}>
      <h3 id="evaluate-measures-title" className="wk-se-card-title">Read these numbers with this in mind</h3>
      <ul className="wk-se-caveat-list">
        {caveats.map((c) => <li key={c.key} data-testid="evaluate-caveat" data-caveat={c.key}>{c.text}</li>)}
      </ul>
      {store === 'other' && ev !== null && ev.ruleStore !== null && (
        <TechDetails summary="Rule stores" text={`This run: ${ev.ruleStore}\nThis daemon: ${daemonStore ?? 'unknown'}`} />
      )}
    </section>
  );

  const coverageCard = (
    <section className="wk-card wk-se-cov" data-testid="evaluate-coverage" aria-labelledby="evaluate-coverage-title">
      <header className="wk-se-card-head">
        <h3 id="evaluate-coverage-title" className="wk-se-card-title">Coverage by steering type</h3>
        {ev !== null && <span className="wk-se-card-meta">{ev.summary.total} behaviours{ev.corpus !== null ? ` · ${ev.corpus}` : ' · built-in set'}</span>}
      </header>
      {reading ? <Skeleton rows={4} variant="line" /> : coverage.length === 0 ? (
        <p className="wk-se-quiet">{unread ? 'Couldn’t read the last eval; retry above.' : ev === null ? 'Run evals to see which steering types cover their behaviours.' : 'The run carried no per-sample rows.'}</p>
      ) : (
        <>
          <CategoryBars data-testid="evaluate-coverage-chart" rowHeight={36} normalize labelWidth={120} figureWidth={88}
            figure={(row) => { const c = coverage.find((x) => x.type === row.key); return c === undefined ? '' : `${c.blocked} of ${c.bad} bad`; }}
            label="Eval samples per steering type: bad ones blocked, good ones left alone, gaps and false alarms"
            rows={coverage.map((c) => ({ key: c.type, label: STEERING_TYPE_LABELS[c.type], values: { blocked: c.blocked, passed: c.passed, gaps: c.gaps, falsePositives: c.falsePositives } }))}
            series={[
              { key: 'blocked', label: 'Bad, blocked', color: VERDICT_COLOR.blocked },
              { key: 'passed', label: 'Good, left alone', color: VERDICT_COLOR.passed },
              { key: 'gaps', label: 'Gap', color: VERDICT_COLOR.gaps },
              { key: 'falsePositives', label: 'False alarm', color: VERDICT_COLOR.falsePositives },
            ]} />
          <ul className="wk-se-cov-figs" aria-hidden>
            {coverage.map((c) => <li key={c.type}><span>{STEERING_TYPE_LABELS[c.type]}</span><b>{c.blocked} of {c.bad} bad blocked</b></li>)}
          </ul>
        </>
      )}
    </section>
  );

  const shownGaps = allGapTypes ? gapGroups : gapGroups.slice(0, GAP_TYPES_SHOWN);
  const gapsCard = (
    <section className="wk-card wk-se-gaps" data-testid="evaluate-gaps" aria-labelledby="evaluate-gaps-title">
      <header className="wk-se-card-head wk-se-card-head--stack">
        <h3 id="evaluate-gaps-title" className="wk-se-card-title">Gaps to close</h3>
        <span className="wk-se-card-sub">Each gap is a behaviour no rule blocks. Draft rules opens the steering assistant with them written out; you send it.</span>
      </header>
      {reading ? <Skeleton rows={3} variant="line" /> : gapGroups.length === 0 ? (
        <p className="wk-se-quiet" data-testid="evaluate-gaps-none">{unread ? 'Couldn’t read the last eval.' : ev === null ? 'No eval yet.'
          // "Every bad behaviour was blocked" only when there were bad behaviours to block (codex r1 #4).
          : badCount === 0 ? 'No gaps, but this corpus has no bad behaviours, so nothing could be blocked.'
          : 'No gaps. Every bad behaviour in this corpus was blocked.'}</p>
      ) : (
        <>
          <ul className="wk-se-gaplist">
            {shownGaps.map((g) => (
              <li key={g.type} data-testid="evaluate-gap-type" data-steering-type={g.type}>
                <span className="wk-se-gap-name" title={g.gaps.map((x) => x.sample.description).join('\n')}>
                  {STEERING_TYPE_LABELS[g.type]} <span className="wk-se-quiet-sm">· {g.gaps.length} {g.gaps.length === 1 ? 'behaviour' : 'behaviours'}</span>
                </span>
                <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="evaluate-draft" onClick={() => draft(g.type, g.gaps)}>Draft rules</button>
              </li>
            ))}
          </ul>
          <footer className="wk-se-list-foot">
            {gapGroups.length > GAP_TYPES_SHOWN && !allGapTypes
              ? <button type="button" className="wk-link wk-se-linkbtn" onClick={() => setAllGapTypes(true)}>+ {gapGroups.length - GAP_TYPES_SHOWN} more types</button>
              : <span />}
            <button type="button" className="wk-link wk-se-linkbtn" data-testid="evaluate-all-gaps" onClick={() => toResults('gap')}>All gaps →</button>
          </footer>
        </>
      )}
    </section>
  );

  const fCount = (f: ResultFilter): number => (f === 'all' ? results.length : results.filter((r) => r.verdict === f).length);
  const resultsCard = ev !== null && (
    <section id="evaluate-results" className="wk-card wk-se-results" data-testid="testing-evals" aria-labelledby="evaluate-results-title">
      <header className="wk-se-list-head">
        <h3 id="evaluate-results-title" className="wk-se-card-title">Every behaviour</h3>
        <Segmented label="Show" value={filter} onChange={setFilter} data-testid="evaluate-filter"
          options={[
            { value: 'all', label: `All (${fCount('all')})` },
            { value: 'gap', label: `Gaps (${fCount('gap')})` },
            { value: 'false_positive', label: `False alarms (${fCount('false_positive')})` },
            { value: 'caught', label: `Caught (${fCount('caught')})` },
          ]} />
      </header>
      <p data-testid="testing-evals-provenance" className="wk-se-quiet-sm">
        Corpus: {ev.corpus ?? 'built-in sample set'} · {ev.summary.total} sample{ev.summary.total === 1 ? '' : 's'}
        {ev.typeFilter !== null ? ` · ${STEERING_TYPE_LABELS[ev.typeFilter as SteeringType] ?? ev.typeFilter} only` : ''}
      </p>
      <p data-testid="testing-evals-summary" className="wk-visually-hidden">
        {ev.summary.total} samples, {blocked} blocked, {passed} passed, {ev.summary.gaps} uncovered {ev.summary.gaps === 1 ? 'behaviour' : 'behaviours'}, {ev.summary.false_positives} false positives
      </p>
      {ev.degraded === 'facet-only' && (
        <p data-testid="testing-evals-degraded" className="wk-se-filternote"><b>Tags only:</b> {EVAL_FACET_MATCH_EXPLANATION}</p>
      )}
      {results.length === 0 ? (
        <p data-testid="testing-evals-empty" className="wk-se-quiet">The corpus served no samples. Import one below, or run the built-in set.</p>
      ) : rows.length === 0 ? (
        <p className="wk-se-quiet">None in this run.</p>
      ) : (
        <div className="wk-table-wrap">
          <table data-testid="testing-evals-table" className="wk-se-table">
            <thead><tr><th scope="col">Behaviour</th><th scope="col">Type</th><th scope="col">Should</th><th scope="col">Rules that fired</th><th scope="col">Verdict</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const gap = r.verdict === 'gap';
                const open = openId === r.sample.id;
                return (
                  <Fragment key={r.sample.id}>
                    <tr data-testid="testing-evals-row" data-sample-id={r.sample.id} data-verdict={r.verdict}>
                      <td><span className="wk-se-sample">{r.sample.description}</span><span className="wk-se-mono wk-se-quiet-sm">{r.sample.id}</span></td>
                      <td>{STEERING_TYPE_LABELS[r.sample.steering_type as SteeringType] ?? r.sample.steering_type}</td>
                      <td>{r.expected === 'deny' ? 'Be blocked' : 'Go through'}</td>
                      <td className="wk-se-mono">{r.fired.length === 0 ? '—' : r.fired.join(', ')}</td>
                      <td>
                        <span data-testid="testing-evals-verdict-word" className="wk-se-verdict" data-verdict={r.verdict} data-kind={r.sample.kind}>{evalVerdictWord(r)}</span>
                        {gap && (
                          <button type="button" data-testid="testing-evals-gap-toggle" aria-expanded={open} className="wk-link wk-se-linkbtn"
                            onClick={() => setOpenId(open ? null : r.sample.id)}>{open ? 'Hide nearest rules' : 'Nearest rules'}</button>
                        )}
                      </td>
                    </tr>
                    {gap && open && <tr data-testid="testing-evals-gap-detail"><td colSpan={5}><NearestRules result={r} navigate={navigate} foreign={store === 'other'} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const importCard = (
    <section className="wk-card wk-se-import" aria-labelledby="evaluate-import-title" data-testid="evaluate-import">
      <h3 id="evaluate-import-title" className="wk-se-card-title">Bring your own behaviours</h3>
      <p className="wk-se-card-sub">The built-in set is generic. Import a corpus that mirrors your own rules: a JSON list of samples, each good or bad.</p>
      <TechDetails summary="Corpus JSON format" text={'A JSON array of samples, or {name, samples}. Each sample: {id, description, kind: good|bad, steering_type, signals}.'} />
      <label className="wk-se-field">
        <span>Corpus name</span>
        <input id="evals-corpus-name" data-testid="testing-corpus-name" className="wk-field" value={corpusName} onChange={(e) => setCorpusName(e.target.value)} placeholder="Name (optional; the file's name otherwise)" />
      </label>
      <FilePick data-testid="testing-corpus-file" label="Choose a file…" accept=".json,application/json" file={corpusFile}
        onChange={(f) => { setCorpusFile(f); if (f !== null) onCorpusPick(f); }} />
      {imp.kind === 'busy' && <p data-testid="testing-corpus-busy" className="wk-se-quiet-sm" role="status">Importing {imp.filename}…</p>}
      {imp.kind === 'unsupported' && <p data-testid="testing-corpus-unsupported" className="wk-se-filternote">{TESTING_UNSUPPORTED_COPY}</p>}
      {imp.kind === 'failed' && (
        <div data-testid="testing-corpus-error">
          {imp.error instanceof Error && imp.error.message.includes('not an eval corpus') ? (
            <><p className="wk-field-note wk-field-note--bad">That file isn&rsquo;t an eval corpus.</p><TechDetails text={imp.error.message} /></>
          ) : (
            <StateBanner kind={readErrorKind(imp.error)} what="the corpus" error={imp.error instanceof Error ? imp.error.message : String(imp.error)}
              onRetry={() => { if (corpusFile !== null) onCorpusPick(corpusFile); }} />
          )}
        </div>
      )}
      {imp.kind === 'done' && (
        <p data-testid="testing-corpus-summary" className="wk-se-filternote" role="status">
          {imp.filename}: imported {imp.result.imported} sample{imp.result.imported === 1 ? '' : 's'} into <b>{imp.result.scope}</b>
          {imp.result.embedded ? ' (embedded)' : ' · tags only'}. It is set as the corpus for the next run.
        </p>
      )}
    </section>
  );

  return (
    <div className="wk-se" data-testid="evaluate-surface">
      <div className="wk-se-scroll">
        {title !== undefined && (
          <header className="wk-se-head">
            <h1 className="wk-se-title">{title}</h1>
            {intro !== undefined && <p className="wk-se-intro">{intro}</p>}
          </header>
        )}
        {tiles}
        {options}
        {runNotes}
        {latest.kind === 'failed' && (
          <StateBanner data-testid="evaluate-read-error" kind={readErrorKind(latest.error)} what="the last eval"
            error={latest.error instanceof Error ? latest.error.message : String(latest.error)} onRetry={latest.reload} />
        )}
        {latest.kind === 'ok' && latest.refreshError !== undefined && (
          <p className="wk-se-filternote" data-tone="fail" data-testid="evaluate-refresh-failed" role="status">
            Couldn&rsquo;t refresh the eval history; these are the last results read. <button type="button" className="wk-link wk-se-x" onClick={latest.reload}>Try again</button>
          </p>
        )}
        {latest.kind === 'unavailable' && <p className="wk-se-filternote" data-testid="evaluate-unavailable">This crew keeps no eval history; a run made here still shows its results.</p>}
        {measures}
        <div className="wk-se-row wk-se-row--cov">
          {coverageCard}
          {gapsCard}
        </div>
        {resultsCard}
        <div className="wk-se-row wk-se-row--2">
          {importCard}
          <section className="wk-card wk-se-history" aria-label="Run history"><EvalHistory refreshKey={historyKey} daemonStore={daemonStore ?? null} /></section>
        </div>
      </div>
    </div>
  );
}
