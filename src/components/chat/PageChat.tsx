import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MessageSquarePlus, Sparkles, X } from 'lucide-react';
import type { AskAnswer } from '../../api/ask.js';
import { api } from '../../api/client.js';
import { fileProposal } from '../../api/proposals.js';
import type { SessionView } from '../../api/types.js';
import { recordLine } from '../../board/askModel.js';
import type { ScopeChip } from '../../board/chatScopes.js';
import { ITEM_TEXT_CAP, nextAsk, PAGE_CHAT_SPECS, pageChatSessionKey, PAGE_TEXT_CAP, rememberAsk, rememberLines, textLines, type NextMove, type PageChatKind, type PageFocus } from '../../board/pageChat.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { usePageChat, usePageChatHost, usePageChatOpen, type PageChatProvider } from '../../store/pageChat.js';
import { readAskSession } from '../../store/askSession.js';
import { AskCard, AskRecord } from '../ask/AskCard.js';
import { AskDock, type PageChatBinding } from '../AskDock.js';
import type { Ask } from '../../api/ask.js';

/**
 * THE PAGE CHAT (DES-LEARN §6.2; mockup learn-and-panels state f): the system chat's engine drawn inside a page,
 * with the page's data as its context. A right column from 1200 px, a bottom sheet below. Each answer is cited
 * text followed by a guided "What next?" (DES-GUIDED-CHAT), never buttons in the bubble. The floating system
 * chat stays as it is, for talking about something else while work runs.
 *
 * A page joins in two steps: it registers what it shows ({@link usePageChatHostPage}), and its own controls call
 * {@link askPage} (the header Ask, an item's "Ask about this"). App draws the column for the page on screen.
 */

/** Register the page on screen as the chat's host while it is mounted. `provider` may change every render. */
export function usePageChatHostPage(kind: PageChatKind, provider: PageChatProvider): void {
  const ref = useRef(provider);
  ref.current = provider;
  const idRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const id = usePageChatHost.getState().register(kind, ref);
    idRef.current = id;
    return () => usePageChatHost.getState().unregister(id);
  }, [kind]);
  useEffect(() => {
    if (idRef.current !== null) usePageChatHost.getState().setKnows(idRef.current, provider.knows);
  }, [provider.knows]);
}

/** Open `kind`'s chat: about `focus` when given, with `text` in the box (sent only when `send`). */
export function askPage(kind: PageChatKind, opts: { focus?: PageFocus | null; text?: string; send?: boolean; fresh?: boolean } = {}): void {
  usePageChat.getState().ask(kind, opts);
}

/** An item's data as a focus: its visible words, cut to fit. */
export function focusOfElement(el: HTMLElement, key: string, label: string, extra: readonly string[] = []): PageFocus {
  return { key, label, lines: [...extra, ...textLines(el.innerText ?? el.textContent ?? '', ITEM_TEXT_CAP)] };
}

/** A whole page's visible words as pack lines (the header Ask: "a chat over all the page's data"). */
export function pageTextLines(el: HTMLElement | null): string[] {
  return el === null ? [] : textLines(el.innerText ?? el.textContent ?? '', PAGE_TEXT_CAP);
}

/**
 * "Click any item to ask about it" (Report, Nerve Center): a delegated handler for a page's root. An element with
 * `data-askable="<label>"` (and an optional `data-ask-key`) asks about itself when clicked or when Enter is pressed
 * on it; a click on a link, button or field inside it does what that control does.
 */
