import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { SessionView as RunView } from '../../api/types.js';
import { needsByRun } from '../../board/deskModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import {
  CLOSED_LINE, conversationOf, parseSessionId, runChatIdOf, sessionState, sessionTitle, sinceYouLeft,
  type Conversation, type SessionState,
} from '../../board/sessionModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { readSessionVisit, useSessionDrafts, writeSessionVisit } from '../../store/sessionDrafts.js';
import { humanTitle } from '../runIdentity.js';
import { ChainLine, useRunChain } from './ChainLine.js';
import { SinceYouLeft } from './SinceYouLeft.js';

/**
 * A SESSION (`/s/:id`, DES-STUDIO-REBUILD-001 §5.4, slice S6a): the goal sentence, the thread (the
 * chat's turns and the runs launched from it, in time order), each run's chain line, and the
 * session's composer.
 *
 *  - The runs are `GET /runs` filtered by `chat_id` (C1). Without `capabilities.runChatId` the only
 *    sessions are single runs (`run:<id>`), so a chat id finds none and says so.
 *  - A chat the daemon reclaimed renders its runs under one honest line (§5.3), never an empty
 *    thread that looks like nothing happened.
 *  - R4: the draft and the thread's scroll survive switching sessions and coming back.
 *  - R2: opened after 4 h away, the since-you-left card overlays the top of the thread; it
 *    collapses to one line and never pushes the thread down.
 *  - The composer's send hands the message to the Ask dock (as the Desk's does) until S7 brings
 *    the session's own launch path.
 */

interface ChatDetail {
  scope?: unknown;
  messages?: Array<{ at?: number; kind: string; text?: string; cliKey?: string; ok?: boolean }>;
}

type ThreadEntry =
  | { kind: 'turn'; key: string; at: number; who: 'you' | string; text: string; ok: boolean }
  | { kind: 'run'; key: string; at: number; view: RunView };

const STATE_WORD: Record<SessionState, string> = {
  waiting: 'Waiting on you', working: 'Being worked on', blocked: 'Stopped', done: 'Finished', quiet: 'Quiet',
};

