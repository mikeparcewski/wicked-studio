import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { getDefaultEvalReport, listDefaultEvalRuns, type DefaultEvalSuiteScore } from '../../api/defaultEvals.js';
import { STEERING_TYPE_LABELS, STEERING_TYPES, type SteeringType } from '../../api/steering.js';
import { importEvalCorpus, isTestingUnsupported, TESTING_UNSUPPORTED_COPY, type CorpusImportResult } from '../../api/testing.js';
import type { EvalRunSummary, SessionView } from '../../api/types.js';
import { behavioursFromJob, corpusName, evalRecommendations, pastRunPills, pastRunTitle, samplesOf, splitTranscript, type BehaviourDraft, type EvalRec } from '../../board/evalPlan.js';
import { jobTitle } from '../../board/deskWords.js';
import { absTime, relTime } from '../../board/relTime.js';
import { Skeleton } from '../ui/index.js';

/**
 * EVALUATE's plan (DES-LEARN §5; mockup learn-and-panels state e): Recommended to run (each with why), Bring your
 * own behaviours (a file, a pasted transcript, a past job), and Past runs, each with "Analyze this run". The writes
 * are the page's own: run an evaluation, import a set of behaviours. Nothing here launches by itself.
 */

// ── Recommended to run ─────────────────────────────────────────────────────────────────────────