export function useAskableItems(kind: PageChatKind, root: React.RefObject<HTMLElement | null>, extra: () => string[] = () => []): {
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
} {
  const extraRef = useRef(extra);
  extraRef.current = extra;
  // The item the chat is about is marked on the page (`data-asked`) while the question waits in the box.
  const focusKey = usePageChat((s) => s.focus[kind]?.key ?? null);
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    el.querySelectorAll('[data-asked]').forEach((n) => n.removeAttribute('data-asked'));
    if (focusKey === null) return;
    el.querySelectorAll<HTMLElement>('[data-askable]').forEach((n) => {
      if ((n.getAttribute('data-ask-key') ?? n.getAttribute('data-askable')) === focusKey) n.setAttribute('data-asked', 'true');
    });
  }, [focusKey, root]);
  const fire = useCallback((target: EventTarget | null): boolean => {
    const t = target as HTMLElement | null;
    if (t === null || typeof t.closest !== 'function') return false;
    const item = t.closest<HTMLElement>('[data-askable]');
    if (item === null) return false;
    const inner = t.closest('a, button, input, select, textarea, summary, label, [role="button"], [role="tab"]');
    if (inner !== null && item.contains(inner) && inner !== item) return false;
    const label = item.getAttribute('data-askable') ?? 'this';
    const key = item.getAttribute('data-ask-key') ?? label;
    const focus = focusOfElement(item, key, label, extraRef.current());
    askPage(kind, { focus, text: questionAbout(label) });
    return true;
  }, [kind]);
  return {
    onClick: (e) => { if (fire(e.target)) e.preventDefault(); },
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target as HTMLElement;
      if (t.getAttribute?.('data-askable') === null) return;
      if (fire(t)) e.preventDefault();
    },
  };
}

/** The question put in the box for an item (the person edits or sends it). */
export function questionAbout(label: string): string {
  return `What’s behind ${label.replace(/\s*·.*$/u, '')}?`;
}

/** The page's header Ask (an icon button): opens the chat over all of the page's data. */
export function PageAskButton({ kind, label = 'Ask', testId = 'page-ask', small = false }: { kind: PageChatKind; label?: string; testId?: string; small?: boolean }): React.ReactElement {
  const open = usePageChatOpen(kind);
  return (
    <button type="button" className={`wk-ue-btn wk-ue-btn--secondary${small ? ' wk-ue-btn--sm' : ''} wk-pagechat-askbtn`} data-testid={testId} aria-pressed={open}
      onClick={() => (open ? usePageChat.getState().setOpen(kind, false) : askPage(kind, { focus: null }))}
      title={open ? 'Close this page’s chat' : 'Ask about everything on this page'}>
      <Sparkles size={15} aria-hidden /> {label}
    </button>
  );
}

/** What the tail of the thread holds: nothing, the guided ask, or the line it collapsed into. */
type Tail = { kind: 'none' } | { kind: 'ask'; ask: Ask } | { kind: 'record'; line: string };

