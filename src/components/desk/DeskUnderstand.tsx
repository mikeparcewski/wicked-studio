import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { api, apiBase } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import { ANALYZE_WORKFLOW, analysisIntent, analysisLaunchBody, isAnalysisRun, type AnalyzeKind } from '../../board/deskAnalyze.js';
import { compareAgents, compareJobs, compareProjects, compareWorkflows, insightPrompt, type CompareView, type GovernanceOf } from '../../board/deskCompare.js';
import { evidenceLinks } from '../../board/deskAnalyze.js';
import { generateInsights, useDeskInsights } from '../../hooks/useDeskInsights.js';
import { Markdown } from '../Markdown.js';
import { outcomeOf, PARTIAL_RECORD_NOTE, projectOf, workflowLabel, workflowOf, RANGES, type AgentRow, type RangeDays, type WorkflowRow } from '../../board/deskInsights.js';
import { jobTitle } from '../../board/deskWords.js';
import { relTime } from '../../board/relTime.js';
import { statusWord } from '../../board/statusWords.js';
import { sessionPath } from '../../board/sessionModel.js';
import { createdAtMs } from '../../board/windowStats.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { agentColor } from '../charts/Chart.js';
import { Segmented, Skeleton } from '../ui/index.js';

/**
 * UNDERSTAND (the approved concept, concepts/tabs.html#understand): a kind switcher, removable chips
 * for the picked items and the window, one card per item side by side with the same rows and a
 * "best" mark per row, "Where they differ" in plain words, and on the right "Analyze this
 * selection" (the exact intent, the workflow named, Start analysis + Edit: a governed run of the
 * existing `learn` workflow through the wizard's launch body) above "Past analyses".
 */
const KINDS: readonly { value: AnalyzeKind; label: string }[] = [
  { value: 'agents', label: 'Agents' }, { value: 'workflows', label: 'Workflows' }, { value: 'jobs', label: 'Jobs' }, { value: 'projects', label: 'Projects' },
];
const MAX_CARDS = 4;

const costCache = new Map<string, number | null>();