function launchedMs(v: RunView): number {
  const c = (v.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0;
}

export function SessionPage({ sessionId, runs, runsLoaded, needRows, navigate, onAsk }: {
  sessionId: string;
  runs: RunView[];
  runsLoaded: boolean;
  needRows: NeedRow[];
  navigate: Navigate;
  onAsk: (text: string) => void;
}): React.ReactElement {
  const ref = useMemo(() => parseSessionId(sessionId), [sessionId]);
  const runChatId = useCapabilities((s) => s.runChatId);
  const mine = useMemo(() => {
    const list = ref.kind === 'run'
      ? runs.filter((v) => v.session.id === ref.runId)
      : runChatId ? runs.filter((v) => runChatIdOf(v) === ref.chatId) : [];
    return [...list].sort((a, b) => launchedMs(a) - launchedMs(b));
  }, [ref, runs, runChatId]);

  // The chat's transcript (and whether the daemon still holds it). Crew answers an unknown or
  // reclaimed chat with 200 `scope: null, messages: []`, so only that answer means "closed"; a
  // failed read says it failed (with a retry) and claims nothing about the conversation.
  const [chat, setChat] = useState<
    { id: string; detail: ChatDetail } | { id: string; error: string } | null
  >(null);
  const [chatTry, setChatTry] = useState(0);
  useEffect(() => {
    if (ref.kind !== 'chat') return;
    let cancelled = false;
    api.getChat(ref.chatId)
      .then((d) => { if (!cancelled) setChat({ id: ref.chatId, detail: d as unknown as ChatDetail }); })
      .catch((e: unknown) => {
        if (!cancelled) setChat({ id: ref.chatId, error: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [ref, chatTry]);
  const mineChat = ref.kind === 'chat' && chat?.id === ref.chatId ? chat : null;
  const chatDetail = mineChat !== null && 'detail' in mineChat ? mineChat.detail : null;
  const chatError = mineChat !== null && 'error' in mineChat ? mineChat.error : null;
  const chatLoaded = ref.kind !== 'chat' || mineChat !== null;
  const conversation: Conversation | 'pending' | 'unreadable' = ref.kind === 'run' ? 'none'
    : chatError !== null ? 'unreadable'
      : chatDetail === null ? 'pending' : conversationOf(ref, chatDetail);
  const messages = useMemo(() => chatDetail?.messages ?? [], [chatDetail]);
  const title = sessionTitle(messages, mine);

  const badges = useMemo(() => needsByRun(needRows), [needRows]);
  const badge = mine.reduce((n, v) => n + (badges[v.session.id] ?? 0), 0);
  const state: SessionState = mine.some((v) => v.session.status === 'awaiting_human') ? 'waiting'
    : mine.some((v) => sessionState(v.session.status) === 'working') ? 'working'
      : mine.length > 0 ? sessionState(mine[mine.length - 1]!.session.status) : 'quiet';

  // R2: the last visit, read once per session before this visit is stamped.
  // (A memo runs during render, before the effect below stamps this visit; switching away stamps
  // it again, so coming back minutes later shows no card.)
  const lastSeen = useMemo(() => readSessionVisit(sessionId), [sessionId]);
  useEffect(() => {
    writeSessionVisit(sessionId, Date.now());
    return () => writeSessionVisit(sessionId, Date.now());
  }, [sessionId]);
  const since = useMemo(() => sinceYouLeft(lastSeen, Date.now(), mine, badges), [lastSeen, mine, badges]);

  const entries = useMemo<ThreadEntry[]>(() => {
    const out: ThreadEntry[] = [];
    messages.forEach((m, i) => {
      if ((m.kind !== 'user' && m.kind !== 'seat') || typeof m.text !== 'string') return;
      out.push({
        kind: 'turn', key: `m${i}`, at: typeof m.at === 'number' ? m.at : 0,
        who: m.kind === 'user' ? 'you' : (m.cliKey ?? 'helper'), text: m.text, ok: m.ok !== false,
      });
    });
    for (const v of mine) out.push({ kind: 'run', key: `r:${v.session.id}`, at: launchedMs(v), view: v });
    return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map((x) => x.e);
  }, [messages, mine]);

  // R4: scroll and draft per session.
  const scroller = useRef<HTMLDivElement | null>(null);
  const setScroll = useSessionDrafts((s) => s.setScroll);
  const draft = useSessionDrafts((s) => s.drafts[sessionId] ?? '');
  const setDraft = useSessionDrafts((s) => s.setDraft);
  const ready = runsLoaded && chatLoaded;
  useLayoutEffect(() => {
    if (!ready) return;
    const el = scroller.current;
    const top = useSessionDrafts.getState().scroll[sessionId];
    // A first visit starts at the top: the scroller is reused across sessions (Copilot).
    if (el !== null) el.scrollTop = top ?? 0;
  }, [sessionId, ready]);

  const send = (): void => {
    const body = draft.trim();
    if (body === '') return;
    onAsk(body);
    setDraft(sessionId, '');
  };
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const missing = ready && mine.length === 0 && (conversation === 'closed' || conversation === 'none');

  return (
    <div data-testid="session" data-session-id={sessionId} data-conversation={conversation} data-state={state} className="wk-session">
      <header className="wk-session-head">
        <span aria-hidden className={`wk-desk-dot wk-desk-dot--${state}`} />
        <div className="wk-session-head-body">
          <h1 data-testid="session-title" className="wk-session-title">{title}</h1>
          <p data-testid="session-status" className="wk-session-status">
            {STATE_WORD[state]}
            {mine.length > 1 && ` · ${mine.length} runs`}
            {badge > 0 && <> · <mark className="wk-desk-mark">{badge === 1 ? '1 needs you' : `${badge} need you`}</mark></>}
          </p>
        </div>
      </header>

      <div className="wk-session-body">
        {since !== null && ready && <SinceYouLeft key={sessionId} card={since} runs={mine} />}
        <div
          ref={scroller}
          data-testid="session-thread"
          className="wk-session-thread"
          onScroll={(e) => setScroll(sessionId, e.currentTarget.scrollTop)}
        >
          {conversation === 'closed' && mine.length > 0 && (
            <p data-testid="session-closed-line" className="wk-session-grey">{CLOSED_LINE}</p>
          )}
          {chatError !== null && (
            <p data-testid="session-chat-error" className="wk-session-grey">
              Could not read this conversation from the daemon ({chatError}).{' '}
              <button type="button" data-testid="session-chat-retry" onClick={() => { setChat(null); setChatTry((n) => n + 1); }} className="wk-since-toggle">Try again</button>
            </p>
          )}
          {missing && (
            <p data-testid="session-missing" className="wk-session-grey">
              {ref.kind === 'chat' && !runChatId
                ? 'This daemon does not link runs to their chat, so this session has no runs to show.'
                : 'Nothing in this session is on this daemon.'}
            </p>
          )}
          {!ready && <p className="wk-session-grey">Loading…</p>}
          {entries.map((e) => (e.kind === 'turn'
            ? (
              <div key={e.key} data-testid="session-turn" data-who={e.who === 'you' ? 'you' : 'helper'} className={`wk-session-turn wk-session-turn--${e.who === 'you' ? 'you' : 'helper'}`}>
                <p className="wk-session-who">{e.who === 'you' ? 'You' : e.who}</p>
                <p className={`wk-session-text${e.ok ? '' : ' wk-session-grey'}`}>{e.text}</p>
              </div>
            )
            : <RunBlock key={e.key} view={e.view} badge={badges[e.view.session.id] ?? 0} go={go} />))}
        </div>
      </div>

      <form className="wk-desk-composer wk-session-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          data-testid="session-composer-input"
          data-type-target="page"
          aria-label="Ask or tell studio what to do next"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(sessionId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          placeholder="Ask about this, or tell studio what to do next"
          className="wk-desk-input"
        />
        <button type="submit" data-testid="session-composer-send" aria-label="Send" disabled={draft.trim() === ''} className="wk-desk-send">↑</button>
      </form>
    </div>
  );
}

function RunBlock({ view, badge, go }: {
  view: RunView;
  badge: number;
  go: (path: string) => (e: React.MouseEvent) => void;
}): React.ReactElement {
  const { chain, teamError, retry } = useRunChain(view);
  const id = view.session.id;
  const state = sessionState(view.session.status);
  const page = `/runs/${encodeURIComponent(id)}`;
  return (
    <section data-testid="session-run" data-run-id={id} data-state={state} className="wk-session-run">
      <p className="wk-session-run-head">
        <span aria-hidden className={`wk-desk-dot wk-desk-dot--${state}`} />
        <span className="wk-session-run-title">{humanTitle(view.session.problem || id)}</span>
        <span className="wk-session-run-state">{STATE_WORD[state]}{badge > 0 ? ' · needs you' : ''}</span>
      </p>
      <ChainLine chain={chain} runId={id} teamError={teamError} onRetry={retry} />
      <a href={page} onClick={go(page)} data-testid="session-run-open" className="wk-session-link">Open the run page →</a>
    </section>
  );
}