export function PageChat({ kind, runs, navigate, variant, chips, onClose, provider: own }: {
  kind: PageChatKind;
  runs: SessionView[];
  navigate: Navigate;
  /** `column`: beside the page (a sheet on a phone); `inline`: the page's own column (Understand). */
  variant: 'column' | 'inline';
  /** The chat's scope (Understand: the repositories asked about). */
  chips?: ScopeChip[];
  onClose?: () => void;
  /** A page that draws its chat itself passes its provider (Understand); otherwise the registered host's. */
  provider?: PageChatProvider;
}): React.ReactElement {
  const hosted = usePageChatHost((s) => (s.host?.kind === kind ? s.host.provider : null));
  const knows = usePageChatHost((s) => (s.host?.kind === kind ? s.knows : ''));
  const providerOf = useCallback((): PageChatProvider | null => own ?? hosted?.current ?? null, [own, hosted]);
  const gen = usePageChat((s) => s.gen[kind] ?? 0);
  const seed = usePageChat((s) => s.seed[kind] ?? null);
  const focus = usePageChat((s) => s.focus[kind] ?? null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const chatList = useCapabilities((s) => s.chatList);
  const capsLoaded = useCapabilities((s) => s.loaded);

  const [tail, setTail] = useState<Tail>({ kind: 'none' });
  const answers = useRef(0);
  const lastFocus = useRef<PageFocus | null>(null);
  const lastQuestion = useRef('');
  const chatIdRef = useRef<string | null>(null);
  /** Memory's keep step: the "Remember:" lines of the last answer. */
  const pendingRemember = useRef<string[]>([]);
  // A New chat starts with an empty tail; a resumed one whose last word is an answer ends in "What next?".
  useEffect(() => {
    setTail({ kind: 'none' });
    answers.current = 0;
    const stored = readAskSession(pageChatSessionKey(kind));
    if (stored === null || !capsLoaded || !useCapabilities.getState().chatList) return undefined;
    let live = true;
    chatIdRef.current = stored.chatId;
    api.getChatMessages(stored.chatId).then((r) => {
      const last = r.messages[r.messages.length - 1] as { kind?: string; ok?: boolean } | undefined;
      // An ended chat is shown read-only: its next question starts a new chat, so nothing "keeps this thread".
      if (!live || r.chat.status === 'closed' || last === undefined || last.kind === 'user' || last.ok === false) return;
      answers.current += 1;
      setTail({ kind: 'ask', ask: nextAsk({ kind, focus: null }, answers.current) });
    }, () => undefined);
    return () => { live = false; };
  }, [gen, kind, capsLoaded]);

  const onStatus = useCallback((status: 'ready' | 'thinking' | 'answered', chatId: string | null) => {
    chatIdRef.current = chatId;
    if (status === 'thinking') { setTail({ kind: 'none' }); return; }
    if (status !== 'answered') return;
    answers.current += 1;
    const n = answers.current;
    const p = providerOf();
    const base = { kind, focus: lastFocus.current, ...(p?.gaps !== undefined ? { gaps: p.gaps(lastFocus.current) } : {}) };
    // Memory: the answer's "Remember:" lines (read back from the chat's kept history) offer the keep step.
    if (kind === 'memory' && chatId !== null && chatList) {
      void api.getChatMessages(chatId).then((r) => {
        // The newest helper words (a transcript also holds citation records, which carry no text).
        const last = [...r.messages].reverse().find((m) => (m as { kind?: string }).kind !== 'user' && typeof (m as { text?: unknown }).text === 'string') as { text?: string } | undefined;
        const remember = rememberLines(typeof last?.text === 'string' ? last.text : '');
        pendingRemember.current = remember;
        if (answers.current === n) setTail({ kind: 'ask', ask: nextAsk({ ...base, remember }, n) });
      }, () => { if (answers.current === n) setTail({ kind: 'ask', ask: nextAsk(base, n) }); });
      return;
    }
    setTail({ kind: 'ask', ask: nextAsk(base, n) });
  }, [kind, providerOf, chatList]);

  const move = useCallback((m: NextMove, ask: Ask, answer: AskAnswer) => {
    setTail({ kind: 'record', line: recordLine(ask, answer) });
    const p = providerOf();
    if (p?.onMove?.(m, lastFocus.current) === true) return;
    switch (m) {
      case 'follow-up': composerRef.current?.focus(); break;
      case 'jobs': navigate('/jobs'); break;
      case 'agents': navigate('/agents'); break;
      case 'new-job': openLaunchWizard({ intent: lastQuestion.current, projectId: null }); break;
      case 'remember':
        if (pendingRemember.current.length > 0) setTail({ kind: 'ask', ask: rememberAsk(pendingRemember.current, answers.current) });
        break;
      default: break;
    }
  }, [navigate, providerOf]);

  const [keeping, setKeeping] = useState(false);
  const keep = useCallback((ask: Ask, answer: AskAnswer) => {
    const picked = (ask.options ?? []).filter((o) => (answer.options ?? []).includes(o.id)).map((o) => o.token);
    setKeeping(true);
    void Promise.allSettled(picked.map((content) => fileProposal({ content }))).then((res) => {
      setKeeping(false);
      const ok = res.filter((r) => r.status === 'fulfilled').length;
      const failed = res.length - ok;
      setTail({ kind: 'record', line: `${recordLine(ask, answer)} · filed ${ok} for your approval in Suggested${failed > 0 ? `; ${failed} could not be filed` : ''}` });
    });
  }, []);

  const threadTail = tail.kind === 'none' ? null : tail.kind === 'record' ? (
    <AskRecord line={tail.line} testId="page-chat-record" className="wk-pagechat-record" />
  ) : (
    <div className="wk-pagechat-next" data-testid="page-chat-next">
      <AskCard ask={tail.ask} header busy={keeping}
        onAnswer={(a) => {
          if (tail.ask.kind === 'pick') { keep(tail.ask, a); return; }
          const opt = (tail.ask.options ?? []).find((o) => o.id === a.option);
          if (opt !== undefined) move(opt.token as NextMove, tail.ask, a);
        }} />
    </div>
  );

  const binding: PageChatBinding = {
    kind,
    knows: knows !== '' ? knows : own?.knows ?? '',
    data: () => providerOf()?.data() ?? [],
    focus,
    onSent: (text, chatId) => {
      providerOf()?.onSent?.(text, chatId);
      lastQuestion.current = text;
      lastFocus.current = usePageChat.getState().focus[kind] ?? null;
      usePageChat.getState().clearFocus(kind);
    },
    ...(chips !== undefined ? { chips } : {}),
    seed,
    onSeedTaken: (n) => usePageChat.getState().tookSeed(kind, n),
    threadTail,
    onStatus,
    composerRef,
    headerEnd: (
      <span className="wk-pagechat-headacts">
        <button type="button" className="wk-chatwin-btn" data-testid="page-chat-new" aria-label="New chat" title="New chat (this one stays in past chats)"
          onClick={() => usePageChat.getState().fresh(kind)}>
          <MessageSquarePlus size={15} aria-hidden />
        </button>
        {onClose !== undefined && (
          <button type="button" className="wk-chatwin-btn" data-testid="page-chat-close" aria-label="Close this page’s chat" title="Close (the conversation is kept)" onClick={onClose}>
            <X size={15} aria-hidden />
          </button>
        )}
      </span>
    ),
    focusChip: focus !== null ? (
      <span className="wk-pagechat-focus" data-testid="page-chat-focus" title={focus.lines.slice(0, 6).join('\n')}>
        <span className="wk-pagechat-focus-l">About: {focus.label}</span>
        <button type="button" aria-label={`Don’t ask about ${focus.label}`} data-testid="page-chat-focus-clear" onClick={() => usePageChat.getState().clearFocus(kind)}>
          <X size={12} aria-hidden />
        </button>
      </span>
    ) : null,
  };

  return (
    <section className="wk-pagechat" data-testid="page-chat" data-kind={kind} data-variant={variant} aria-label={`Chat about ${PAGE_CHAT_SPECS[kind].title}`}>
      {variant === 'column' && <div className="wk-pagechat-grab" aria-hidden />}
      {/* The engine decides from the crew's capabilities at mount (kept history, workflows): wait for them. */}
      {capsLoaded ? (
        <AskDock key={`${kind}:${gen}`} runs={runs} pathname={typeof window === 'undefined' ? '/' : window.location.pathname}
          navigate={navigate} onClose={onClose ?? (() => undefined)} page={binding} />
      ) : (
        <p className="wk-pagechat-wait" data-testid="page-chat-wait" role="status">Opening the chat…</p>
      )}
    </section>
  );
}

/** App's column: the chat of the page on screen, when it is open. */
export function PageChatColumn({ runs, navigate }: { runs: SessionView[]; navigate: Navigate }): React.ReactElement | null {
  const kind = usePageChatHost((s) => s.host?.kind ?? null);
  const open = usePageChat((s) => (kind === null ? false : s.open[kind] ?? null));
  const stored = useMemo(() => (kind === null ? false : usePageChat.getState().open[kind] ?? readStored(kind)), [kind]);
  const isOpen = kind !== null && kind !== 'understand' && (open ?? stored);
  if (!isOpen || kind === null) return null;
  return <PageChat kind={kind} runs={runs} navigate={navigate} variant="column" onClose={() => usePageChat.getState().setOpen(kind, false)} />;
}

function readStored(kind: PageChatKind): boolean {
  try { return localStorage.getItem(`wicked.pagechat.${kind}.open`) === 'true'; } catch { return false; }
}
