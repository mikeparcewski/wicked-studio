import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { rulePath } from '../../api/decisions.js';
import { readErrorKind } from '../../api/errors.js';
import { policiesPath, STEERING_TYPE_LABELS, STEERING_TYPES, type SteeringRule, type SteeringType } from '../../api/steering.js';
import {
  getEvalRun,
  importEvalCorpus,
  isTestingUnsupported,
  runEvals,
  TESTING_UNSUPPORTED_COPY,
  type CorpusImportResult,
  type EvalResult,
  type EvalSample,
} from '../../api/testing.js';
import { draftRequest, evalCaveats, gapsByType, historyStores, storeMatch, typeRows, type EvalSource, type TypeRow } from '../../board/evalModel.js';
import { absTime, relTime } from '../../board/relTime.js';
import { steerTotals } from '../../board/steerModel.js';
import { useDaemonRuleStore } from '../../hooks/useDaemonRuleStore.js';
import { useLatestEval } from '../../hooks/useLatestEval.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useEvalReportStore } from '../../store/evalReport.js';
import { useSteerDraft } from '../../store/steerDraft.js';
import { EVAL_FACET_MATCH_EXPLANATION, EvalHistory } from '../EvalHistory.js';
import { readFileText } from '../fileText.js';
import { FilePick, Segmented, Skeleton, StateBanner, TechDetails } from '../ui/index.js';
import { SystemJudgments } from './SystemJudgments.js';

/**
 * EVALUATE (the calm page; desk-pages-redesign mockup, operator 2026-10-26: "needs more whitespace,
 * easy to scan … think humans, we get overwhelmed easy"). Replays good and bad behaviours against the
 * steering rules (TESTING.md) and reads the verdicts by steering type:
 *
 *  - the title, one sentence and ONE action, Run an evaluation;
 *  - Last results: one roomy row per steering type (what was blocked, what slipped through, what was
 *    blocked by mistake, in words; when it ran; a status colour), and what the numbers can't say;
 *  - a row opens that type's detail: its numbers, its gaps with Draft rules (the steering assistant
 *    opens on Steer with the uncovered behaviours typed in; the operator sends it), and every
 *    behaviour with its verdict and nearest rules. "See every behaviour" opens all types at once;
 *  - folded away: what to run (type and corpus), bringing your own behaviours, and past runs.
 *
 * The two writes (`POST /testing/evals/run`, `POST /testing/corpora/import`) are the ones the page
 * always had.
 */

/** The verdict word, split by what "caught" meant: a BAD sample blocked, a GOOD sample left alone. */
export function evalVerdictWord(r: { verdict: EvalResult['verdict']; sample: { kind: string } }): string {
  if (r.verdict === 'gap') return 'gap';
  if (r.verdict === 'false_positive') return 'false alarm';
  return r.sample.kind === 'bad' ? 'blocked' : r.sample.kind === 'good' ? 'left alone' : 'caught';
}

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
type Open = SteeringType | 'all' | null;

const SENTENCE = 'Check your steering rules against real agent behaviour.';

/** A rule as a person reads it: its statement when this daemon has the rule, else its name. */
function ruleWords(id: string, rules: ReadonlyMap<string, SteeringRule>): string {
  return rules.get(id)?.statement ?? id;
}

