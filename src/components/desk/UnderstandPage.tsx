import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Columns3, Database, ListChecks, MessageSquarePlus, Network, PanelRight, Share2, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { apiStatus } from '../../api/errors.js';
import type { RepoEntry, SessionView } from '../../api/types.js';
import { analysisScopeChips, askScopeWords, defaultAskRepos } from '../../board/analyzeChat.js';
import { pageChatSessionKey } from '../../board/pageChat.js';
import { readAskSession } from '../../store/askSession.js';
import { usePageChat } from '../../store/pageChat.js';
import { askPage, PageChat } from '../chat/PageChat.js';
import { answerLine, askedWithChats, forgetAsked, graphLinkRepos, questionMessage, readAsked, rememberAsked, suggestedQuestions, type AnswerLine, type AskedQuestion } from '../../board/understandModel.js';
import { knowledgeMarks, type KnowMark } from '../../board/repoKnowledge.js';
import type { ScopeChip } from '../../board/chatScopes.js';
import { knowledgeOf, useRepoKnowledgeFor } from '../../store/repoKnowledge.js';
import type { ChatHistoryEntry } from '../../api/chatHistory-wire.js';
import { relTime } from '../../board/relTime.js';
import { sessionPath } from '../../board/sessionModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { CoverageView } from '../CoverageView.js';
import { RepoGraphModal } from '../RepoGraphModal.js';
import { KnowledgeView } from './KnowledgeView.js';
import { Skeleton } from '../ui/index.js';
import { VoiceMicButton } from '../voice/VoiceMicButton.js';
import { isTopModal, useLayerStore } from '../../store/layers.js';
import { isShortcutsPaletteOpen } from '../../hooks/useGlobalShortcuts.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { useVoiceStore } from '../../store/voice.js';

/** The main column's views: the chat, or one the sidebar's More list opens. */
type Pane = 'chat' | 'compare' | 'coverage' | 'knowledge';

