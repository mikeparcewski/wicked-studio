import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  getDefaultEvalReport,
  isDefaultEvalsAbsent,
  listDefaultEvalRuns,
  runDefaultEvals,
  type DefaultEvalReport,
} from '../../api/defaultEvals.js';
import { readErrorKind } from '../../api/errors.js';
import { driftLines, judgeRow, judgeSentence } from '../../board/defaultEvalModel.js';
import { absTime, relTime } from '../../board/relTime.js';
import { Skeleton, StateBanner } from '../ui/index.js';

/**
 * "How well the system judges" on the calm Evaluate page (DES-DEFAULT-EVALS-001 §7). Crew scores the system's own
 * judgments (what needs you, floor decisions, QE verdicts, who built it, steering firing, recall, prompt routing,
 * and normalizing) against what really happened in this daemon's runs. One roomy row per suite; a row opens its
 * detail. Too few cases never reads as a rate, and real and synthetic cases are always named apart.
 *
 * One write: Check now (`POST /testing/default-evals/run`), which reads the run store and keeps the report.
 */

type Load =
  | { kind: 'loading' }
  | { kind: 'absent' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'ok'; report: DefaultEvalReport | null };

export function SystemJudgments(): React.ReactElement {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<unknown>(null);
  const [scope, setScope] = useState<string>('all');
  const [baseline, setBaseline] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const read = useCallback(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    listDefaultEvalRuns()
      .then(async (runs) => {
        const newest = runs[0];
        const report = newest !== undefined ? await getDefaultEvalReport(newest.id) : null;
        if (live) setLoad({ kind: 'ok', report });
      })
      .catch((e: unknown) => {
        if (live) setLoad(isDefaultEvalsAbsent(e) ? { kind: 'absent' } : { kind: 'failed', error: e });
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => read(), [read]);

  const report = load.kind === 'ok' ? load.report : null;
  const rows = useMemo(() => (report === null ? [] : report.suites.map(judgeRow)), [report]);
  const drift = useMemo(() => driftLines(report?.drift ?? []), [report]);
  const projects = useMemo(() => {
    const s = new Set<string>();
    for (const suite of report?.suites ?? []) for (const p of Object.keys(suite.byProject ?? {})) s.add(p);
    if (report?.project != null) s.add(report.project);
    return [...s].sort();
  }, [report]);

  const check = (): void => {
    setBusy(true);
    setRunError(null);
    runDefaultEvals({ ...(scope !== 'all' ? { project: scope } : {}), ...(baseline ? { baseline: true } : {}) })
      .then((r) => setLoad({ kind: 'ok', report: r }))
      .catch((e: unknown) => setRunError(e))
      .finally(() => setBusy(false));
  };

  if (load.kind === 'absent') {
    return (
      <section className="wk-ue-sec" data-testid="evaluate-judgments" aria-labelledby="evaluate-judgments-title">
        <h2 id="evaluate-judgments-title" className="wk-ue-label">How well the system judges</h2>
        <p className="wk-ue-quiet" data-testid="evaluate-judgments-absent">This crew does not score its own judgments yet (it needs a crew with the default evals).</p>
      </section>
    );
  }

  return (
    <section className="wk-ue-sec" data-testid="evaluate-judgments" aria-labelledby="evaluate-judgments-title">
      <div className="wk-ue-sec-head">
        <h2 id="evaluate-judgments-title" className="wk-ue-label">How well the system judges</h2>
        <span className="wk-ue-note" data-testid="evaluate-judgments-when">
          {report !== null ? <span title={absTime(Date.parse(report.createdAt))}>Checked {relTime(Date.parse(report.createdAt))}</span> : load.kind === 'loading' ? 'Reading…' : 'Never checked'}
        </span>
      </div>
      <p className="wk-ue-note">
        What needs you, floor decisions, QE verdicts and who built the work, each checked against what really happened in your runs.
        {report !== null && <> <span data-testid="evaluate-judgments-sentence">{judgeSentence(report)}</span></>}
      </p>

      {load.kind === 'failed' && (
        <StateBanner data-testid="evaluate-judgments-error" kind={readErrorKind(load.error)} what="the last check"
          error={load.error instanceof Error ? load.error.message : String(load.error)} onRetry={read} />
      )}
      {runError !== null && (
        <StateBanner data-testid="evaluate-judgments-run-error" kind={readErrorKind(runError)} what="the check"
          error={runError instanceof Error ? runError.message : String(runError)} onRetry={check} />
      )}

      {load.kind === 'loading' ? (
        <div aria-busy="true"><Skeleton rows={3} variant="row" /></div>
      ) : report === null ? (
        <p className="wk-ue-quiet" data-testid="evaluate-judgments-empty">Not checked yet. Check now to score the system’s judgments against your own runs.</p>
      ) : (
        <ul className="wk-ue-rows" aria-label="How well the system judges, by kind of judgment">
          {rows.map((r) => (
            <li key={r.suite}>
              <button type="button" className="wk-ue-row" data-testid="evaluate-judgment-row" data-suite={r.suite} data-tone={r.tone}
                aria-expanded={open === r.suite} onClick={() => setOpen(open === r.suite ? null : r.suite)}>
                <span className="wk-ue-dot" data-tone={r.tone} aria-hidden />
                <span className="wk-ue-row-main">
                  <span className="wk-ue-row-title">{r.name}</span>
                  <span className="wk-ue-row-sub" data-testid="evaluate-judgment-words">{r.words}{r.split !== '' ? ` · ${r.split}` : ''}</span>
                </span>
                {r.trend !== null && <span className="wk-ue-row-meta" data-tone={r.trend.startsWith('Worse') ? 'fail' : undefined} data-testid="evaluate-judgment-trend">{r.trend}</span>}
                <ChevronRight size={18} aria-hidden className="wk-ue-row-go" />
              </button>
              {open === r.suite && r.detail.length > 0 && (
                <ul className="wk-ue-caveats wk-ue-judge-detail" data-testid="evaluate-judgment-detail">
                  {r.detail.map((line) => <li key={line} className="wk-ue-note">{line}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {report !== null && report.drift.length > 0 && (
        <details className="wk-ue-fold" data-testid="evaluate-judgments-drift">
          <summary className="wk-ue-fold-sum">
            <span className="wk-ue-fold-words">
              <span className="wk-ue-fold-title">Judged differently by place</span>
              <span className="wk-ue-fold-sub">{report.drift.length} {report.drift.length === 1 ? 'input was' : 'inputs were'} judged one way in one place and another way elsewhere.</span>
            </span>
            <ChevronRight size={18} aria-hidden className="wk-ue-fold-chev" />
          </summary>
          <div className="wk-ue-fold-body">
            <ul className="wk-ue-caveats">{drift.lines.map((line) => <li key={line} className="wk-ue-note" data-testid="evaluate-drift-line">{line}</li>)}</ul>
            {drift.more > 0 && <p className="wk-ue-note" data-testid="evaluate-drift-more">And {drift.more} more of the same kind.</p>}
          </div>
        </details>
      )}

      <div className="wk-ue-fields">
        <label className="wk-ue-field">
          <span>Check</span>
          <select data-testid="evaluate-judgments-scope" className="wk-field" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Every project, and compare them</option>
            {projects.map((p) => <option key={p} value={p}>{p} only</option>)}
          </select>
        </label>
        <label className="wk-ue-field">
          <span><input type="checkbox" data-testid="evaluate-judgments-baseline" checked={baseline} onChange={(e) => setBaseline(e.target.checked)} /> Also count the shipped baseline</span>
          <small>Adds the 2026-10-27 test rig’s cases to your own, and says how many. Off, the numbers are your runs only.</small>
        </label>
      </div>
      <div className="wk-ue-judge-acts">
        <button type="button" className="wk-ue-btn wk-ue-btn--secondary" data-testid="evaluate-judgments-check" disabled={busy} onClick={check}>
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
    </section>
  );
}
