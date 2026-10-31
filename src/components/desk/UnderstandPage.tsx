import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { apiStatus } from '../../api/errors.js';
import type { RepoEntry, SessionView } from '../../api/types.js';
import { analysisScopeChips, askScopeWords, defaultAskRepos } from '../../board/analyzeChat.js';
import { pageChatSessionKey } from '../../board/pageChat.js';
import { readAskSession } from '../../store/askSession.js';
import { usePageChat } from '../../store/pageChat.js';
import { askPage, PageChat } from '../chat/PageChat.js';
import { answerLine, forgetAsked, questionMessage, readAsked, rememberAsked, suggestedQuestions, type AnswerLine, type AskedQuestion } from '../../board/understandModel.js';
import { relTime } from '../../board/relTime.js';
import { sessionPath } from '../../board/sessionModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { CoverageView } from '../CoverageView.js';
import { RepoGraphModal } from '../RepoGraphModal.js';
import { Skeleton } from '../ui/index.js';

/** Recent answers shows this many; the rest stay remembered. */
const RECENT_SHOWN = 5;
/** While an answer is still coming, its chat is read again this often (and at most this many times). */
const PENDING_EVERY_MS = 10_000;
const PENDING_MAX_READS = 30;

type AnswerRead =
  | { phase: 'loading' }
  | { phase: 'ok'; line: AnswerLine; open: boolean }
  | { phase: 'failed' };

/**
 * UNDERSTAND (the calm page; desk-pages-redesign mockup, operator 2026-10-26: "needs more whitespace,
 * easy to scan … think humans, we get overwhelmed easy"). One column: the title and one sentence, ONE
 * question box with three suggested questions under it, then Recent answers as roomy rows. The
 * question is the operator's own and is sent from here as the first message of a new chat (the
 * answer opens in the chat window, cited by the chat's citation check). Everything else is folded
 * away, closed until asked for: Explore the graph (each repository's code graph with its hotspots
 * and blast radius, and coverage) and Compare side by side (the comparison and its analysis job).
 */