function NearestRules({ result, navigate, foreign, rules }: {
  result: EvalResult;
  navigate: Navigate;
  /** The run was judged against another rule store: its rule ids name THAT store's rules, so they
   *  are not links into this daemon's (an id can match a different rule here) (codex r4 #1). */
  foreign: boolean;
  rules: ReadonlyMap<string, SteeringRule>;
}): React.ReactElement {
  const nearest = result.nearest_rules ?? [];
  return (
    <div data-testid="testing-evals-nearest" className="wk-se-nearest">
      <span className="wk-se-nearest-title">Nearest rules: how close recall came to the right one</span>
      {foreign && nearest.length > 0 && <span className="wk-se-quiet-sm">These are rules in the other rule store this run was judged against, not this daemon&rsquo;s.</span>}
      {nearest.length === 0 ? (
        <span data-testid="testing-evals-nearest-empty" className="wk-se-quiet-sm">No nearby rules: nothing in force is close to this behaviour. It needs a new rule.</span>
      ) : nearest.map((n) => (
        <span key={n.rule_id} data-testid="testing-evals-nearest-rule" className="wk-se-nearest-row">
          {foreign ? (
            <span data-testid="testing-evals-nearest-foreign" data-rule-id={n.rule_id} title="A rule in the other rule store this run was judged against">{n.rule_id}</span>
          ) : (
            <a data-testid="testing-evals-nearest-link" data-rule-id={n.rule_id} href={rulePath(n.rule_id)} className="wk-ue-link"
              onClick={(e) => { e.preventDefault(); navigate(rulePath(n.rule_id)); }}>{ruleWords(n.rule_id, rules)}</a>
          )}
          <span className="wk-se-quiet-sm">similarity {n.similarity.toFixed(2)}</span>
        </span>
      ))}
    </div>
  );
}

/** The run's settings and the import, folded under the list: a roomy summary row with a chevron. */
function Fold({ title, sub, testId, toggleId, open, onToggle, children }: { title: string; sub: string; testId: string; toggleId: string; open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }): React.ReactElement {
  return (
    <details className="wk-ue-fold" data-testid={testId} open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) onToggle(o); }}>
      <summary className="wk-ue-fold-sum" data-testid={toggleId}>
        <span className="wk-ue-fold-words"><span className="wk-ue-fold-title">{title}</span><span className="wk-ue-fold-sub">{sub}</span></span>
        <ChevronRight size={18} aria-hidden className="wk-ue-fold-chev" />
      </summary>
      <div className="wk-ue-fold-body">{children}</div>
    </details>
  );
}