export function DeskUnderstand({ agents, agentsRead = 'done', agentsTruncated = false, filters = null, workflows, kept, allRuns, days, onDays, project, projectLabel, projectName, agentName, governance, navigate, pathOf, now }: {
  agents: readonly AgentRow[];
  /** The agent record's read: agents are compared only from a record that was read. */
  agentsRead?: 'loading' | 'done' | 'error';
  /** The agent record left out older runs: the agent comparison is partial and says so. */
  agentsTruncated?: boolean;
  /** The refine bar's agent / workflow filters in words ("agent Claude Code, workflow Bug"), or null. */
  filters?: string | null;
  workflows: readonly WorkflowRow[];
  kept: readonly SessionView[];
  /** Every run (Past analyses lists earlier analysis jobs from all of them). */
  allRuns: readonly SessionView[];
  days: RangeDays;
  onDays: (d: RangeDays) => void;
  project: string | null;
  projectLabel: string | null;
  projectName: (id: string) => string;
  agentName: (cli: string) => string;
  governance: GovernanceOf;
  navigate: Navigate;
  pathOf: (runId: string) => string;
  now: number;
}): React.ReactElement {
  const [kind, setKind] = useState<AnalyzeKind>('agents');
  const [picked, setPicked] = useState<Record<AnalyzeKind, string[] | null>>({ agents: null, workflows: null, jobs: null, projects: null });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [launch, setLaunch] = useState<{ phase: 'idle' | 'sending' | 'done' | 'failed'; runId?: string; error?: string }>({ phase: 'idle' });
  // Bumped when a job's cost read lands, so the comparison (and its insight key) is rebuilt.
  const [costRev, bump] = useState(0);
  // A launch answers for the selection it was started on, and never after the panel is gone.
  const launchGen = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const addRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo(() => {
    if (kind === 'agents') return agents.map((a) => ({ id: a.cli, label: a.label, color: agentColor(a.cli) as string | null, meta: `${a.steps} steps` }));
    if (kind === 'workflows') return workflows.map((w) => ({ id: w.key, label: w.label, color: null, meta: `${w.jobs} ${w.jobs === 1 ? 'job' : 'jobs'}` }));
    if (kind === 'jobs') {
      return [...kept].filter((v) => typeof v.session.ended_at === 'number').sort((a, b) => (createdAtMs(b) ?? 0) - (createdAtMs(a) ?? 0)).slice(0, 30)
        .map((v) => ({ id: v.session.id, label: jobTitle(v.session), color: null, meta: `${outcomeOf(v) ?? 'Unknown'}${createdAtMs(v) !== null ? ` · ${relTime(createdAtMs(v)!, now)}` : ''}` }));
    }
    return [...new Set(kept.map(projectOf))].map((id) => ({ id, label: projectName(id), color: null, meta: `${kept.filter((v) => projectOf(v) === id).length} jobs` }));
  }, [kind, agents, workflows, kept, projectName, now]);

  // Nothing is picked until the operator picks (operator r7): the empty state's suggestions pre-select.
  const sel = (picked[kind] ?? []).filter((id) => options.some((o) => o.id === id)).slice(0, MAX_CARDS);
  const setSel = (ids: string[]): void => { setPicked((p) => ({ ...p, [kind]: ids })); setEditing(null); launchGen.current += 1; setLaunch({ phase: 'idle' }); };
  const items = sel.map((id) => ({ id, label: options.find((o) => o.id === id)?.label ?? id }));
  const input = { kind, items, days, api: apiBase(), project, projectLabel, filters };
  const intent = items.length === 0 ? '' : analysisIntent(input);

  // Jobs: each card's spend is that job's own usage records, read on demand.
  useEffect(() => {
    if (kind !== 'jobs') return;
    let live = true;
    for (const id of sel) {
      if (costCache.has(id)) continue;
      api.getRunEvents(id, ['cliUsage']).then(({ events }) => {
        const priced = (events as unknown as { costUsd?: unknown }[]).filter((e) => typeof e.costUsd === 'number');
        costCache.set(id, priced.length === 0 ? null : priced.reduce((a, e) => a + (e.costUsd as number), 0));
      }, () => costCache.set(id, null)).finally(() => { if (live) bump((n) => n + 1); });
    }
    return () => { live = false; };
  }, [kind, sel.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!adding) return undefined;
    const close = (e: MouseEvent): void => { if (addRef.current !== null && !addRef.current.contains(e.target as Node)) setAdding(false); };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setAdding(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [adding]);

  const view: CompareView = useMemo(() => {
    if (kind === 'agents') return compareAgents(sel.map((id) => agents.find((a) => a.cli === id)!).filter(Boolean), governance, agentColor);
    if (kind === 'workflows') return compareWorkflows(sel.map((id) => workflows.find((w) => w.key === id)!).filter(Boolean));
    if (kind === 'jobs') return compareJobs(sel.map((id) => kept.find((v) => v.session.id === id)!).filter(Boolean), (v) => jobTitle(v.session), agentName, (id) => (costCache.has(id) ? costCache.get(id)! : undefined));
    return compareProjects(sel, kept, projectName);
  }, [kind, sel.join('|'), agents, workflows, kept, governance, agentName, projectName, launch, costRev]); // eslint-disable-line react-hooks/exhaustive-deps

  // The cache key is the comparison itself: kind, window, scope, selection AND the numbers on the
  // cards, so any filter that changes what is shown asks again rather than reusing another answer.
  const insightKey = `${kind}|${days}|${project ?? ''}|${filters ?? ''}|${sel.join(',')}|${view.cards.map((c) => c.cells.map((x) => x.text).join('/')).join('|')}${kind === 'agents' && agentsTruncated ? '|partial' : ''}`;
  const insight = useDeskInsights(insightKey);
  const scopeWords = [project === null ? null : `the project ${projectLabel ?? project} (${project})`, filters].filter((x): x is string => x !== null && x !== '').join(', ') || null;
  // A new window, scope or filter starts the analysis over: an edited intent or a pending launch
  // belongs to the comparison it was made for.
  useEffect(() => { setEditing(null); launchGen.current += 1; setLaunch({ phase: 'idle' }); }, [days, project, filters]);
  const runInsights = (): void => { void generateInsights(insightKey, insightPrompt(kind, view, days, evidenceLinks(kind, items, days, apiBase(), project), scopeWords) + (kind === 'agents' && agentsTruncated ? `\n${PARTIAL_RECORD_NOTE}. The agent comparison is partial.` : '')); };
  const agentsUnread = kind === 'agents' && agentsRead !== 'done';
  const suggestions = [
    { id: 'agents', label: 'Compare your agents', go: () => { setKind('agents'); setPicked((p) => ({ ...p, agents: agents.slice(0, 3).map((a) => a.cli) })); } },
    { id: 'workflows', label: 'Compare your two busiest workflows', go: () => { setKind('workflows'); setPicked((p) => ({ ...p, workflows: workflows.slice(0, 2).map((w) => w.key) })); } },
    { id: 'jobs', label: 'A failed job against a finished one', go: () => {
      const ended = [...kept].filter((v) => typeof v.session.ended_at === 'number');
      const f = ended.find((v) => outcomeOf(v) === 'Failed');
      const ok = ended.find((v) => outcomeOf(v) === 'Finished' && (f === undefined || workflowOf(v).key === workflowOf(f).key)) ?? ended.find((v) => outcomeOf(v) === 'Finished');
      setKind('jobs'); setPicked((p) => ({ ...p, jobs: [f, ok].filter((x): x is SessionView => x !== undefined).map((v) => v.session.id) }));
    } },
    { id: 'projects', label: 'Compare your projects', go: () => { setKind('projects'); setPicked((p) => ({ ...p, projects: [...new Set(kept.map(projectOf))].slice(0, 3) })); } },
  ];
  const past = useMemo(() => allRuns.filter((v) => isAnalysisRun(v.session.problem, workflowOf(v).key === 'learn' ? 'learn' : workflowOf(v).key))
    .sort((a, b) => (createdAtMs(b) ?? 0) - (createdAtMs(a) ?? 0)).slice(0, 5), [allRuns]);

  const start = (): void => {
    const gen = (launchGen.current += 1);
    const current = (): boolean => mounted.current && launchGen.current === gen;
    setLaunch({ phase: 'sending' });
    api.launchRun(analysisLaunchBody(input, editing ?? undefined)).then(
      ({ runId }) => { if (current()) { setLaunch({ phase: 'done', runId }); setEditing(null); } },
      (e: unknown) => { if (current()) setLaunch({ phase: 'failed', error: e instanceof Error ? e.message : String(e) }); },
    );
  };
  const addable = options.filter((o) => !sel.includes(o.id));

  return (
    <div className="wk-und" data-testid="desk-understand2">
      <p className="wk-und-intro" data-testid="desk-und-intro">
        Set things side by side to see why one does better. Pick a kind, add up to {MAX_CARDS} with <b>Add</b>, read the cards (the best value in each row is marked),
        then <b>Generate insights</b> for a quick read here, or <b>Analyze</b> for a deeper, cited write-up as a job.
      </p>
      <div className="wk-und-bar">
        <Segmented label="Compare what" data-testid="desk-pick-kind" value={kind} options={KINDS} onChange={(k) => { setKind(k); setEditing(null); launchGen.current += 1; setLaunch({ phase: 'idle' }); }} />
        <div className="wk-und-chips" role="group" aria-label={`Picked ${kind}`}>
          {items.map((it) => {
            const o = options.find((x) => x.id === it.id);
            return (
              <span key={it.id} className="wk-und-chip" data-testid="desk-pick-chip" data-id={it.id}>
                {o?.color != null && <i aria-hidden className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: o.color }} />}
                <span className="wk-und-chip-label" title={it.label}>{it.label}</span>
                <button type="button" aria-label={`Remove ${it.label}`} className="wk-und-chip-x" onClick={() => setSel(sel.filter((x) => x !== it.id))}><X size={13} aria-hidden /></button>
              </span>
            );
          })}
          <div className="wk-und-add" ref={addRef}>
            <button type="button" data-testid="desk-pick-add" className="wk-und-chip wk-und-chip--add" aria-expanded={adding} disabled={addable.length === 0 || sel.length >= MAX_CARDS}
              title={sel.length >= MAX_CARDS ? `At most ${MAX_CARDS} side by side` : undefined} onClick={() => setAdding((v) => !v)}><Plus size={13} aria-hidden />Add</button>
            {adding && (
              <ul className="wk-und-menu wk-overlay" role="menu" data-testid="desk-pick-menu">
                {addable.map((o) => (
                  <li key={o.id} role="none">
                    <button type="button" role="menuitem" className="wk-und-menu-item" onClick={() => { setSel([...sel, o.id]); setAdding(false); }}>
                      {o.color !== null && <i aria-hidden className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: o.color }} />}
                      <span className="wk-und-chip-label">{o.label}</span><span className="wk-pick-meta">{o.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="wk-und-window"><span className="wk-sr-only">Window</span>
            <select className="wk-und-window-select" value={days} data-testid="desk-und-window" onChange={(e) => onDays(Number(e.target.value) as RangeDays)}>
              {RANGES.map((d) => <option key={d} value={d}>last {d} days</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="wk-und-cols">
        <div className="wk-und-main">
          {kind === 'agents' && agentsTruncated && <p className="wk-viz-note">{PARTIAL_RECORD_NOTE}</p>}
          {agentsUnread ? (
            <section className="wk-card wk-und-empty" data-testid="desk-und-agents-unread" aria-busy={agentsRead === 'loading'}>
              {agentsRead === 'loading' ? <Skeleton rows={3} variant="line" />
                : <p className="wk-viz-state" role="alert">Couldn’t read the agent record, so agents can’t be compared right now. Workflows, jobs and projects still can.</p>}
            </section>
          ) : view.cards.length === 0 ? (
            <section className="wk-card wk-und-empty" data-testid="desk-und-empty">
              <h3 className="wk-desk2-title">Nothing picked yet</h3>
              <p className="wk-viz-note">{options.length === 0 ? `No ${kind} in the last ${days} days. Try a longer window, or one of these:` : 'Start from one of these, or use Add above:'}</p>
              <ul className="wk-und-suggest">
                {suggestions.map((g) => <li key={g.id}><button type="button" className="wk-btn wk-btn--secondary" data-testid="desk-und-suggest" data-id={g.id} onClick={g.go}>{g.label}</button></li>)}
              </ul>
            </section>
          ) : (
            <div className="wk-und-cards" style={{ gridTemplateColumns: `repeat(${Math.max(1, view.cards.length)}, minmax(0, 1fr))` }}>
              {view.cards.map((c) => (
                <section key={c.id} className="wk-card wk-und-card" data-testid="desk-compare-card" data-id={c.id} aria-label={c.label}>
                  <h3 className="wk-und-card-title">
                    {c.color !== null && <i aria-hidden className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: c.color }} />}
                    {kind === 'jobs'
                      ? <a href={pathOf(c.id)} className="wk-und-card-link" onClick={(e) => { e.preventDefault(); navigate(pathOf(c.id)); }} title={c.label}>{c.label}</a>
                      : <span title={c.label}>{c.label}</span>}
                  </h3>
                  <dl className="wk-und-rows">
                    {view.rows.map((r, k) => {
                      const cell = c.cells[k]!;
                      return (
                        <div key={r} className="wk-und-row">
                          <dt title={cell.title}>{r}</dt>
                          <dd>
                            {cell.tag === true ? <span className="wk-und-tag" data-tone={cell.tone ?? undefined}>{cell.text}</span> : <b>{cell.text}</b>}
                            {cell.best && <span className="wk-und-best" data-testid="desk-compare-best">best</span>}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              ))}
            </div>
          )}
          {view.cards.length > 0 && (
            <section className="wk-card wk-und-differ" data-testid="desk-compare-differ" aria-labelledby="desk-differ-title" aria-busy={insight.phase === 'loading'}>
              <header className="wk-und-differ-head">
                <h3 id="desk-differ-title" className="wk-desk2-title">Where they differ</h3>
                {view.small && <span className="wk-viz-meta">small numbers: read as direction, not proof</span>}
              </header>
              {insight.phase === 'idle' && (
                <div className="wk-und-gen">
                  <p className="wk-viz-note">An agent reads the numbers above (and the records behind them) and says what really differs, why, and what to do. It answers here, in a minute or two; nothing is changed.</p>
                  <button type="button" data-testid="desk-insights-generate" className="wk-btn wk-btn--primary" onClick={runInsights}><Sparkles size={14} aria-hidden />Generate insights</button>
                </div>
              )}
              {insight.phase === 'loading' && (
                <div className="wk-und-gen" data-testid="desk-insights-loading">
                  <p className="wk-viz-meta" role="status">Asking an agent… this usually takes a minute or two.</p>
                  {insight.text.trim() !== '' && <div className="wk-und-insight"><Markdown>{insight.text}</Markdown></div>}
                </div>
              )}
              {insight.phase === 'error' && (
                <div className="wk-und-gen" data-testid="desk-insights-error">
                  <p className="wk-viz-state" role="alert">Couldn’t get insights. {insight.error}</p>
                  <button type="button" className="wk-btn wk-btn--secondary" onClick={runInsights}><RefreshCw size={14} aria-hidden />Try again</button>
                </div>
              )}
              {insight.phase === 'done' && (
                <div className="wk-und-gen" data-testid="desk-insights-done">
                  <div className="wk-und-insight"><Markdown>{insight.text}</Markdown></div>
                  <p className="wk-und-gen-meta">
                    <span className="wk-viz-meta" title={new Date(insight.at).toLocaleString()}>Generated {relTime(insight.at, Date.now())} by an agent, from the numbers above</span>
                    <button type="button" data-testid="desk-insights-regenerate" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={runInsights}><RefreshCw size={13} aria-hidden />Regenerate</button>
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="wk-und-side">
          <section className="wk-card wk-und-analyze" data-testid="desk-analyze-confirm" aria-labelledby="desk-analyze-title">
            <h3 id="desk-analyze-title" className="wk-desk2-title">Analyze this selection</h3>
            <p className="wk-viz-note wk-und-analyze-lead">The deeper option. Insights is a quick read in this panel; Analyze starts a governed job on the <b>{workflowLabel(ANALYZE_WORKFLOW)}</b> workflow that reads the records and writes a cited walkthrough. It takes longer, its steps are checked like any job, and it changes no code.</p>
            {items.length === 0 ? <p className="wk-viz-state">Pick at least one to analyze.</p> : editing !== null ? (
              <textarea className="wk-field wk-und-intent wk-und-intent--edit" data-testid="desk-analyze-edit-text" value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="The analysis, in your words" />
            ) : (
              <pre className="wk-und-intent" data-testid="desk-analyze-intent">{intent}</pre>
            )}
            <div className="wk-inbox-read-acts">
              <button type="button" data-testid="desk-analyze-start" className="wk-btn wk-btn--primary" disabled={items.length === 0 || launch.phase === 'sending' || (editing !== null && editing.trim() === '')} onClick={start}>
                {launch.phase === 'sending' ? 'Starting…' : 'Start analysis'}
              </button>
              {items.length > 0 && (editing === null
                ? <button type="button" data-testid="desk-analyze-edit" className="wk-btn wk-btn--secondary" onClick={() => setEditing(intent)}>Edit</button>
                : <button type="button" className="wk-btn wk-btn--quiet" onClick={() => setEditing(null)}>Use the drafted words</button>)}
            </div>
            {launch.phase === 'failed' && <p className="wk-viz-meta" data-testid="desk-analyze-failed">It didn’t start. {launch.error}</p>}
            {launch.phase === 'done' && launch.runId !== undefined && (
              <p className="wk-analyze-done" data-testid="desk-analyze-done">Analysis started.{' '}
                <a href={sessionPath(`run:${launch.runId}`)} className="wk-link" onClick={(e) => { e.preventDefault(); navigate(sessionPath(`run:${launch.runId!}`)); }}>Open the analysis job</a>
              </p>
            )}
          </section>
          <section className="wk-card wk-und-past" data-testid="desk-analyses-past" aria-labelledby="desk-past-title">
            <h3 id="desk-past-title" className="wk-desk2-title">Past analyses</h3>
            {past.length === 0 ? <p className="wk-viz-note">None yet. Each analysis you start lands here as a job.</p> : (
              <ul className="wk-und-past-list">
                {past.map((v) => {
                  const w = statusWord(v);
                  return (
                    <li key={v.session.id}>
                      <a href={pathOf(v.session.id)} className="wk-und-past-link" onClick={(e) => { e.preventDefault(); navigate(pathOf(v.session.id)); }}>{jobTitle(v.session)}</a>
                      <span className="wk-tag wk-und-past-tag" data-tone={w.tone}>{w.word}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
