import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Columns3, ListChecks, MessageSquarePlus, Network, PanelRight, Share2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { apiStatus } from '../../api/errors.js';
import type { RepoEntry, SessionView } from '../../api/types.js';
import { analysisScopeChips, askScopeWords, defaultAskRepos } from '../../board/analyzeChat.js';
import { pageChatSessionKey } from '../../board/pageChat.js';
import { readAskSession } from '../../store/askSession.js';
import { usePageChat } from '../../store/pageChat.js';
import { askPage, PageChat } from '../chat/PageChat.js';
import { answerLine, askedWithChats, forgetAsked, graphLinkRepos, questionMessage, readAsked, rememberAsked, suggestedQuestions, type AnswerLine, type AskedQuestion } from '../../board/understandModel.js';
import { knowledgeMarks } from '../../board/repoKnowledge.js';
import { knowledgeOf, useRepoKnowledgeFor } from '../../store/repoKnowledge.js';
import type { ChatHistoryEntry } from '../../api/chatHistory-wire.js';
import { relTime } from '../../board/relTime.js';
import { sessionPath } from '../../board/sessionModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { CoverageView } from '../CoverageView.js';
import { RepoGraphModal } from '../RepoGraphModal.js';
import { Skeleton } from '../ui/index.js';
import { VoiceMicButton } from '../voice/VoiceMicButton.js';

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
  const moreId = useId();
  const sideId = useId();
  const graphsRef = useRef<HTMLElement | null>(null);
  /** The sidebar on a phone: a drawer behind the header's button (always shown from 1024 px). */
  const [sideOpen, setSideOpen] = useState(false);
  /** The main column: the chat, or one of the sidebar's More views. */
  const [pane, setPane] = useState<'chat' | 'compare' | 'coverage'>('chat');
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

  // Crew's own record of the chats started here (in flight or finished), merged with this browser's.
  const [chats, setChats] = useState<ChatHistoryEntry[] | null>(null);
  useEffect(() => {
    if (!chatList) return undefined;
    let live = true;
    api.listChatHistory({ limit: 50, status: 'all' }).then((r) => { if (live) setChats(r.items ?? []); }, () => undefined);
    return () => { live = false; };
  }, [chatList, asked]);
  const recent = useMemo(() => askedWithChats(asked, chats).slice(0, RECENT_SHOWN), [asked, chats]);
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
    setPane('chat');
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const reopen = (a: AskedQuestion): void => {
    usePageChat.getState().resume('understand', a.chatId, a.question);
    setInline(true);
    setPane('chat');
    setSideOpen(false);
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
      // The sidebar's graph links (a drawer on a phone: it opens).
      setSideOpen(true);
      setTimeout(() => { const sec = graphsRef.current; if (sec !== null) { sec.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); sec.focus({ preventScroll: true }); } }, 0);
      return true;
    },
  };
  const pick = (s: string): void => { setQ(s); inputRef.current?.focus(); };
  const closeSide = (): void => setSideOpen(false);
  useEffect(() => {
    if (!sideOpen) return undefined;
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSideOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [sideOpen]);
  // The open conversation, marked in Recent answers.
  const openChatId = inline ? readAskSession(pageChatSessionKey('understand'))?.chatId ?? null : null;

  return (
    <div className="wk-ue wk-uc" data-testid="understand-page" data-side={sideOpen ? 'open' : 'closed'} data-pane={pane}>
      <div className="wk-uc-main">
        <header className="wk-uc-head">
          <div className="wk-pagetitle">
            <h1 className="wk-uc-title">Understand</h1>
            {(inline || pane !== 'chat') && (
              <button type="button" className="wk-pagechat-titlebtn" data-testid="understand-new-question" aria-label="New question" title="New question" onClick={newQuestion}>
                <MessageSquarePlus size={18} aria-hidden />
              </button>
            )}
          </div>
          <button type="button" className="wk-pagechat-titlebtn wk-uc-sidebtn" data-testid="understand-side-toggle" aria-expanded={sideOpen} aria-controls={sideId}
            aria-label={sideOpen ? 'Hide recent answers and graphs' : 'Recent answers and graphs'} title="Recent answers and graphs" onClick={() => setSideOpen((v) => !v)}>
            <PanelRight size={18} aria-hidden />
          </button>
        </header>

        {pane !== 'chat' && (
          <div className="wk-uc-back">
            <button type="button" className="wk-ue-link wk-ue-linkbtn wk-ue-back" data-testid="understand-back" onClick={() => setPane('chat')}>
              <ArrowLeft size={14} aria-hidden />Back to the chat
            </button>
          </div>
        )}

        {/* Compare side by side stays mounted (its picks survive a trip back to the chat), shown on its own pane. */}
        <div className="wk-uc-body wk-uc-pane" data-testid="understand-compare" hidden={pane !== 'compare'}>
          <div className="wk-uc-measure wk-uc-measure--wide">
            <h2 className="wk-uc-pane-title">Compare side by side</h2>
            {compare}
          </div>
        </div>
        {pane === 'coverage' && (
          <div className="wk-uc-body wk-uc-pane" data-testid="understand-coverage">
            <div className="wk-uc-measure wk-uc-measure--wide">
              <h2 className="wk-uc-pane-title">Coverage: which code is tied to a requirement</h2>
              <CoverageView />
            </div>
          </div>
        )}

        {pane === 'chat' && inline && (
          <div className="wk-ue-chat wk-uc-chat" data-testid="understand-chat">
            <PageChat kind="understand" runs={runs as SessionView[]} navigate={navigate} variant="inline" chips={chips} provider={provider} />
          </div>
        )}

        {pane === 'chat' && !inline && (
          <div className="wk-uc-body wk-uc-empty">
            <div className="wk-uc-measure wk-uc-hello">
              <h2 className="wk-uc-hello-title">What do you want to know about your code?</h2>
              <p className="wk-ue-sentence">Ask how your code fits together. Answers cite the code they come from, right here.</p>
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
              <ul className="wk-ue-chips wk-uc-suggest" aria-label="Suggested questions">
                {suggestions.map((s) => (
                  <li key={s}><button type="button" className="wk-ue-chip" data-testid="understand-suggest" onClick={() => pick(s)}>{s}</button></li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* The composer, pinned under the thread (the chat draws its own once a question is asked). */}
        <div className="wk-ue-askwrap wk-uc-composer" hidden={inline || pane !== 'chat'}>
          <form className="wk-ue-ask wk-uc-measure" role="search" aria-label="Ask about your code" onSubmit={ask} data-testid="understand-ask">
            <label htmlFor={boxId} className="wk-visually-hidden">Your question</label>
            <input id={boxId} ref={inputRef} type="text" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
              placeholder="e.g. Who calls the deliver step?" className="wk-ue-ask-input" data-testid="understand-ask-input" />
            <VoiceMicButton size="xs" testId="understand-ask-voice" />
            <button type="submit" className="wk-ue-btn wk-ue-btn--primary" data-testid="understand-ask-send">Ask</button>
          </form>
        </div>
      </div>

      {sideOpen && <div className="wk-uc-scrim" aria-hidden onClick={closeSide} />}
      <aside id={sideId} className="wk-uc-side" data-testid="understand-side" aria-label="Recent answers and repository graphs">
        <section className="wk-uc-sec" aria-labelledby={recentId} data-testid="understand-recent">
          <h2 id={recentId} className="wk-uc-label">Recent answers</h2>
          {recent.length === 0 ? (
            <p className="wk-uc-quiet" data-testid="understand-recent-empty">Nothing asked yet. Your questions are listed here, and each one reopens its conversation.</p>
          ) : (
            <ul className="wk-uc-rows">
              {recent.map((a) => {
                const read = answers[a.chatId];
                const sub = subLine(read, chatList, capsLoaded);
                const path = sessionPath(a.chatId);
                const current = a.chatId === openChatId && pane === 'chat';
                return (
                  <li key={a.chatId}>
                    <a href={path} aria-current={current ? 'true' : undefined}
                      onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); reopen(a); }}
                      className="wk-uc-row" data-testid="understand-answer" data-state={sub.state}>
                      <span className="wk-ue-dot" data-tone={sub.state} aria-hidden />
                      <span className="wk-uc-row-main">
                        <span className="wk-uc-row-title">{a.question}</span>
                        <span className="wk-uc-row-sub" data-testid="understand-answer-sub">{sub.text}</span>
                      </span>
                      <span className="wk-uc-row-meta" title={new Date(a.at).toLocaleString()}>{relTime(a.at, now)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <RepoGraphLinks repos={repos} failed={reposFailed} scope={scopeRepos.map((r) => r.id)} runs={runs} now={now} navigate={navigate} sectionRef={graphsRef} />

        <section className="wk-uc-sec" aria-labelledby={moreId}>
          <h2 id={moreId} className="wk-uc-label">More</h2>
          <ul className="wk-uc-more">
            <li>
              <button type="button" className="wk-uc-morebtn" data-testid="understand-compare-toggle" aria-pressed={pane === 'compare'} onClick={() => { setPane(pane === 'compare' ? 'chat' : 'compare'); closeSide(); }}>
                <Columns3 size={16} aria-hidden /><span>Compare side by side</span>
              </button>
            </li>
            <li>
              <button type="button" className="wk-uc-morebtn" data-testid="understand-coverage-toggle" aria-pressed={pane === 'coverage'} onClick={() => { setPane(pane === 'coverage' ? 'chat' : 'coverage'); closeSide(); }}>
                <ListChecks size={16} aria-hidden /><span>Coverage</span>
              </button>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

/** The sidebar's quick links: each repository in scope (all of them when none is chosen), its code graph and its
 *  requirements graph, each with its state as a dot (board/repoKnowledge.ts). */
function RepoGraphLinks({ repos, failed, scope, runs, now, navigate, sectionRef }: {
  repos: RepoEntry[] | null; failed: boolean; scope: readonly string[]; runs: readonly SessionView[]; now: number; navigate: Navigate;
  sectionRef: React.MutableRefObject<HTMLElement | null>;
}): React.ReactElement {
  const titleId = useId();
  const shown = useMemo(() => graphLinkRepos(repos ?? [], scope), [repos, scope]);
  const knowledge = useRepoKnowledgeFor(shown.map((r) => r.id));
  const [graphOf, setGraphOf] = useState<{ repo: RepoEntry; view: 'code' | 'domain' } | null>(null);
  return (
    <section ref={(el) => { sectionRef.current = el; }} className="wk-uc-sec" aria-labelledby={titleId} data-testid="understand-graph" tabIndex={-1}>
      <h2 id={titleId} className="wk-uc-label">{scope.length > 0 ? 'Graphs for these repositories' : 'Repository graphs'}</h2>
      {repos === null ? (
        failed ? <p className="wk-uc-quiet" role="alert">Couldn’t read your repositories.</p> : <Skeleton rows={2} variant="row" />
      ) : repos.length === 0 ? (
        <p className="wk-uc-quiet" data-testid="understand-graph-empty">No repositories yet. Add one on Repositories, and its graph is built when it is indexed.</p>
      ) : (
        <ul className="wk-uc-graphs" aria-label="Repositories">
          {shown.map((r) => {
            const marks = knowledgeMarks(r, runs, knowledgeOf(knowledge, r.id), now);
            const code = marks.find((m) => m.id === 'code')!;
            const req = marks.find((m) => m.id === 'reqgraph')!;
            const page = `/repo-detail/${encodeURIComponent(r.id)}`;
            return (
              <li key={r.id} className="wk-uc-graph" data-testid="understand-graph-repo" data-repo-id={r.id}>
                <a href={page} className="wk-uc-graph-name" onClick={(e) => { e.preventDefault(); navigate(page); }}>{r.name}</a>
                <span className="wk-uc-graph-links">
                  <button type="button" className="wk-uc-graphbtn" data-testid="understand-graph-open" data-tone={code.tone} title={code.title} onClick={() => setGraphOf({ repo: r, view: 'code' })}>
                    <span className="wk-know-dot" aria-hidden /><Network size={14} aria-hidden />Code graph
                  </button>
                  <button type="button" className="wk-uc-graphbtn" data-testid="understand-graph-req" data-tone={req.tone} title={req.title} onClick={() => setGraphOf({ repo: r, view: 'domain' })}>
                    <span className="wk-know-dot" aria-hidden /><Share2 size={14} aria-hidden />Requirements graph
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {repos !== null && repos.length > shown.length && (
        <a href="/repos" className="wk-ue-link wk-uc-all" onClick={(e) => { e.preventDefault(); navigate('/repos'); }}>All {repos.length} repositories</a>
      )}
      {graphOf !== null && <RepoGraphModal repo={graphOf.repo} initialView={graphOf.view} onClose={() => setGraphOf(null)} />}
    </section>
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