export function EvaluateSurface({ navigate, title = 'Evaluate', intro = SENTENCE }: {
  navigate: Navigate;
  title?: string;
  intro?: string;
}): React.ReactElement {
  const [historyKey, setHistoryKey] = useState(0);
  const latest = useLatestEval(historyKey);
  const [rules, setRules] = useState<SteeringRule[] | null>(null);
  useEffect(() => { void api.listConformanceRules().then(({ rules: rs }) => setRules(rs as SteeringRule[])).catch(() => setRules(null)); }, []);
  const ruleMap = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r])), [rules]);

  // ── Run ──────────────────────────────────────────────────────────────────────────────────────
  const [type, setType] = useState('');
  const [corpus, setCorpus] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
      // The next run targets what just landed: the run settings open so the operator sees where it went.
      .then((result) => { setImp({ kind: 'done', filename: file.name, result }); setCorpusFile(null); setCorpus(result.scope); setOptionsOpen(true); })
      .catch((e: unknown) => setImp(isTestingUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', error: e }));
  };

  // ── The latest run, and the newest all-types run behind a run limited to one type ────────────
  const ev = latest.kind === 'ok' ? latest.eval : null;
  const history = latest.kind === 'ok' ? latest.history : [];
  const olderAll = ev !== null && ev.typeFilter !== null ? history.find((h) => h.id !== ev.id && h.type_filter === null && h.created_at * 1000 <= ev.at) ?? null : null;
  const [older, setOlder] = useState<EvalSource | null>(null);
  useEffect(() => {
    if (olderAll === null) { setOlder(null); return undefined; }
    let live = true;
    getEvalRun(olderAll.id).then((d) => {
      if (live) setOlder({ at: olderAll.created_at * 1000, corpus: olderAll.corpus, typeFilter: null, degraded: (d as { degraded?: 'facet-only' | null }).degraded ?? null, results: d.results as unknown as EvalResult[], id: olderAll.id, ruleStore: olderAll.rule_store ?? null });
    }, () => { if (live) setOlder(null); });
    return () => { live = false; };
  }, [olderAll?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const source: EvalSource | null = ev === null ? null : { at: ev.at, corpus: ev.corpus, typeFilter: ev.typeFilter, degraded: ev.degraded, results: ev.results, id: ev.id, ruleStore: ev.ruleStore };
  const rows = useMemo(() => (source === null ? [] : typeRows(source, older)), [source?.id, source?.at, older]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useMemo(() => ev?.results ?? [], [ev]);
  const blocked = results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'bad').length;
  const passed = results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'good').length;
  const totals = rules !== null ? steerTotals(rules) : null;
  const daemonStore = useDaemonRuleStore();
  const store = ev !== null ? storeMatch(ev.ruleStore, daemonStore) : 'unknown';
  const caveats = ev === null ? [] : evalCaveats({
    summary: ev.summary, results, totals, store,
    history: history.length > 0 && daemonStore != null ? historyStores(history, daemonStore) : null,
  });

  const [open, setOpen] = useState<Open>(null);
  const reading = latest.kind === 'loading';
  // A failed read says so; it never reads as "no eval yet" or "never run" (agy UX gate, live :7701).
  const unread = ev === null && latest.kind === 'failed';

  const draft = (t: SteeringType, gaps: readonly EvalResult[]): void => {
    useSteerDraft.getState().put(t, draftRequest(t, gaps));
    navigate(policiesPath(t));
  };

  const lastRun = (
    <span data-testid="evaluate-last-run">
      {ev !== null
        ? <><span title={absTime(ev.at)}>Last run {relTime(ev.at)}</span>{ev.degraded === 'facet-only' && <> · <span title={EVAL_FACET_MATCH_EXPLANATION}>tags only</span></>}</>
        : reading ? 'Reading the last run…' : unread ? 'Couldn’t read the last run' : 'Never run'}
    </span>
  );

  const runNotes = (
    <>
      {run.kind === 'busy' && <p data-testid="testing-evals-busy" className="wk-ue-note" role="status">Running… every behaviour replays through the same rule selection a live gate uses.</p>}
      {run.kind === 'unsupported' && <p data-testid="testing-evals-unsupported" className="wk-ue-note">{TESTING_UNSUPPORTED_COPY}</p>}
      {run.kind === 'failed' && (
        <div data-testid="testing-evals-error">
          <StateBanner kind={readErrorKind(run.error)} what="the eval results"
            error={run.error instanceof Error ? run.error.message : String(run.error)} onRetry={() => void doRun()} />
        </div>
      )}
      {latest.kind === 'failed' && (
        <StateBanner data-testid="evaluate-read-error" kind={readErrorKind(latest.error)} what="the last eval"
          error={latest.error instanceof Error ? latest.error.message : String(latest.error)} onRetry={latest.reload} />
      )}
      {latest.kind === 'ok' && latest.refreshError !== undefined && (
        <p className="wk-ue-note" data-tone="fail" data-testid="evaluate-refresh-failed" role="status">
          Couldn&rsquo;t refresh the eval history; these are the last results read. <button type="button" className="wk-ue-linkbtn" onClick={latest.reload}>Try again</button>
        </p>
      )}
      {latest.kind === 'unavailable' && <p className="wk-ue-note" data-testid="evaluate-unavailable">This crew keeps no eval history; a run made here still shows its results.</p>}
    </>
  );

  // The engine's own words, kept for screen readers and the journeys that read the run back.
  const summaryLine = ev !== null && (
    <p data-testid="testing-evals-summary" className="wk-visually-hidden">
      {ev.summary.total} samples, {blocked} blocked, {passed} passed, {ev.summary.gaps} uncovered {ev.summary.gaps === 1 ? 'behaviour' : 'behaviours'}, {ev.summary.false_positives} false positives
    </p>
  );

  const runButton = (
    <button data-testid="testing-evals-run" type="button" className="wk-ue-btn wk-ue-btn--primary" disabled={run.kind === 'busy'} onClick={() => void doRun()}>
      {run.kind === 'busy' ? 'Running…' : 'Run an evaluation'}
    </button>
  );

  if (open !== null && ev !== null) {
    return (
      <TypeDetail open={open} rows={rows} latest={source!} navigate={navigate} rules={ruleMap} daemonStore={daemonStore ?? null}
        onBack={() => setOpen(null)} onDraft={draft} runNotes={runNotes} summaryLine={summaryLine} />
    );
  }

  const settingsWords = `${type === '' ? 'All steering types' : `${STEERING_TYPE_LABELS[type as SteeringType] ?? type} only`} · ${corpus.trim() === '' ? 'the built-in behaviours' : corpus.trim()}`;

  return (
    <div className="wk-ue" data-testid="evaluate-surface">
      <div className="wk-ue-col">
        <header className="wk-ue-head">
          <div className="wk-ue-head-words">
            <h1 className="wk-ue-title">{title}</h1>
            <p className="wk-ue-sentence">{intro}</p>
          </div>
          <div className="wk-ue-head-acts">{runButton}</div>
        </header>
        {runNotes}
        {summaryLine}

        <section className="wk-ue-sec" aria-labelledby="evaluate-results-title" data-testid="evaluate-results">
          <div className="wk-ue-sec-head">
            <h2 id="evaluate-results-title" className="wk-ue-label">Last results</h2>
            <span className="wk-ue-note">{lastRun}</span>
          </div>
          {reading ? (
            <div aria-busy="true" data-testid="evaluate-results-loading"><Skeleton rows={3} variant="row" /></div>
          ) : ev === null ? (
            <p className="wk-ue-quiet" data-testid="evaluate-results-empty">
              {unread ? 'Couldn’t read the last evaluation. Try again above.' : 'No evaluation yet. Run one to see, for each kind of rule, which bad behaviours it blocks and which slip through.'}
            </p>
          ) : results.length === 0 ? (
            <p className="wk-ue-quiet" data-testid="testing-evals-empty">The last run had no behaviours to replay. Bring your own below, or run the built-in set.</p>
          ) : (
            <>
              <ul className="wk-ue-rows" aria-label="Last results by steering type">
                {rows.map((r) => (
                  <li key={r.type}>
                    <button type="button" className="wk-ue-row" data-testid="evaluate-type-row" data-steering-type={r.type} data-tone={r.tone} onClick={() => setOpen(r.type)}>
                      <span className="wk-ue-dot" data-tone={r.tone} aria-hidden />
                      <span className="wk-ue-row-main">
                        <span className="wk-ue-row-title">{STEERING_TYPE_LABELS[r.type]} rules</span>
                        <span className="wk-ue-row-sub" data-testid="evaluate-type-words">{r.words}</span>
                      </span>
                      <span className="wk-ue-row-meta" data-tone={r.tone === 'fail' || r.tone === 'warn' ? r.tone : undefined} title={absTime(r.source.at)}>{relTime(r.source.at)}</span>
                      <ChevronRight size={18} aria-hidden className="wk-ue-row-go" />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="wk-ue-linkbtn wk-ue-back" data-testid="evaluate-all-behaviours" onClick={() => setOpen('all')}>
                See every behaviour in the last run ({results.length})
              </button>
            </>
          )}
          {ev?.degraded === 'facet-only' && <p data-testid="testing-evals-degraded" className="wk-ue-note"><b>Tags only:</b> {EVAL_FACET_MATCH_EXPLANATION}</p>}
        </section>

        {/* What the numbers can and cannot say (TESTING.md § What an eval measures): beside them, never folded away. */}
        {caveats.length > 0 && (
          <section className="wk-ue-sec" data-testid="evaluate-measures" aria-labelledby="evaluate-measures-title" data-store={store}>
            <h2 id="evaluate-measures-title" className="wk-ue-label">Read these numbers with this in mind</h2>
            <ul className="wk-ue-caveats">
              {caveats.map((c) => <li key={c.key} data-testid="evaluate-caveat" data-caveat={c.key} className="wk-ue-note">{c.text}</li>)}
            </ul>
            {store === 'other' && ev !== null && ev.ruleStore !== null && (
              <TechDetails summary="Rule stores" text={`This run: ${ev.ruleStore}\nThis daemon: ${daemonStore ?? 'unknown'}`} />
            )}
          </section>
        )}

        <SystemJudgments />

        <div className="wk-ue-folds">
          <Fold title="What to run" sub={settingsWords} testId="evaluate-options" toggleId="evaluate-options-toggle" open={optionsOpen} onToggle={setOptionsOpen}>
            <div className="wk-ue-fields">
              <label className="wk-ue-field">
                <span>Steering type</span>
                <select id="evals-steering-type" data-testid="testing-evals-type" className="wk-field" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">All types</option>
                  {STEERING_TYPES.map((t) => <option key={t} value={t}>{STEERING_TYPE_LABELS[t]}</option>)}
                </select>
              </label>
              <label className="wk-ue-field">
                <span>Behaviours</span>
                <input id="evals-corpus" data-testid="testing-evals-corpus" className="wk-field" value={corpus} onChange={(e) => setCorpus(e.target.value)} placeholder="The built-in behaviours" />
                <small>Leave blank for the built-in set, or name one you brought (evals:&lt;name&gt;).</small>
              </label>
            </div>
          </Fold>
          <Fold title="Bring your own behaviours" sub="The built-in set is generic. Import behaviours that mirror your own rules." testId="evaluate-import" toggleId="evaluate-import-toggle" open={importOpen} onToggle={setImportOpen}>
            <p className="wk-ue-note">A JSON list of samples, each good or bad. It is set as the behaviours for the next run.</p>
            <TechDetails summary="The file’s format" text={'A JSON array of samples, or {name, samples}. Each sample: {id, description, kind: good|bad, steering_type, signals}.'} />
            <label className="wk-ue-field">
              <span>Name</span>
              <input id="evals-corpus-name" data-testid="testing-corpus-name" className="wk-field" value={corpusName} onChange={(e) => setCorpusName(e.target.value)} placeholder="Optional; the file's name otherwise" />
            </label>
            <FilePick data-testid="testing-corpus-file" label="Choose a file…" accept=".json,application/json" file={corpusFile}
              onChange={(f) => { setCorpusFile(f); if (f !== null) onCorpusPick(f); }} />
            {imp.kind === 'busy' && <p data-testid="testing-corpus-busy" className="wk-ue-note" role="status">Importing {imp.filename}…</p>}
            {imp.kind === 'unsupported' && <p data-testid="testing-corpus-unsupported" className="wk-ue-note">{TESTING_UNSUPPORTED_COPY}</p>}
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
              <p data-testid="testing-corpus-summary" className="wk-ue-note" role="status">
                {imp.filename}: imported {imp.result.imported} sample{imp.result.imported === 1 ? '' : 's'} into <b>{imp.result.scope}</b>
                {imp.result.embedded ? ' (embedded)' : ' · tags only'}. It is set as the behaviours for the next run.
              </p>
            )}
          </Fold>
          <Fold title="Past runs" sub={history.length > 0 ? `${history.length} ${history.length === 1 ? 'run' : 'runs'} saved` : 'Every evaluation is saved here.'} testId="evaluate-history" toggleId="evaluate-history-toggle" open={historyOpen} onToggle={setHistoryOpen}>
            <EvalHistory refreshKey={historyKey} daemonStore={daemonStore ?? null} />
          </Fold>
        </div>
      </div>
    </div>
  );
}

/** One steering type's detail (or every behaviour): its numbers, its gaps to close, and its behaviours. */
function TypeDetail({ open, rows, latest, navigate, rules, daemonStore, onBack, onDraft, runNotes, summaryLine }: {
  open: SteeringType | 'all';
  rows: readonly TypeRow[];
  latest: EvalSource;
  navigate: Navigate;
  rules: ReadonlyMap<string, SteeringRule>;
  daemonStore: string | null;
  onBack: () => void;
  onDraft: (t: SteeringType, gaps: readonly EvalResult[]) => void;
  runNotes: React.ReactNode;
  summaryLine: React.ReactNode;
}): React.ReactElement {
  const row = open === 'all' ? null : rows.find((r) => r.type === open) ?? null;
  const src = row?.source ?? latest;
  const results = useMemo(() => (open === 'all' ? [...src.results] : src.results.filter((r) => r.sample.steering_type === open)), [open, src]);
  const gapGroups = useMemo(() => gapsByType(results), [results]);
  const bad = results.filter((r) => r.sample.kind === 'bad').length;
  const blocked = results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'bad').length;
  const passed = results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'good').length;
  const gaps = results.filter((r) => r.verdict === 'gap').length;
  const fps = results.filter((r) => r.verdict === 'false_positive').length;
  const foreign = storeMatch(src.ruleStore, daemonStore) === 'other';
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = results.filter((r) => filter === 'all' || r.verdict === filter);
  const fCount = (f: ResultFilter): number => (f === 'all' ? results.length : results.filter((r) => r.verdict === f).length);
  const name = open === 'all' ? 'Every behaviour' : `${STEERING_TYPE_LABELS[open]} rules`;

  return (
    <div className="wk-ue" data-testid="evaluate-surface">
      <div className="wk-ue-col" data-testid="evaluate-detail" data-steering-type={open}>
        <button type="button" className="wk-ue-linkbtn wk-ue-back" data-testid="evaluate-back" onClick={onBack}><ArrowLeft size={15} aria-hidden /> All results</button>
        <header className="wk-ue-head">
          <div className="wk-ue-head-words">
            <h1 className="wk-ue-title">{name}</h1>
            <p className="wk-ue-sentence">{row?.words ?? `${results.length} behaviours replayed against every steering type.`}</p>
            <p data-testid="testing-evals-provenance" className="wk-ue-note">
              <span title={absTime(src.at)}>Ran {relTime(src.at)}</span> · Corpus: {src.corpus ?? 'built-in sample set'} · {results.length} sample{results.length === 1 ? '' : 's'}
              {src.typeFilter !== null ? ` · ${STEERING_TYPE_LABELS[src.typeFilter as SteeringType] ?? src.typeFilter} only` : ''}
            </p>
          </div>
        </header>
        {runNotes}
        {summaryLine}
        {src.degraded === 'facet-only' && <p data-testid="testing-evals-degraded" className="wk-ue-note"><b>Tags only:</b> {EVAL_FACET_MATCH_EXPLANATION}</p>}

        <ul className="wk-ue-stats" data-testid="evaluate-tiles">
          <li className="wk-ue-stat" data-testid="evaluate-stat-caught"><span className="wk-ue-stat-v">{blocked} of {bad}</span><span className="wk-ue-stat-k">bad behaviours blocked · {passed} good left alone</span></li>
          <li className="wk-ue-stat" data-testid="evaluate-stat-gaps"><span className="wk-ue-stat-v">{gaps}</span><span className="wk-ue-stat-k">{gaps === 1 ? 'gap' : 'gaps'}: no rule catches {gaps === 1 ? 'it' : 'them'} yet</span></li>
          <li className="wk-ue-stat" data-testid="evaluate-stat-fp"><span className="wk-ue-stat-v">{fps}</span><span className="wk-ue-stat-k">{fps === 0 ? 'false alarms: no rule blocked good work' : fps === 1 ? 'false alarm: a rule would block good work' : 'false alarms: rules would block good work'}</span></li>
        </ul>

        <section className="wk-ue-sec" data-testid="evaluate-gaps" aria-labelledby="evaluate-gaps-title">
          <h2 id="evaluate-gaps-title" className="wk-ue-label">Gaps to close</h2>
          {gapGroups.length === 0 ? (
            <p className="wk-ue-quiet" data-testid="evaluate-gaps-none">
              {bad === 0 ? 'No gaps, but this set has no bad behaviours, so nothing could be blocked.' : 'No gaps. Every bad behaviour here was blocked.'}
            </p>
          ) : (
            <>
              <p className="wk-ue-note">Each gap is a bad behaviour no rule blocks. Draft rules opens the steering assistant with them written out; you send it.</p>
              <ul className="wk-ue-rows">
                {gapGroups.map((g) => (
                  <li key={g.type} className="wk-ue-repo" data-testid="evaluate-gap-type" data-steering-type={g.type}>
                    <span className="wk-ue-row-main">
                      <span className="wk-ue-row-title">{STEERING_TYPE_LABELS[g.type]}</span>
                      <span className="wk-ue-row-sub">{g.gaps.length} {g.gaps.length === 1 ? 'behaviour' : 'behaviours'} not covered: {g.gaps.map((x) => x.sample.description).join('; ')}</span>
                    </span>
                    <button type="button" className="wk-ue-btn wk-ue-btn--secondary wk-ue-btn--sm" data-testid="evaluate-draft" onClick={() => onDraft(g.type, g.gaps)}>Draft rules</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="wk-ue-sec" data-testid="testing-evals" aria-labelledby="evaluate-every-title">
          <div className="wk-ue-sec-head">
            <h2 id="evaluate-every-title" className="wk-ue-label">Every behaviour</h2>
            <Segmented label="Show" value={filter} onChange={setFilter} data-testid="evaluate-filter"
              options={[
                { value: 'all', label: `All (${fCount('all')})` },
                { value: 'gap', label: `Gaps (${fCount('gap')})` },
                { value: 'false_positive', label: `False alarms (${fCount('false_positive')})` },
                { value: 'caught', label: `Caught (${fCount('caught')})` },
              ]} />
          </div>
          {results.length === 0 ? (
            <p data-testid="testing-evals-empty" className="wk-ue-quiet">The run had no behaviours to replay.</p>
          ) : shown.length === 0 ? (
            <p className="wk-ue-quiet">None in this run.</p>
          ) : (
            <ul className="wk-ue-list" data-testid="testing-evals-table">
              {shown.map((r) => {
                const gap = r.verdict === 'gap';
                const isOpen = openId === r.sample.id;
                return (
                  <li key={r.sample.id} className="wk-ue-behaviour" data-testid="testing-evals-row" data-sample-id={r.sample.id} data-verdict={r.verdict}>
                    <span className="wk-ue-behaviour-top">
                      <span className="wk-ue-behaviour-title">{r.sample.description}</span>
                      <span data-testid="testing-evals-verdict-word" className="wk-ue-verdict" data-verdict={r.verdict} data-kind={r.sample.kind}>{evalVerdictWord(r)}</span>
                    </span>
                    <span className="wk-ue-behaviour-line">
                      {open === 'all' && <>{STEERING_TYPE_LABELS[r.sample.steering_type as SteeringType] ?? r.sample.steering_type} · </>}
                      {r.expected === 'deny' ? 'Should be blocked' : 'Should go through'} · {r.fired.length === 0 ? 'Rules that fired: —' : `Rules that fired: ${r.fired.map((id) => ruleWords(id, rules)).join('; ')}`}
                    </span>
                    {gap && (
                      <button type="button" data-testid="testing-evals-gap-toggle" aria-expanded={isOpen} className="wk-ue-linkbtn wk-ue-back"
                        onClick={() => setOpenId(isOpen ? null : r.sample.id)}>{isOpen ? 'Hide nearest rules' : 'Nearest rules'}</button>
                    )}
                    {gap && isOpen && <div data-testid="testing-evals-gap-detail"><NearestRules result={r} navigate={navigate} foreign={foreign} rules={rules} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