export function UnderstandPage({ project, navigate, now, compare, runs = [] }: {
  /** The project on screen (a project's page): the chat is scoped to it. */
  project: string | null;
  /** The jobs the page already holds: the default repository is the most active one this week. */
  runs?: readonly SessionView[];
  navigate: Navigate;
  now: number;
  /** Compare side by side (DeskUnderstand), folded away. */
  compare: React.ReactNode;
}): React.ReactElement {
  const boxId = useId();
  const recentId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState<AskedQuestion[]>(() => readAsked());
  const [repos, setRepos] = useState<RepoEntry[] | null>(() => getCachedRepos());
  const [reposFailed, setReposFailed] = useState(false);
  const chatList = useCapabilities((s) => s.chatList);
  const capsLoaded = useCapabilities((s) => s.loaded);

  useEffect(() => {
    let live = true;
    fetchReposCached().then((r) => { if (live) setRepos(r); }, () => { if (live) setReposFailed(true); });
    return () => { live = false; };
  }, []);

  const recent = asked.slice(0, RECENT_SHOWN);
  const answers = useAnswers(recent, chatList, (id) => setAsked(forgetAsked(id)));
  // crew#1157: the repositories the question is about (the analysis chat's scope). `null` = the
  // default for this page until the operator picks.
  const onProject = project !== null && project !== 'default';
  const [picked, setPicked] = useState<string[] | null>(null);
  // On a project's page, its repositories (read once; a failed read leaves the project as the scope).
  const [projectRepoIds, setProjectRepoIds] = useState<string[] | null>(null);
  useEffect(() => {
    setProjectRepoIds(null);
    if (!onProject) return undefined;
    let live = true;
    api.listProjectMembers(project).then(
      (r) => { if (live) setProjectRepoIds(r.members.filter((m) => m.member_kind === 'crew.repo').map((m) => m.member_ref)); },
      () => { if (live) setProjectRepoIds([]); },
    );
    return () => { live = false; };
  }, [onProject, project]);
  const chosen = useMemo(
    () => picked ?? defaultAskRepos(repos ?? [], { projectRepoIds: onProject ? projectRepoIds ?? [] : null, runs, now }),
    [picked, repos, onProject, projectRepoIds, runs, now],
  );
  // The suggested questions name exactly the chosen repositories (never one the question would not read).
  const suggestions = useMemo(
    () => suggestedQuestions((repos ?? []).filter((r) => chosen.includes(r.id)).map((r) => r.name)),
    [repos, chosen],
  );
  const toggle = (id: string): void => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  // DES-LEARN §6.2: the chat is the page. The question box is the first message of a NEW chat running crew's
  // read-only `analyze` workflow on the chosen repositories (a plain chat on a crew that does not run it); the
  // cited answer, the guided "What next?" and follow-ups grow under it here. Recent answers reopen in place.
  const [inline, setInline] = useState(() => readAskSession(pageChatSessionKey('understand')) !== null);
  const pendingQuestion = useRef<string | null>(null);
  const scopeRepos = useMemo(() => (repos ?? []).filter((r) => chosen.includes(r.id)).map((r) => ({ id: r.id, name: r.name })), [repos, chosen]);
  const pname = onProject ? project : null;
  const chips = useMemo(() => analysisScopeChips(scopeRepos, pname === null ? null : { id: pname, name: pname }), [scopeRepos, pname]);
  const ask = (e: React.FormEvent): void => {
    e.preventDefault();
    const question = q.trim();
    if (question === '') { inputRef.current?.focus(); return; }
    pendingQuestion.current = question;
    setInline(true);
    askPage('understand', { text: questionMessage(question), send: true, fresh: true });
    setQ('');
  };
  const newQuestion = (): void => {
    usePageChat.getState().fresh('understand');
    setInline(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const reopen = (a: AskedQuestion): void => {
    usePageChat.getState().resume('understand', a.chatId, a.question);
    setInline(true);
  };
  const provider = {
    knows: scopeRepos.length === 0 ? (onProject ? 'Reads this project’s repositories · read-only' : 'Reads all repositories · read-only')
      : `Reads ${scopeRepos.map((r) => r.name).join(', ')} · read-only`,
    data: () => [],
    onSent: (_text: string, chatId: string) => {
      const question = pendingQuestion.current;
      pendingQuestion.current = null;
      if (question !== null && !asked.some((x) => x.chatId === chatId)) setAsked(rememberAsked({ chatId, question, at: Date.now() }));
    },
    onMove: (m: string) => {
      if (m !== 'graph') return false;
      const fold = document.querySelector<HTMLDetailsElement>('[data-testid="understand-graph"]');
      if (fold !== null) { fold.open = true; fold.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      return true;
    },
  };
  const pick = (s: string): void => { setQ(s); inputRef.current?.focus(); };

  return (
    <div className="wk-ue" data-testid="understand-page">
      <div className="wk-ue-col">
        <header className="wk-ue-head">
          <div className="wk-ue-head-words">
            <h1 className="wk-ue-title">Understand</h1>
            <p className="wk-ue-sentence">Ask how your code fits together. Answers cite the code they come from, right here.</p>
          </div>
          {inline && (
            <div className="wk-ue-head-acts">
              <button type="button" className="wk-ue-btn wk-ue-btn--secondary" data-testid="understand-new-question" onClick={newQuestion}>New question</button>
            </div>
          )}
        </header>

        {inline && (
          <div className="wk-ue-chat" data-testid="understand-chat">
            <PageChat kind="understand" runs={runs as SessionView[]} navigate={navigate} variant="inline" chips={chips} provider={provider} />
          </div>
        )}

        <div className="wk-ue-askwrap" hidden={inline}>
          <form className="wk-ue-ask" role="search" aria-label="Ask about your code" onSubmit={ask} data-testid="understand-ask">
            <label htmlFor={boxId} className="wk-visually-hidden">Your question</label>
            <input id={boxId} ref={inputRef} type="text" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
              placeholder="e.g. Who calls the deliver step?" className="wk-ue-ask-input" data-testid="understand-ask-input" />
            <button type="submit" className="wk-ue-btn wk-ue-btn--primary" data-testid="understand-ask-send">Ask</button>
          </form>
          {repos !== null && repos.length > 1 && (
            <div className="wk-ue-scope" role="group" aria-label="Repositories to ask about" data-testid="understand-scope">
              <ul className="wk-ue-chips">
                {repos.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="wk-ue-chip wk-ue-chip--pick" aria-pressed={chosen.includes(r.id)} data-testid="understand-scope-repo" data-repo-id={r.id} onClick={() => toggle(r.id)}>
                      {r.name}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="wk-ue-quiet" data-testid="understand-scope-words">{askScopeWords(chosen.length, onProject)}</p>
            </div>
          )}
          <ul className="wk-ue-chips" aria-label="Suggested questions">
            {suggestions.map((s) => (
              <li key={s}><button type="button" className="wk-ue-chip" data-testid="understand-suggest" onClick={() => pick(s)}>{s}</button></li>
            ))}
          </ul>
        </div>

        <section className="wk-ue-sec" aria-labelledby={recentId} data-testid="understand-recent">
          <h2 id={recentId} className="wk-ue-label">Recent answers</h2>
          {recent.length === 0 ? (
            <p className="wk-ue-quiet" data-testid="understand-recent-empty">Nothing asked yet. Ask a question above: the answer comes in on this page, and it is listed here.</p>
          ) : (
            <ul className="wk-ue-rows">
              {recent.map((a) => {
                const read = answers[a.chatId];
                const sub = subLine(read, chatList, capsLoaded);
                const path = sessionPath(a.chatId);
                return (
                  <li key={a.chatId}>
                    <a href={path} onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); reopen(a); }} className="wk-ue-row" data-testid="understand-answer" data-state={sub.state}>
                      <span className="wk-ue-dot" data-tone={sub.state} aria-hidden />
                      <span className="wk-ue-row-main">
                        <span className="wk-ue-row-title">{a.question}</span>
                        <span className="wk-ue-row-sub" data-testid="understand-answer-sub">{sub.text}</span>
                      </span>
                      <span className="wk-ue-row-meta" title={new Date(a.at).toLocaleString()}>{relTime(a.at, now)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="wk-ue-folds">
          <ExploreGraph repos={repos} failed={reposFailed} navigate={navigate} />
          <Fold title="Compare side by side" sub="Agents, workflows, jobs or projects next to each other, and an analysis job that explains the difference." testId="understand-compare" toggleId="understand-compare-toggle">
            {compare}
          </Fold>
        </div>
      </div>
    </div>
  );
}

/** A section folded away until asked for: a roomy summary row with a chevron that turns. */
function Fold({ title, sub, testId, toggleId, children, onOpen }: { title: string; sub: string; testId: string; toggleId: string; children: React.ReactNode; onOpen?: (open: boolean) => void }): React.ReactElement {
  return (
    <details className="wk-ue-fold" data-testid={testId} onToggle={(e) => onOpen?.((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="wk-ue-fold-sum" data-testid={toggleId}>
        <span className="wk-ue-fold-words">
          <span className="wk-ue-fold-title">{title}</span>
          <span className="wk-ue-fold-sub">{sub}</span>
        </span>
        <ChevronRight size={18} aria-hidden className="wk-ue-fold-chev" />
      </summary>
      <div className="wk-ue-fold-body">{children}</div>
    </details>
  );
}

/** Explore the graph: each repository's code graph (with its hotspots and blast radius), and coverage. */
function ExploreGraph({ repos, failed, navigate }: { repos: RepoEntry[] | null; failed: boolean; navigate: Navigate }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [graphOf, setGraphOf] = useState<RepoEntry | null>(null);
  const [coverage, setCoverage] = useState(false);
  return (
    <Fold title="Explore the graph" sub="Each repository’s code graph: hotspots, blast radius and coverage." testId="understand-graph" toggleId="understand-graph-toggle" onOpen={setOpen}>
      {!open ? null : repos === null ? (
        failed ? <p className="wk-ue-quiet" role="alert">Couldn’t read your repositories.</p> : <Skeleton rows={3} variant="row" />
      ) : repos.length === 0 ? (
        <p className="wk-ue-quiet" data-testid="understand-graph-empty">No repositories yet. Add one on Repositories, and its graph is built when it is indexed.</p>
      ) : (
        <>
          <ul className="wk-ue-rows" aria-label="Repositories">
            {repos.map((r) => (
              <li key={r.id} className="wk-ue-repo" data-testid="understand-graph-repo">
                <span className="wk-ue-row-main"><span className="wk-ue-row-title">{r.name}</span></span>
                <span className="wk-ue-repo-acts">
                  <button type="button" className="wk-ue-btn wk-ue-btn--secondary wk-ue-btn--sm" data-testid="understand-graph-open" onClick={() => setGraphOf(r)}>Open the graph</button>
                  <a href={`/repo-detail/${encodeURIComponent(r.id)}`} className="wk-ue-link" onClick={(e) => { e.preventDefault(); navigate(`/repo-detail/${encodeURIComponent(r.id)}`); }}>Repository page</a>
                </span>
              </li>
            ))}
          </ul>
          <div className="wk-ue-cov">
            <button type="button" className="wk-ue-link wk-ue-linkbtn" aria-expanded={coverage} data-testid="understand-coverage-toggle" onClick={() => setCoverage((c) => !c)}>
              {coverage ? 'Hide coverage' : 'Show coverage: which code is tied to a requirement'}
            </button>
            {coverage && <div className="wk-ue-cov-body" data-testid="understand-coverage"><CoverageView /></div>}
          </div>
        </>
      )}
      {graphOf !== null && <RepoGraphModal repo={graphOf} onClose={() => setGraphOf(null)} />}
    </Fold>
  );
}

type SubState = 'answered' | 'pending' | 'none' | 'unknown';

function subLine(read: AnswerRead | undefined, chatList: boolean, capsLoaded: boolean): { text: string; state: SubState } {
  if (capsLoaded && !chatList) return { text: 'Open it to read the answer', state: 'unknown' };
  if (read === undefined || read.phase === 'loading') return { text: 'Reading the answer…', state: 'unknown' };
  if (read.phase === 'failed') return { text: 'Couldn’t read this answer just now', state: 'unknown' };
  const { line, open } = read;
  if (!line.answered) return open ? { text: 'Answering now…', state: 'pending' } : { text: 'No answer came back', state: 'none' };
  const cites = line.cites.length > 0 ? `Cites ${line.cites.join(', ')}` : '';
  return { text: [line.summary, cites].filter((x) => x !== '').join(' · ') || 'Answered', state: 'answered' };
}

/** Each shown question's answer, read from its chat; a chat the daemon no longer has is forgotten. */
function useAnswers(shown: readonly AskedQuestion[], chatList: boolean, onGone: (chatId: string) => void): Record<string, AnswerRead> {
  const [reads, setReads] = useState<Record<string, AnswerRead>>({});
  const [tick, setTick] = useState(0);
  const polls = useRef(0);
  const gone = useRef(onGone);
  gone.current = onGone;
  const key = shown.map((a) => a.chatId).join('|');

  useEffect(() => {
    if (!chatList) return undefined;
    let live = true;
    for (const a of shown) {
      api.getChatMessages(a.chatId).then(
        (r) => { if (live) setReads((m) => ({ ...m, [a.chatId]: { phase: 'ok', line: answerLine(r.messages), open: r.chat.status === 'open' } })); },
        (e: unknown) => {
          if (!live) return;
          // Not opened yet (the ask is on its way) reads as pending; a chat gone for good is forgotten.
          if (apiStatus(e) === 404) {
            if (Date.now() - a.at < 60_000) setReads((m) => ({ ...m, [a.chatId]: { phase: 'ok', line: { answered: false, summary: '', cites: [] }, open: true } }));
            else gone.current(a.chatId);
            return;
          }
          setReads((m) => ({ ...m, [a.chatId]: m[a.chatId]?.phase === 'ok' ? m[a.chatId]! : { phase: 'failed' } }));
        },
      );
    }
    return () => { live = false; };
  }, [key, chatList, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // An answer still coming is read again, a bounded number of times.
  const pending = shown.some((a) => { const r = reads[a.chatId]; return r?.phase === 'ok' && !r.line.answered && r.open; });
  useEffect(() => {
    if (!pending || polls.current >= PENDING_MAX_READS) return undefined;
    const t = setTimeout(() => { polls.current += 1; setTick((n) => n + 1); }, PENDING_EVERY_MS);
    return () => clearTimeout(t);
  }, [pending, tick]);
  return reads;
}
