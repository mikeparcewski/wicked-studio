import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, FileText, GitBranch, PenLine, X } from 'lucide-react';
import { api, apiFetch } from '../../api/client.js';
import { postCapture } from '../../api/capture.js';
import { getSteeringDraft, keepDraftedRules, type SteeringDraftResponse } from '../../api/learn.js';
import { approveProposal, listProposals, memoryPayload, policyPayload, proposalKind, rejectProposal, type Proposal } from '../../api/proposals.js';
import { authorSteeringRules } from '../../api/steering.js';
import type { Ask, AskAnswer } from '../../api/ask.js';
import type { RepoEntry, SessionView } from '../../api/types.js';
import {
  jobLine, repoStyleProblem, STYLE_KIND_WORDS, styleStations, TEAM_DOCS_INSTRUCTIONS, writingStyleNotes,
  type StyleJob, type StyleKind, type StyleSource,
} from '../../board/learnHub.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useFirstRun } from '../../store/firstRun.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { AskCard, AskRecord } from '../ask/AskCard.js';
import { readFileText } from '../fileText.js';
import { LearnTopics } from './LearnPage.js';

/**
 * Style (DES-LEARN §3.1; mockup c): feed studio how you work. Team docs run the `steering-author` preset (rules,
 * held at its propose gate until you pick); showcase repos run `capture-learnings` with garden's style lens;
 * writing runs a capture in your voice (memories). Topics to follow are today's learn topics, on their refresh
 * schedule. The jobs run as a visible pipeline (Read → Spot patterns → Draft → You decide) and end in two
 * pick-several asks — memories and rules — each row preselected with its source; untick what is wrong.
 * Kept = approved (rules from docs: the propose gate approved with `keepRules`); unticked = rejected.
 * The jobs' ids ride `studio.learn.style` so a reload picks up where it was.
 */

const STYLE_KEY = 'studio.learn.style';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

interface StyleRecord { jobs: StyleJob[]; startedAt: number; decided?: { memories?: string; rules?: string } }

function readRecord(settings: Record<string, unknown> | undefined): StyleRecord | null {
  const v = settings?.[STYLE_KEY];
  if (v === null || typeof v !== 'object') return null;
  const o = v as Partial<StyleRecord>;
  if (!Array.isArray(o.jobs) || typeof o.startedAt !== 'number') return null;
  const jobs = o.jobs.filter((j): j is StyleJob => typeof j?.runId === 'string' && ['rules', 'repo', 'writing'].includes(j.kind) && Array.isArray(j.sources));
  return { jobs, startedAt: o.startedAt, ...(o.decided !== undefined ? { decided: o.decided } : {}) };
}

function saveRecord(r: StyleRecord | null): Promise<unknown> {
  return apiFetch('/settings', { method: 'PUT', body: JSON.stringify({ [STYLE_KEY]: r ?? {} }) });
}

const ICON: Record<Exclude<StyleKind, 'topic'>, React.ReactElement> = {
  doc: <FileText size={15} aria-hidden />, repo: <GitBranch size={15} aria-hidden />, writing: <PenLine size={15} aria-hidden />,
};

let nextId = 0;
const sid = (): string => `src-${Date.now().toString(36)}-${(nextId += 1)}`;