/** Below this the sidebar is a drawer (understand-chat.css uses the same width). */
const NARROW_QUERY = '(max-width: 1023px)';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useNarrow(): boolean {
  const read = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = (): void => setNarrow(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

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
 * UNDERSTAND, a chat page (operator, round 10: "should look more like a chatgpt chat except with a right sidebar
 * that allows you to see recent q&a and has quick links to the repo graphs (code and requirements)").
 *  - Main column: before a question, a greeting with the repository chips and three suggested questions, and the
 *    question box pinned at the bottom (mic + Ask); once asked (or a recent answer reopened), the page chat
 *    (`PageChat`, crew's read-only `analyze` workflow on the chosen repositories) fills the column with its own
 *    composer at the bottom. The chat stays mounted while Compare side by side or Coverage takes the column.
 *  - Right sidebar: Recent answers (crew's chat history merged with this browser's, each reopening in place, the
 *    open one marked), the code and requirements graph links of the repositories the conversation is about (all
 *    of them before any is chosen; their state is read once a minute through store/repoKnowledge), and More.
 *  - Under 1024 px the sidebar is a modal drawer behind the header's button.
 */
export function UnderstandPage({ project, navigate, now, compare, runs = [], search }: {
  /** The project on screen (a project's page): the chat is scoped to it. */
  project: string | null;
  /** The jobs the page already holds: the default repository is the most active one this week. */
  runs?: readonly SessionView[];
  navigate: Navigate;
  now: number;
  /** Compare side by side (DeskUnderstand), folded away. */
  compare: React.ReactNode;
  /** The address's query (the router's): `?view=knowledge` is the Knowledge map, kept in step both ways. */
  search?: string;
}): React.ReactElement {
  const boxId = useId();
  const recentId = useId();
  const moreId = useId();
  const sideId = useId();
  const graphsRef = useRef<HTMLElement | null>(null);
  const sideRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const narrow = useNarrow();
  /** The sidebar under 1024 px: a drawer behind the header's button (always shown from 1024 px). */
  const [sideOpen, setSideOpen] = useState(false);
  /** The sidebar is open as a modal drawer (under 1024 px). */
  const drawer = narrow && sideOpen;
  /** A repository's graph, opened from the sidebar (drawn outside it, so a drawer closing never hides it). */
  const [graphOf, setGraphOf] = useState<{ repo: RepoEntry; view: 'code' | 'domain' } | null>(null);
  /** The main column: the chat, or one of the sidebar's More views (`?view=knowledge` opens the Knowledge map). */
  const [pane, setPane] = useState<Pane>(() => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'knowledge' ? 'knowledge' : 'chat'));
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
  /** The conversation on screen (Recent answers marks it): the one reopened or just asked, or the page's kept one. */
  const [openChat, setOpenChat] = useState<string | null>(() => readAskSession(pageChatSessionKey('understand'))?.chatId ?? null);
  /** The repositories the open conversation is about (its graph links): recorded when it was asked, kept with it. `null` =
   *  not recorded (the page's own choice stands in). */
  const [openScope, setOpenScope] = useState<string[] | null>(() => {
    const kept = readAskSession(pageChatSessionKey('understand'));
    return repoIdsOf(kept?.chips) ?? readAsked().find((a) => a.chatId === kept?.chatId)?.repos ?? null;
  });
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
    setOpenChat(null);
    setOpenScope(scopeRepos.map((r) => r.id));
    askPage('understand', { text: questionMessage(question), send: true, fresh: true });
    setQ('');
  };
  // The Knowledge map has an address (a review link lands on it): the pane follows it, and it follows the pane.
  const wantsKnowledge = search === undefined ? null : new URLSearchParams(search).get('view') === 'knowledge';
  useEffect(() => {
    if (wantsKnowledge === null) return;
    setPane((cur) => (wantsKnowledge ? 'knowledge' : cur === 'knowledge' ? 'chat' : cur));
  }, [wantsKnowledge]);
  const syncUrl = (next: Pane): void => {
    if (search === undefined || (next === 'knowledge') === wantsKnowledge) return;
    const q = new URLSearchParams(search);
    if (next === 'knowledge') q.set('view', 'knowledge');
    else q.delete('view');
    const rest = q.toString();
    navigate(`${window.location.pathname}${rest === '' ? '' : `?${rest}`}`, { replace: true });
  };
  const newQuestion = (): void => {
    usePageChat.getState().fresh('understand');
    setInline(false);
    setOpenChat(null);
    setOpenScope(null);
    syncUrl('chat');
    setPane('chat');
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const reopen = (a: AskedQuestion): void => {
    usePageChat.getState().resume('understand', a.chatId, a.question);
    setInline(true);
    setOpenChat(a.chatId);
    setOpenScope(a.repos ?? null);
    syncUrl('chat');
    setPane('chat');
    if (drawer) closeSide('content'); else focusContent();
  };
  const provider = {
    knows: scopeRepos.length === 0 ? (onProject ? 'Reads this project’s repositories · read-only' : 'Reads all repositories · read-only')
      : `Reads ${scopeRepos.map((r) => r.name).join(', ')} · read-only`,
    data: () => [],
    onSent: (_text: string, chatId: string) => {
      const question = pendingQuestion.current;
      pendingQuestion.current = null;
      // A follow-up in the conversation on screen keeps the scope it already has (a reopened one's, recorded with it).
      const sameChat = chatId === openChat;
      setOpenChat(chatId);
      if (sameChat && question === null) return;
      // A new conversation (asked here, or the chat's own New chat): the repositories its chat chose (it persists its
      // chips before this is called; they may have changed after a failed open), else the page's choice.
      const kept = readAskSession(pageChatSessionKey('understand'));
      const repos = (kept?.chatId === chatId ? repoIdsOf(kept.chips) : null) ?? scopeRepos.map((r) => r.id);
      setOpenScope(repos);
      if (question !== null && !asked.some((x) => x.chatId === chatId)) setAsked(rememberAsked({ chatId, question, at: Date.now(), repos }));
    },
    onMove: (m: string) => {
      if (m !== 'graph') return false;
      // The sidebar's graph links (under 1024 px the drawer opens on them).
      if (narrow) setSideOpen(true);
      setTimeout(() => { const sec = graphsRef.current; if (sec !== null) { sec.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); sec.focus({ preventScroll: true }); } }, 0);
      return true;
    },
  };
  const pick = (s: string): void => { setQ(s); inputRef.current?.focus(); };
  // The drawer (under 1024 px) is a modal: the modal rung, the page behind inert, focus in and contained, Escape or the
  // scrim out (focus back to its button); voice mode opening, or the window growing past it, closes it.
  const focusAfter = useRef<'toggle' | 'content' | null>(null);
  const closeSide = (to: 'toggle' | 'content' | null = 'toggle'): void => { focusAfter.current = to; setSideOpen(false); };
  /** Focus what the main column now shows: a pane's way back, else the conversation's box, else the question box. */
  const focusContent = (): void => {
    setTimeout(() => {
      const root = mainRef.current;
      const pick = (sel: string): HTMLElement | null => {
        const el = root?.querySelector<HTMLElement>(sel) ?? null;
        return el !== null && el.closest('[hidden]') === null ? el : null;
      };
      (pick('[data-testid="understand-back"]') ?? pick('[data-testid="assist-input"]') ?? pick('[data-testid="understand-ask-input"]')
        ?? pick('[data-testid="understand-chat"]'))?.focus();
    }, 0);
  };
  const showPane = (next: Pane): void => {
    syncUrl(next);
    setPane(next);
    if (drawer) closeSide('content'); else focusContent();
  };
  useEffect(() => { if (!narrow && sideOpen) setSideOpen(false); }, [narrow, sideOpen]);
  const voiceOn = useVoiceStore((st) => st.phase !== 'off');
  useEffect(() => { if (voiceOn && sideOpen) closeSide(null); }, [voiceOn, sideOpen]);
  useEffect(() => {
    if (!drawer) return undefined;
    const id = useLayerStore.getState().pushModal();
    const main = mainRef.current;
    const tg = toggleRef.current;
    main?.setAttribute('inert', '');
    sideRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      // The shortcut overlay and the palette sit above the drawer: they take Escape and the keyboard first (Modal.tsx's chain).
      if (useLayerStore.getState().shortcutOverlayOpen || isShortcutsPaletteOpen() || !isTopModal(id)) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeSide('toggle'); return; }
      if (e.key !== 'Tab' || sideRef.current === null) return;
      const els = [...sideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (els.length === 0) return;
      const a = els[0]!; const z = els[els.length - 1]!;
      // Focus outside the drawer's controls (on the drawer itself, a heading, the page) comes back in.
      if (!els.includes(document.activeElement as HTMLElement)) { e.preventDefault(); (e.shiftKey ? z : a).focus(); return; }
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    // A modal opened from the drawer (a repository's graph) takes over: the drawer steps aside.
    const offRung = useLayerStore.subscribe((st) => {
      if (st.modalIds.includes(id) && st.modalIds[st.modalIds.length - 1] !== id) { focusAfter.current = null; setSideOpen(false); }
    });
    return () => {
      offRung();
      document.removeEventListener('keydown', onKey, true);
      useLayerStore.getState().popModal(id);
      main?.removeAttribute('inert');
      const to = focusAfter.current; focusAfter.current = null;
      if (to === 'toggle') tg?.focus();
      else if (to === 'content') focusContent();
    };
  }, [drawer]);
  // The repositories a conversation is about: the open chat's own (recorded with it), else the page's choice.
  const graphScope = useMemo(() => (inline && openScope !== null ? openScope : scopeRepos.map((r) => r.id)), [inline, openScope, scopeRepos]);
  // The open conversation, marked in Recent answers.
  const openChatId = inline ? openChat : null;

  return (
    <div className="wk-ue wk-uc" data-testid="understand-page" data-side={sideOpen ? 'open' : 'closed'} data-pane={pane}>
      <div className="wk-uc-main" ref={mainRef}>
        <header className="wk-uc-head">
          <div className="wk-pagetitle">
            <h1 className="wk-uc-title">Understand</h1>
            {(inline || pane !== 'chat') && (
              <button type="button" className="wk-pagechat-titlebtn" data-testid="understand-new-question" aria-label="New question" title="New question" onClick={newQuestion}>
                <MessageSquarePlus size={18} aria-hidden />
              </button>
            )}
          </div>
          <button ref={toggleRef} type="button" className="wk-pagechat-titlebtn wk-uc-sidebtn" data-testid="understand-side-toggle" aria-expanded={sideOpen} aria-controls={sideId}
            aria-label={sideOpen ? 'Hide recent answers and graphs' : 'Recent answers and graphs'} title="Recent answers and graphs" onClick={() => setSideOpen((v) => !v)}>
            <PanelRight size={18} aria-hidden />
          </button>
        </header>

        {pane !== 'chat' && (
          <div className="wk-uc-back">
            <button type="button" className="wk-ue-link wk-ue-linkbtn wk-ue-back" data-testid="understand-back" onClick={() => showPane('chat')}>
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

        {pane === 'knowledge' && (
          <div className="wk-uc-body wk-uc-pane" data-testid="understand-knowledge">
            <div className="wk-uc-measure wk-uc-measure--wide">
              <h2 className="wk-uc-pane-title">Knowledge: what connects to what</h2>
              <KnowledgeView />
            </div>
          </div>
        )}

        {/* Kept mounted while another pane shows: its draft, attachments and an answer on its way survive. */}
        {inline && (
          <div className="wk-ue-chat wk-uc-chat" data-testid="understand-chat" hidden={pane !== 'chat'} tabIndex={-1}>
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
              placeholder="e.g. Where is the login handled?" className="wk-ue-ask-input" data-testid="understand-ask-input" />
            <VoiceMicButton size="xs" testId="understand-ask-voice" />
            <button type="submit" className="wk-ue-btn wk-ue-btn--primary" data-testid="understand-ask-send">Ask</button>
          </form>
        </div>
      </div>

      {drawer && <div className="wk-uc-scrim" aria-hidden onClick={() => closeSide('toggle')} />}
      <aside id={sideId} ref={sideRef} className="wk-uc-side" data-testid="understand-side" aria-label="Recent answers and repository graphs"
        {...(drawer ? { role: 'dialog', 'aria-modal': true } : {})}>
        {drawer && (
          <button type="button" className="wk-uc-sideclose wk-pagechat-titlebtn" data-testid="understand-side-close" aria-label="Close recent answers and graphs" title="Close" onClick={() => closeSide('toggle')}>
            <X size={18} aria-hidden />
          </button>
        )}
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

        <RepoGraphLinks repos={repos} failed={reposFailed} scope={graphScope} runs={runs} now={now} navigate={navigate} sectionRef={graphsRef}
          onOpen={(repo, view) => { if (drawer) closeSide(null); setGraphOf({ repo, view }); }}
          after={(
            // DES-KNOWLEDGE-DATA-001 §10.3: the third view beside the code and requirements graphs, across every store.
            <button type="button" className="wk-uc-morebtn wk-uc-knowbtn" data-testid="understand-knowledge-toggle" aria-pressed={pane === 'knowledge'} onClick={() => showPane(pane === 'knowledge' ? 'chat' : 'knowledge')}>
              <Database size={16} aria-hidden /><span>Knowledge map: data, code and shapes</span>
            </button>
          )} />

        <section className="wk-uc-sec" aria-labelledby={moreId}>
          <h2 id={moreId} className="wk-uc-label">More</h2>
          <ul className="wk-uc-more">
            <li>
              <button type="button" className="wk-uc-morebtn" data-testid="understand-compare-toggle" aria-pressed={pane === 'compare'} onClick={() => showPane(pane === 'compare' ? 'chat' : 'compare')}>
                <Columns3 size={16} aria-hidden /><span>Compare side by side</span>
              </button>
            </li>
            <li>
              <button type="button" className="wk-uc-morebtn" data-testid="understand-coverage-toggle" aria-pressed={pane === 'coverage'} onClick={() => showPane(pane === 'coverage' ? 'chat' : 'coverage')}>
                <ListChecks size={16} aria-hidden /><span>Coverage</span>
              </button>
            </li>

          </ul>
        </section>
      </aside>
      {graphOf !== null && (
        <RepoGraphModal key={`${graphOf.repo.id}:${graphOf.view}`} repo={graphOf.repo} initialView={graphOf.view}
          // Opened from the drawer (now closed): focus goes back to its button, the control still on screen.
          onClose={() => { setGraphOf(null); if (narrow) setTimeout(() => toggleRef.current?.focus(), 0); }} />
      )}
    </div>
  );
}

/** The sidebar's quick links: each repository in scope (all of them when none is chosen), its code graph and its
 *  requirements graph, each with its state as a dot (board/repoKnowledge.ts). */
function RepoGraphLinks({ repos, failed, scope, runs, now, navigate, sectionRef, onOpen, after }: {
  repos: RepoEntry[] | null; failed: boolean; scope: readonly string[]; runs: readonly SessionView[]; now: number; navigate: Navigate;
  sectionRef: React.MutableRefObject<HTMLElement | null>;
  onOpen: (repo: RepoEntry, view: 'code' | 'domain') => void;
  /** Drawn under the repositories' links (the Knowledge map's button). */
  after?: React.ReactNode;
}): React.ReactElement {
  const titleId = useId();
  const shown = useMemo(() => graphLinkRepos(repos ?? [], scope), [repos, scope]);
  const inScope = useMemo(() => (scope.length === 0 ? repos ?? [] : (repos ?? []).filter((r) => scope.includes(r.id))), [repos, scope]);
  const knowledge = useRepoKnowledgeFor(shown.map((r) => r.id));
  // The marks' sentences can carry the engine's words (a code-graph finding names a path): `~/…` in the default layer.
  const display = useDisplayText();
  const go = (path: string) => (e: React.MouseEvent): void => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); navigate(path);
  };
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
            const label = (m: typeof code): string => `${r.name}: ${display(m.title).replace(/\.$/, '')}. Open it`;
            return (
              <li key={r.id} className="wk-uc-graph" data-testid="understand-graph-repo" data-repo-id={r.id}>
                <a href={page} className="wk-uc-graph-name" onClick={go(page)}>{r.name}</a>
                <span className="wk-uc-graph-links">
                  <button type="button" className="wk-uc-graphbtn" data-testid="understand-graph-open" data-tone={code.tone} title={display(code.title)} aria-label={label(code)} onClick={() => onOpen(r, 'code')}>
                    <span className="wk-know-dot" aria-hidden /><Network size={14} aria-hidden />Code graph
                    <span className="wk-uc-graphval" data-testid="understand-graph-value">{code.value}</span>
                    {flagOf(code) !== null && <span className="wk-know-flag" data-testid="understand-graph-flag">{flagOf(code)}</span>}
                  </button>
                  <button type="button" className="wk-uc-graphbtn" data-testid="understand-graph-req" data-tone={req.tone} title={display(req.title)} aria-label={label(req)} onClick={() => onOpen(r, 'domain')}>
                    <span className="wk-know-dot" aria-hidden /><Share2 size={14} aria-hidden />Requirements graph
                    <span className="wk-uc-graphval" data-testid="understand-graph-value">{req.value}</span>
                    {flagOf(req) !== null && <span className="wk-know-flag" data-testid="understand-graph-flag">{flagOf(req)}</span>}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {inScope.length > shown.length && (
        <a href="/repos" className="wk-ue-link wk-uc-all" data-testid="understand-graph-all" onClick={go('/repos')}>All {inScope.length} repositories</a>
      )}
      {after}
    </section>
  );
}

/** The word that says what a mark's colour says (never the colour alone): its own flag, or "old" for an index older
 *  than a week (amber; Repositories says the age on the row's own line). */
function flagOf(m: KnowMark): string | null {
  if (m.flag !== undefined) return m.flag;
  return m.id === 'code' && m.tone === 'warn' ? 'old' : null;
}

/** A chat's chosen repositories from its scope chips; null when it has none recorded or none chosen. */
function repoIdsOf(chips: readonly ScopeChip[] | undefined): string[] | null {
  const ids = (chips ?? []).filter((c) => c.kind === 'repo' && c.on).map((c) => c.ref ?? c.key.replace(/^repo:/, ''));
  return ids.length > 0 ? ids : null;
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