/** The newest system-judgment report (null: none yet, or this crew keeps none). */
function useJudge(): { suites: readonly DefaultEvalSuiteScore[]; at: number } | null {
  const [judge, setJudge] = useState<{ suites: readonly DefaultEvalSuiteScore[]; at: number } | null>(null);
  useEffect(() => {
    let live = true;
    listDefaultEvalRuns()
      .then(async (runs) => (runs[0] !== undefined ? getDefaultEvalReport(runs[0].id) : null))
      .then((r) => { if (live && r !== null) setJudge({ suites: r.suites, at: Date.parse(r.createdAt) }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return judge;
}

export function EvalRecommended({ history, historyRead, ruleCount, runs, busy, onAct }: {
  history: readonly EvalRunSummary[];
  /** The history has been read (an unread one recommends nothing yet). */
  historyRead: boolean;
  ruleCount: number | null;
  runs: readonly SessionView[];
  busy: boolean;
  onAct: (rec: EvalRec) => void;
}): React.ReactElement {
  const judge = useJudge();
  const [now] = useState(() => Date.now());
  const recs = useMemo(() => (historyRead ? evalRecommendations({ history, ruleCount, judge, runs, now }) : []), [historyRead, history, ruleCount, judge, runs, now]);
  return (
    <section className="wk-ue-sec" data-testid="evaluate-recommended" aria-labelledby="evaluate-rec-title">
      <div className="wk-ue-sec-head">
        <h2 id="evaluate-rec-title" className="wk-ue-label">Recommended to run</h2>
        <span className="wk-ue-note">from past results and recent jobs</span>
      </div>
      {!historyRead ? <Skeleton rows={2} variant="row" /> : recs.length === 0 ? (
        <p className="wk-ue-quiet" data-testid="evaluate-rec-none">Nothing stands out: every kind of rule was evaluated and nothing slipped through last time.</p>
      ) : (
        <ul className="wk-ep-recs">
          {recs.map((r, i) => (
            <li key={r.key} className="wk-ep-rec" data-testid="evaluate-rec" data-rec={r.key}>
              <b className="wk-ep-rec-t">{r.title}</b>
              <p className="wk-ep-rec-why" data-testid="evaluate-rec-why">{r.why}</p>
              <span className="wk-ep-rec-meta">{r.meta}</span>
              <button type="button" className={`wk-ue-btn wk-ue-btn--${i === 0 ? 'primary' : 'secondary'} wk-ue-btn--sm wk-ep-rec-go`} data-testid="evaluate-rec-run" disabled={busy && r.act.kind !== 'from-jobs' && r.act.kind !== 'bring'} onClick={() => onAct(r)}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Bring your own ─────────────────────────────────────────────────────────────────────────────

export type ByoMode = 'file' | 'paste' | 'job';

export function BringYourOwn({ mode, onMode, file, runs, jobPick, onImported }: {
  mode: ByoMode | null;
  onMode: (m: ByoMode | null) => void;
  /** The upload form the page always had. */
  file: React.ReactNode;
  runs: readonly SessionView[];
  /** Jobs to start the job pick with (a recommendation's failed jobs). */
  jobPick: readonly string[];
  /** A set was imported: the next run uses it. */
  onImported: (result: CorpusImportResult) => void;
}): React.ReactElement {
  const tiles: Array<{ m: ByoMode; t: string; s: string }> = [
    { m: 'file', t: 'Upload a file', s: 'JSON: each behaviour with good or bad and its type. Becomes a named set you can re-run.' },
    { m: 'paste', t: 'Paste a transcript', s: 'A chat or a log. It splits it into behaviours; you mark each good or bad.' },
    { m: 'job', t: 'From a past job', s: 'Pick a job: its steps become behaviours, already labelled by how review judged them.' },
  ];
  return (
    <section className="wk-ue-sec" data-testid="evaluate-byo" aria-labelledby="evaluate-byo-title" id="evaluate-byo">
      <div className="wk-ue-sec-head">
        <h2 id="evaluate-byo-title" className="wk-ue-label">Bring your own behaviours</h2>
        <span className="wk-ue-note">good and bad examples of what agents did</span>
      </div>
      <div className="wk-ep-byo" role="group" aria-label="Ways to bring behaviours">
        {tiles.map((x) => (
          <button key={x.m} type="button" className="wk-ep-tile" data-testid={`evaluate-byo-${x.m}`} aria-pressed={mode === x.m} onClick={() => onMode(mode === x.m ? null : x.m)}>
            <b>{x.t}</b><span>{x.s}</span>
          </button>
        ))}
      </div>
      {mode === 'file' && <div className="wk-ep-panel" data-testid="evaluate-byo-panel" data-mode="file">{file}</div>}
      {mode === 'paste' && <div className="wk-ep-panel" data-testid="evaluate-byo-panel" data-mode="paste"><PasteTranscript onImported={onImported} /></div>}
      {mode === 'job' && <div className="wk-ep-panel" data-testid="evaluate-byo-panel" data-mode="job"><FromJob runs={runs} preselect={jobPick} onImported={onImported} /></div>}
    </section>
  );
}

function PasteTranscript({ onImported }: { onImported: (r: CorpusImportResult) => void }): React.ReactElement {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<BehaviourDraft[] | null>(null);
  return drafts === null ? (
    <div className="wk-ep-paste">
      <label className="wk-ue-field">
        <span>The transcript</span>
        <textarea className="wk-field wk-ep-textarea" data-testid="evaluate-paste-text" rows={7} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Paste a chat or a log. Each speaker’s turn, or each paragraph, becomes one behaviour.'} />
      </label>
      <div className="wk-ep-acts">
        <button type="button" className="wk-ue-btn wk-ue-btn--primary wk-ue-btn--sm" data-testid="evaluate-paste-split" disabled={text.trim() === ''}
          onClick={() => setDrafts(splitTranscript(text))}>Split into behaviours</button>
      </div>
    </div>
  ) : (
    <BehaviourReview drafts={drafts} onChange={setDrafts} source="transcript" defaultName="pasted-transcript" onImported={onImported}
      onBack={() => setDrafts(null)} note={drafts.length === 0 ? 'Nothing long enough to be a behaviour was found. Go back and paste more.' : 'Mark each behaviour good (the rules should let it through) or bad (they should block it). Unmarked ones are left out.'} />
  );
}

function FromJob({ runs, preselect, onImported }: { runs: readonly SessionView[]; preselect: readonly string[]; onImported: (r: CorpusImportResult) => void }): React.ReactElement {
  const finished = useMemo(() => [...runs]
    .filter((v) => v.session.status === 'completed' || v.session.status === 'failed' || v.session.status === 'cancelled')
    .sort((a, b) => (b.session.created_at ?? 0) - (a.session.created_at ?? 0))
    .slice(0, 30), [runs]);
  const [picked, setPicked] = useState<string[]>(() => preselect.filter((id) => runs.some((v) => v.session.id === id)));
  const [drafts, setDrafts] = useState<BehaviourDraft[] | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = (): void => {
    setReading(true); setError(null);
    // The run list holds each job's steps; a job read again gets its final state (denial reasons included).
    void Promise.all(picked.map((id) => api.getRun(id).then((r) => r.run).catch(() => runs.find((v) => v.session.id === id) ?? null)))
      .then((views) => {
        setReading(false);
        setDrafts(views.filter((v): v is SessionView => v !== null).flatMap(behavioursFromJob));
      }, (e: unknown) => { setReading(false); setError(e instanceof Error ? e.message : String(e)); });
  };
  if (drafts !== null) {
    return (
      <BehaviourReview drafts={drafts} onChange={setDrafts} source="job" defaultName={picked.length === 1 ? `job-${picked[0]!.slice(0, 8)}` : `jobs-${new Date().toISOString().slice(0, 10)}`}
        onImported={onImported} onBack={() => setDrafts(null)}
        note={drafts.length === 0 ? 'Those jobs have no finished steps to learn from.' : 'Each step is labelled by how review judged it: accepted is good, sent back is bad. Change any label, or drop a step.'} />
    );
  }
  return (
    <div className="wk-ep-jobs">
      {finished.length === 0 ? <p className="wk-ue-quiet">No finished job yet.</p> : (
        <ul className="wk-ep-joblist" aria-label="Finished jobs">
          {finished.map((v) => {
            const on = picked.includes(v.session.id);
            const steps = v.units.filter((u) => u.status === 'done' || u.status === 'rejected').length;
            return (
              <li key={v.session.id}>
                <label className="wk-ep-job" data-testid="evaluate-job" data-run-id={v.session.id}>
                  <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== v.session.id) : [...picked, v.session.id])} />
                  <span className="wk-ep-job-t">{jobTitle(v.session)}</span>
                  <span className="wk-ep-job-s" data-tone={v.session.status === 'failed' ? 'fail' : undefined}>
                    {v.session.status === 'failed' ? 'failed' : v.session.status === 'cancelled' ? 'stopped' : 'done'} · {steps} {steps === 1 ? 'step' : 'steps'}
                    {v.session.created_at != null ? ` · ${relTime(v.session.created_at * 1000)}` : ''}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {error !== null && <p className="wk-ue-note" data-tone="fail" role="alert">Couldn’t read those jobs: {error}</p>}
      <div className="wk-ep-acts">
        <button type="button" className="wk-ue-btn wk-ue-btn--primary wk-ue-btn--sm" data-testid="evaluate-job-read" disabled={picked.length === 0 || reading} onClick={read}>
          {reading ? 'Reading…' : picked.length === 0 ? 'Pick a job' : `Use ${picked.length === 1 ? 'this job' : `these ${picked.length} jobs`}`}
        </button>
      </div>
    </div>
  );
}

function BehaviourReview({ drafts, onChange, source, defaultName, onImported, onBack, note }: {
  drafts: BehaviourDraft[];
  onChange: (d: BehaviourDraft[]) => void;
  source: 'transcript' | 'job';
  defaultName: string;
  onImported: (r: CorpusImportResult) => void;
  onBack: () => void;
  note: string;
}): React.ReactElement {
  const [name, setName] = useState(defaultName);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'failed'; text: string } | { kind: 'done'; result: CorpusImportResult }>({ kind: 'idle' });
  const set = (id: string, patch: Partial<BehaviourDraft>): void => onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const n = corpusName(name, defaultName);
  const samples = samplesOf(drafts, n);
  const unmarked = drafts.filter((d) => d.keep && d.kind === null).length;
  const save = (): void => {
    setState({ kind: 'busy' });
    importEvalCorpus({ name: n, samples }).then(
      (result) => { setState({ kind: 'done', result }); onImported(result); },
      (e: unknown) => setState({ kind: 'failed', text: isTestingUnsupported(e) ? TESTING_UNSUPPORTED_COPY : e instanceof Error ? e.message : String(e) }),
    );
  };
  return (
    <div className="wk-ep-review" data-testid="evaluate-review" data-source={source}>
      <p className="wk-ue-note">{note}</p>
      <ul className="wk-ep-rows">
        {drafts.map((d) => (
          <li key={d.id} className="wk-ep-row" data-testid="evaluate-behaviour" data-kind={d.kind ?? 'unmarked'} data-keep={d.keep}>
            <label className="wk-ep-keep"><input type="checkbox" checked={d.keep} onChange={() => set(d.id, { keep: !d.keep })} aria-label={`Keep: ${d.description}`} /></label>
            <span className="wk-ep-row-main">
              <span className="wk-ep-row-t">{d.description}</span>
              {d.why !== undefined && <span className="wk-ep-row-s">{d.why}</span>}
            </span>
            <span className="wk-ep-mark" role="group" aria-label="Good or bad">
              {(['good', 'bad'] as const).map((k) => (
                <button key={k} type="button" className="wk-ep-markbtn" data-mark={k} data-testid={`evaluate-mark-${k}`} aria-pressed={d.kind === k} disabled={!d.keep}
                  onClick={() => set(d.id, { kind: d.kind === k ? null : k })}>{k === 'good' ? 'Good' : 'Bad'}</button>
              ))}
            </span>
            <select className="wk-field wk-ep-type" aria-label="Steering type" value={d.type} disabled={!d.keep} onChange={(e) => set(d.id, { type: e.target.value as SteeringType })}>
              {STEERING_TYPES.map((t) => <option key={t} value={t}>{STEERING_TYPE_LABELS[t]}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <div className="wk-ep-save">
        <label className="wk-ue-field wk-ep-name">
          <span>Name the set</span>
          <input className="wk-field" data-testid="evaluate-review-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="wk-ep-acts">
          <button type="button" className="wk-ue-btn wk-ue-btn--secondary wk-ue-btn--sm" onClick={onBack} disabled={state.kind === 'busy'}>Back</button>
          <button type="button" className="wk-ue-btn wk-ue-btn--primary wk-ue-btn--sm" data-testid="evaluate-review-import" disabled={samples.length === 0 || state.kind === 'busy' || state.kind === 'done'} onClick={save}>
            {state.kind === 'busy' ? 'Importing…' : `Import ${samples.length} ${samples.length === 1 ? 'behaviour' : 'behaviours'}`}
          </button>
        </div>
      </div>
      {unmarked > 0 && state.kind !== 'done' && <p className="wk-ue-note" data-testid="evaluate-review-unmarked">{unmarked} not marked {unmarked === 1 ? 'is' : 'are'} left out.</p>}
      {state.kind === 'failed' && <p className="wk-ue-note" data-tone="fail" role="alert">The import was refused: {state.text}</p>}
      {state.kind === 'done' && (
        <p className="wk-ue-note" role="status" data-testid="evaluate-review-done">
          Imported {state.result.imported} into <b>{state.result.scope}</b>{state.result.embedded ? '' : ' · tags only'}. It is set as the behaviours for the next run.
        </p>
      )}
    </div>
  );
}

// ── Past runs ──────────────────────────────────────────────────────────────────────────────────

export function PastRuns({ history, read, analyzing, onAnalyze, busy }: {
  history: readonly EvalRunSummary[];
  read: boolean;
  /** The run whose analysis is open in the page's chat. */
  analyzing: string | null;
  onAnalyze: (run: EvalRunSummary) => void;
  busy: string | null;
}): React.ReactElement {
  return (
    <section className="wk-ue-sec" data-testid="evaluate-past" aria-labelledby="evaluate-past-title">
      <div className="wk-ue-sec-head">
        <h2 id="evaluate-past-title" className="wk-ue-label">Past runs</h2>
        <span className="wk-ue-note">newest first</span>
      </div>
      {!read ? <Skeleton rows={3} variant="row" /> : history.length === 0 ? (
        <p className="wk-ue-quiet" data-testid="evaluate-past-empty">No evaluation has run yet. Every run is kept here, with its analysis.</p>
      ) : (
        <ul className="wk-ep-runs">
          {history.slice(0, 12).map((r) => {
            const tone = r.summary.gaps > 0 ? 'fail' : r.summary.false_positives > 0 ? 'warn' : 'ok';
            return (
              <li key={r.id} className="wk-ep-run" data-testid="evaluate-past-run" data-run-id={r.id}>
                <span className="wk-ue-dot" data-tone={tone} aria-hidden />
                <span className="wk-ep-run-main">
                  <span className="wk-ep-run-t">{pastRunTitle(r)}</span>
                  <span className="wk-ep-run-s" title={absTime(r.created_at * 1000)}>{relTime(r.created_at * 1000)} · {r.summary.total} {r.summary.total === 1 ? 'behaviour' : 'behaviours'}{r.degraded === 'facet-only' ? ' · tags only' : ''}</span>
                  <span className="wk-ep-pills">
                    {pastRunPills(r.summary).map((p) => <span key={p.key} className="wk-ep-pill" data-tone={p.tone}>{p.text}</span>)}
                  </span>
                </span>
                {analyzing === r.id ? (
                  <span className="wk-ep-open" data-testid="evaluate-analysis-open">Analysis open</span>
                ) : (
                  <button type="button" className="wk-ue-btn wk-ue-btn--secondary wk-ue-btn--sm" data-testid="evaluate-analyze" disabled={busy === r.id} onClick={() => onAnalyze(r)}>
                    {busy === r.id ? 'Reading…' : 'Analyze this run'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