export function StyleTab({ navigate }: { navigate: Navigate }): React.ReactElement {
  const [sources, setSources] = useState<StyleSource[]>([]);
  const [kind, setKind] = useState<StyleKind>('doc');
  const [text, setText] = useState('');
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [over, setOver] = useState(false);
  const [record, setRecord] = useState<StyleRecord | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // The review sits full width under the sources and the pipeline (mockup c), rendered into this slot.
  const [resultsEl, setResultsEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    api.listRepos().then((r) => setRepos(r.repos), () => setRepos([]));
    api.getAppearanceSettings().then((s) => setRecord(readRecord(s.settings)), () => undefined);
  }, []);

  const add = (): void => {
    const v = text.trim();
    if (kind === 'topic') return;
    if (kind === 'repo') {
      const repo = repos.find((r) => r.id === v || r.name === v);
      if (repo === undefined || sources.some((s) => s.repoId === repo.id)) return;
      setSources((s) => [...s, { id: sid(), kind: 'repo', label: repo.name, repoId: repo.id }]);
    } else {
      if (v === '') return;
      setSources((s) => [...s, { id: sid(), kind, label: v, ...(/^https?:\/\//iu.test(v) ? { url: v } : {}) }]);
    }
    setText('');
  };
  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files).slice(0, 8);
    const read = await Promise.all(list.map(async (f) => ({ name: f.name, content: await readFileText(f) })));
    setSources((s) => [...s, ...read.map((f) => ({ id: sid(), kind: (kind === 'writing' ? 'writing' : 'doc') as 'doc' | 'writing', label: f.name, text: f.content }))]);
  };

  const launch = async (): Promise<void> => {
    if (launching || sources.length === 0) return;
    setLaunching(true);
    setLaunchError(null);
    const jobs: StyleJob[] = [];
    const failed: string[] = [];
    const docs = sources.filter((s) => s.kind === 'doc');
    const writing = sources.filter((s) => s.kind === 'writing');
    const repoSources = sources.filter((s) => s.kind === 'repo');
    const mark = (runId: string): void => useProvenanceStore.getState().markLaunchedHere(runId);
    try {
      if (docs.length > 0) {
        const links = docs.filter((d) => d.url !== undefined).map((d) => d.url!);
        const paths = docs.filter((d) => d.text === undefined && d.url === undefined && (d.label.startsWith('/') || d.label.startsWith('~'))).map((d) => d.label);
        const documents = docs.filter((d) => d.text !== undefined).map((d) => ({ name: d.label, content: d.text! }));
        try {
          const { runId } = await authorSteeringRules({
            instructions: links.length > 0 ? `${TEAM_DOCS_INSTRUCTIONS}\n\nAlso read: ${links.join(' ')}` : TEAM_DOCS_INSTRUCTIONS,
            ...(documents.length > 0 ? { documents } : {}),
            ...(paths.length > 0 ? { paths } : {}),
          });
          mark(runId);
          jobs.push({ runId, kind: 'rules', sources: docs.map((d) => d.label) });
        } catch (e) { failed.push(`team docs: ${e instanceof Error ? e.message : String(e)}`); }
      }
      for (const r of repoSources) {
        try {
          const { runId } = await api.launchRun({ problem: repoStyleProblem(r.label), repoRef: r.repoId!, workflow: 'capture-learnings' });
          mark(runId);
          jobs.push({ runId, kind: 'repo', sources: [r.label] });
        } catch (e) { failed.push(`${r.label}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (writing.length > 0) {
        try {
          const files = writing.filter((w) => w.text !== undefined).map((w) => ({ name: w.label, text: w.text! }));
          const { runId } = await postCapture('default', {
            notes: writingStyleNotes(writing.map((w) => w.label), writing.filter((w) => w.url !== undefined).map((w) => w.url!)),
            ...(files.length > 0 ? { files } : {}),
          });
          mark(runId);
          jobs.push({ runId, kind: 'writing', sources: writing.map((w) => w.label) });
        } catch (e) { failed.push(`writing: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (failed.length > 0) setLaunchError(`Not started: ${failed.join('; ')}`);
      if (jobs.length > 0) {
        const r: StyleRecord = { jobs, startedAt: Date.now() };
        setRecord(r);
        void saveRecord(r).catch(() => undefined);
      }
    } finally {
      setLaunching(false);
    }
  };

  const startOver = (): void => {
    setRecord(null);
    void saveRecord(null).catch(() => undefined);
  };

  return (
    <div data-testid="learn-style">
      <div className="wk-learn-feed">
        <div className="wk-learn-drop" data-over={over ? 'true' : 'false'} data-testid="style-drop"
          onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files); }}>
          <h2>Feed it how you work</h2>
          <p>Team docs (branching, pull requests, design principles) become rules. Work you are proud of (repos, writing) becomes memories of your style. Topics to follow (a library, a standard) are researched and refreshed on a schedule. Drop files here or add a link.</p>
          <form className="wk-learn-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <select aria-label="What it is" value={kind} data-testid="style-kind" onChange={(e) => { setKind(e.target.value as StyleKind); setText(''); }}>
              {(Object.keys(STYLE_KIND_WORDS) as StyleKind[]).map((k) => <option key={k} value={k}>{STYLE_KIND_WORDS[k]}</option>)}
            </select>
            {kind === 'repo' ? (
              <select aria-label="Repository" value={text} data-testid="style-repo" onChange={(e) => setText(e.target.value)}>
                <option value="">{repos.length === 0 ? 'No repositories registered yet' : 'Pick a repository…'}</option>
                {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            ) : kind === 'topic' ? (
              <span className="wk-learn-quiet wk-learn-grow">A helper researches it and saves what it learned in a repository, refreshed on a schedule.</span>
            ) : (
              <input type="text" value={text} data-testid="style-input" aria-label="Path or link"
                placeholder={kind === 'doc' ? 'e.g. ~/handbook/CONTRIBUTING.md or a link' : 'e.g. https://eng.example.com/blog'} onChange={(e) => setText(e.target.value)} />
            )}
            {kind === 'topic' ? (
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="style-topic-new" onClick={() => document.getElementById('learn-topics-new')?.click()}>Pick a topic…</button>
            ) : (
              <>
                <button type="submit" className="wk-btn wk-btn--secondary" data-testid="style-add" disabled={text.trim() === ''}>Add</button>
                {kind !== 'repo' && <button type="button" className="wk-btn wk-btn--quiet" data-testid="style-file" onClick={() => fileRef.current?.click()}>Choose files…</button>}
              </>
            )}
            <input ref={fileRef} type="file" multiple hidden accept=".md,.markdown,.txt,.html,.htm,.pdf,.rst,.adoc" onChange={(e) => { if (e.target.files !== null) void addFiles(e.target.files); e.target.value = ''; }} />
          </form>
          <ul className="wk-learn-sources" aria-label="Sources" data-testid="style-sources">
            {sources.map((s) => (
              <li key={s.id} className="wk-learn-src" data-kind={s.kind} data-testid="style-source">
                <span className="wk-learn-src-ic">{ICON[s.kind]}</span>
                <span className="wk-learn-src-w">
                  <span className="wk-learn-src-name" title={s.label}>{s.label}</span>
                  <span className="wk-learn-src-sub">{STYLE_KIND_WORDS[s.kind]}{s.text !== undefined ? ' · dropped file' : s.url !== undefined ? ' · link' : ''}</span>
                </span>
                <button type="button" className="wk-learn-iconbtn" aria-label={`Remove ${s.label}`} data-testid="style-source-remove" onClick={() => setSources((x) => x.filter((y) => y.id !== s.id))}><X size={14} aria-hidden /></button>
              </li>
            ))}
          </ul>
        </div>
        <StylePipeline record={record} launching={launching} sourceCount={sources.length} onLearn={() => void launch()} onReset={startOver}
          launchError={launchError} navigate={navigate} resultsEl={resultsEl} onDecided={(r) => { setRecord(r); void saveRecord(r).catch(() => undefined); }} />
      </div>
      <div ref={setResultsEl} className="wk-learn-results" />
      <section className="wk-learn-topics" aria-labelledby="learn-topics-h">
        <h2 id="learn-topics-h" className="wk-learn-h2"><BookOpen size={16} aria-hidden /> Topics to follow</h2>
        <LearnTopics navigate={navigate} embedded />
      </section>
    </div>
  );
}

/** The four stations, the ticker, and once drafted the two pick-several asks. */
function StylePipeline({ record, launching, sourceCount, onLearn, onReset, launchError, navigate, onDecided, resultsEl }: {
  record: StyleRecord | null; launching: boolean; sourceCount: number; onLearn: () => void; onReset: () => void;
  launchError: string | null; navigate: Navigate; onDecided: (r: StyleRecord) => void;
  /** Where the review renders (full width under the grid); absent = in place. */
  resultsEl?: HTMLElement | null;
}): React.ReactElement {
  const jobs = useMemo(() => record?.jobs ?? [], [record]);
  const [runs, setRuns] = useState<Record<string, SessionView>>({});
  const [pending, setPending] = useState<Proposal[]>([]);
  const [draft, setDraft] = useState<SteeringDraftResponse | null>(null);
  const [busy, setBusy] = useState<'memories' | 'rules' | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const runList = jobs.map((j) => runs[j.runId]).filter((r): r is SessionView => r !== undefined);
  const settled = (j: StyleJob): boolean => { const s = runs[j.runId]?.session.status; return s !== undefined && (TERMINAL.has(s) || (j.kind === 'rules' && s === 'awaiting_human')); };
  const allSettled = jobs.length > 0 && jobs.every(settled);

  const poll = useCallback(async (): Promise<void> => {
    const got = await Promise.all(jobs.map((j) => api.getRun(j.runId).then((r) => r.run, () => null)));
    setRuns(Object.fromEntries(got.filter((r): r is SessionView => r !== null).map((r) => [r.session.id, r])));
    const ids = new Set(jobs.filter((j) => j.kind !== 'rules').map((j) => j.runId));
    if (ids.size > 0) {
      const rows = await listProposals({ state: 'pending' }).catch(() => null);
      if (rows !== null) setPending(rows.filter((p) => ids.has(p.provenance['run_id'] ?? '')));
    }
    const rulesJob = jobs.find((j) => j.kind === 'rules');
    if (rulesJob !== undefined) {
      const d = await getSteeringDraft(rulesJob.runId).catch(() => null);
      if (d !== null) setDraft(d);
    }
  }, [jobs]);
  useEffect(() => {
    if (jobs.length === 0) return undefined;
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => { await poll(); if (!stop) t = setTimeout(() => void tick(), 4000); };
    void tick();
    return () => { stop = true; if (t !== undefined) clearTimeout(t); };
  }, [jobs, poll]);

  const memories = pending.filter((p) => proposalKind(p) === 'memory');
  const policies = pending.filter((p) => proposalKind(p) === 'policy');
  const draftRules = draft?.ready === true ? draft.rules : [];
  const decided = record?.decided ?? {};
  const memDone = decided.memories !== undefined;
  const rulesDone = decided.rules !== undefined;
  const stations = styleStations(runList, allSettled && memDone && rulesDone);
  const waitingElsewhere = runList.filter((r) => r.session.status === 'awaiting_human' && jobs.find((j) => j.runId === r.session.id)?.kind !== 'rules');

  const memAsk: Ask | null = memories.length === 0 ? null : {
    id: 'style-memories', host: 'learn', from: { kind: 'studio', id: 'learn', label: 'Learn · Style' }, kind: 'pick', answeredBy: 'person',
    prompt: 'Which of these should helpers remember about you?', detail: 'Each is ticked; untick anything that’s wrong. Nothing is kept until you say so.',
    multi: { min: 0, max: memories.length }, default: memories.map((m) => m.id),
    options: memories.map((m) => ({ id: m.id, token: m.id, label: memoryPayload(m).content ?? '(empty)', meta: sourceOf(m, jobs) })),
    record: 'You kept {n} of {of} memories · saved to Memory',
  };
  const ruleOptions = [
    ...draftRules.map((r) => ({ id: `draft:${r.id}`, token: r.id, label: r.statement, meta: `${r.steering_type ?? 'rule'} · ${r.severity} · from your team docs` })),
    ...policies.map((p) => ({ id: p.id, token: p.id, label: policyPayload(p).rule ?? '(empty)', meta: `${(p.kind_type.split(':')[1] ?? 'rule')} · ${policyPayload(p).severity ?? 'warn'} · ${sourceOf(p, jobs)}` })),
  ];
  const rulesAsk: Ask | null = ruleOptions.length === 0 ? null : {
    id: 'style-rules', host: 'learn', from: { kind: 'studio', id: 'learn', label: 'Learn · Style' }, kind: 'pick', answeredBy: 'person',
    prompt: 'Which of these rules should helpers be held to?', multi: { min: 0, max: ruleOptions.length }, default: ruleOptions.map((o) => o.id),
    options: ruleOptions, record: 'You adopted {n} of {of} rules · now in Steering',
  };

  const decide = async (which: 'memories' | 'rules', a: AskAnswer): Promise<void> => {
    if (busy !== null || record === null) return;
    setBusy(which);
    setFail(null);
    const keep = new Set(a.options ?? []);
    try {
      let kept = 0;
      let of = 0;
      if (which === 'memories') {
        of = memories.length;
        for (const m of memories) { if (keep.has(m.id)) { await approveProposal(m.id); kept += 1; } else await rejectProposal(m.id); }
      } else {
        of = ruleOptions.length;
        const rulesJob = jobs.find((j) => j.kind === 'rules');
        if (rulesJob !== undefined && draftRules.length > 0) {
          const ids = draftRules.filter((r) => keep.has(`draft:${r.id}`)).map((r) => r.id);
          const res = await keepDraftedRules(rulesJob.runId, ids);
          if (res.landing?.outcome === 'failed') throw new Error(res.landing.error ?? 'the rules could not be landed');
          kept += ids.length;
        }
        for (const p of policies) { if (keep.has(p.id)) { await approveProposal(p.id); kept += 1; } else await rejectProposal(p.id); }
      }
      if (kept > 0) void useFirstRun.getState().markLearnUsed();
      const line = which === 'memories' ? `You kept ${kept} of ${of} memories · saved to Memory` : `You adopted ${kept} of ${of} rules · now in Steering`;
      onDecided({ ...record, decided: { ...decided, [which]: line } });
      void poll();
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const place = (node: React.ReactElement): React.ReactNode => (resultsEl !== undefined && resultsEl !== null ? createPortal(node, resultsEl) : node);
  const tickerLines = jobs.length === 0
    ? [sourceCount === 0 ? 'Add a source to start.' : `Ready. ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}. Press Learn my style.`]
    : [...jobs.map((j) => jobLine(j, runs[j.runId])), ...(allSettled ? [`Done · ${memories.length + ruleOptions.length} suggestions. Nothing is kept until you decide.`] : [])];
  const STATIONS = [['Read', 'docs and repos'], ['Spot patterns', 'what repeats'], ['Draft', 'memories, rules'], ['You decide', 'keep or drop']] as const;

  return (
    <div data-testid="style-pipeline">
      <div className="wk-learn-stations" role="list" aria-label="Progress">
        {STATIONS.map(([b, s], i) => (
          <div key={b} role="listitem" className="wk-learn-st" data-s={stations[i]} data-testid="style-station" aria-label={`${b}: ${stations[i] === 'done' ? 'done' : stations[i] === 'run' ? 'in progress' : 'waiting'}`}>
            <span className="wk-learn-st-ic" aria-hidden>{stations[i] === 'done' ? '✓' : i + 1}</span><b>{b}</b><span>{s}</span>
          </div>
        ))}
      </div>
      <ul className="wk-learn-ticker" aria-live="polite" data-testid="style-ticker">{tickerLines.map((l) => <li key={l}>{l}</li>)}</ul>
      <div className="wk-learn-row wk-learn-mt">
        <button type="button" className="wk-btn wk-btn--primary" data-testid="style-go" disabled={launching || sourceCount === 0 || (jobs.length > 0 && !allSettled)} onClick={onLearn}>
          {launching ? 'Starting…' : 'Learn my style'}
        </button>
        {jobs.length > 0 && <button type="button" className="wk-btn wk-btn--quiet" data-testid="style-reset" onClick={onReset}>Start over</button>}
        <span className="wk-learn-quiet" data-testid="style-runline">
          {jobs.length === 0 ? 'Runs as jobs you can watch in Jobs.' : <>Running as {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}: {jobs.map((j, i) => <a key={j.runId} className="wk-link" href={`/runs/${j.runId}`} onClick={(e) => { e.preventDefault(); navigate(`/runs/${j.runId}`); }}>{i > 0 ? ', ' : ''}{STYLE_JOB_WORDS[j.kind]}</a>)}</>}
        </span>
      </div>
      {launchError !== null && <p className="wk-learn-quiet wk-learn-bad" role="alert" data-testid="style-launch-error">{launchError}</p>}
      {waitingElsewhere.length > 0 && (
        <p className="wk-learn-quiet" data-testid="style-waiting">
          {waitingElsewhere.length === 1 ? 'A job is waiting for you before it can go on: ' : `${waitingElsewhere.length} jobs are waiting for you before they can go on: `}
          {waitingElsewhere.map((r) => <a key={r.session.id} className="wk-link" href={`/runs/${r.session.id}`} onClick={(e) => { e.preventDefault(); navigate(`/runs/${r.session.id}`); }}>open it</a>)}
        </p>
      )}
      {fail !== null && <p className="wk-learn-quiet wk-learn-bad" role="alert" data-testid="style-decide-error">{fail}</p>}
      {(memAsk !== null || rulesAsk !== null || memDone || rulesDone) && place(
        <div className="wk-learn-flow wk-ask-rows" data-testid="style-results">
          {memDone ? <AskRecord line={decided.memories!} testId="style-memories-record" /> : memAsk !== null && (
            <AskCard ask={memAsk} tag="Memories" busy={busy === 'memories'} onAnswer={(a) => void decide('memories', a)} testIds={{ root: 'style-memories' }} />
          )}
          {rulesDone ? <AskRecord line={decided.rules!} testId="style-rules-record" /> : rulesAsk !== null && (
            <AskCard ask={rulesAsk} tag="Rules" busy={busy === 'rules'} onAnswer={(a) => void decide('rules', a)} testIds={{ root: 'style-rules' }} />
          )}
        </div>,
      )}
      {allSettled && memAsk === null && ruleOptions.length === 0 && !memDone && !rulesDone && (
        <p className="wk-learn-quiet" data-testid="style-nothing">The jobs finished without a suggestion. Try a richer source: a CONTRIBUTING file, a repository with history, a few posts.</p>
      )}
    </div>
  );
}

const STYLE_JOB_WORDS: Record<StyleJob['kind'], string> = { rules: 'rules from docs', repo: 'repo style', writing: 'your writing' };

function sourceOf(p: Proposal, jobs: readonly StyleJob[]): string {
  const j = jobs.find((x) => x.runId === p.provenance['run_id']);
  return j === undefined ? 'Learn' : `${j.kind === 'writing' ? 'writing' : 'style'} · ${j.sources.join(', ')}`;
}
