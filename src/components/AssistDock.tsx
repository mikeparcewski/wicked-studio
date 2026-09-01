import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { executingOrd } from '../api/run-state.js';
import type { CoreEvent, SessionView } from '../api/types.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { pinAwaiting } from '../store/awaitingPins.js';
import { useRunEventStore } from '../store/events.js';
import { ApprovalDock } from './ApprovalDock.js';
import { readFileText } from './fileText.js';
import { NarratorFeed, phaseName } from './NarratorFeed.js';
import { NowBar } from './NowBar.js';
import {
  deriveArtifacts,
  lastNarration,
  TONE_COLOR,
  type NarrationTone,
  type NarratorContext,
} from './narrator.js';

/**
 * The ASSIST DOCK (DES-ASSIST-DOCK) — a reusable right-panel CHAT surface, v1 of an app-wide
 * assistant ("It should be treated as a chat panel though, so it can be used throughout").
 * The dock owns pixels and thread mechanics; a SURFACE binds meaning through the generic
 * `{context, verbs, importable}` contract — the dock itself imports NO wire module.
 *
 *  - a typed message fires `verbs.send` (on Steering: the governed steering-author run) and
 *    the returned run NARRATES INLINE through the SHIPPED narrator modules (NowBar +
 *    NarratorFeed — DES-RUN-NARRATOR §9, reused verbatim, never forked);
 *  - anything awaiting the human renders in the pinned {@link ApprovalDock} between the
 *    thread and the composer (`chatId` entry point, §11.5) — the propose gate is answered
 *    here, without leaving the page;
 *  - attachments (drag/drop or pick): files `importable(name)` calls rule-shaped offer the
 *    fork — "Import directly" (fires `verbs.importDirect` now, results echoed into the thread
 *    as narration notes) vs "Analyze with chat" (rides the next send as `documents[]`); plain
 *    files attach for analysis;
 *  - collapse is a per-surface persisted preference (`wicked.assist.<surface>.open`).
 */

export interface AssistContext {
  /** Stable key: the localStorage namespace and the reuse identity ('steering', 'testing', …). */
  surface: string;
  title: string;
  /** What the verbs are typed against — e.g. 'Steering · Security'. */
  contextLabel: string;
  placeholder: string;
  /** One-liner under the header — what a message DOES here. */
  hint?: string;
  /** Quick-prompt chips for the EMPTY thread: clicking one PREFILLS the composer
   *  (never sends — nothing launches without the user's own send). */
  prompts?: readonly AssistPrompt[];
}

export interface AssistPrompt {
  label: string;
  /** What the chip puts into the composer. */
  text: string;
}

export interface AssistDocument {
  name: string;
  content: string;
}

export interface AssistNote {
  tone: NarrationTone;
  text: string;
}

/** What a send launched: a governed RUN (narrated by the run block) or a governed CHAT
 *  session (streamed by the chat block — the GroupChat seat machinery's wire, §11-adjacent). */
export type AssistLaunch = { runId: string } | { chatId: string };

export interface AssistVerbs {
  /** A typed message: launch a governed run OR chat session, return its id —
   *  the dock narrates/streams it inline. */
  send: (text: string, documents: AssistDocument[]) => Promise<AssistLaunch>;
  /** The direct-import fork for rule-shaped attachments; returns notes to echo. Absent ⇒ no fork. */
  importDirect?: (doc: AssistDocument) => Promise<AssistNote[]>;
  /** Fired when a pinned gate/elicitation resolves — the surface reloads its data. */
  onRunResolved?: () => void;
}

type ThreadItem =
  | { kind: 'user'; text: string; files: string[] }
  | { kind: 'note'; tone: NarrationTone; text: string }
  | { kind: 'run'; runId: string }
  | { kind: 'chat'; chatId: string };

interface PendingAttachment {
  name: string;
  content: string;
  /** 'ask' = importable, fork not yet chosen; 'analyze' = rides the next send. */
  mode: 'ask' | 'analyze';
}

const openKey = (surface: string): string => `wicked.assist.${surface}.open`;

/** The persisted collapse preference — per surface, default OPEN. */
export function useAssistDockOpen(surface: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(openKey(surface)) !== 'false';
    } catch {
      return true;
    }
  });
  const set = useCallback(
    (next: boolean): void => {
      setOpen(next);
      try {
        localStorage.setItem(openKey(surface), String(next));
      } catch {
        /* storage unavailable — the session still works, just forgets */
      }
    },
    [surface],
  );
  return [open, set];
}

// ── The inline run block — the shipped narrator modules over one launched run ────────────────

const EMPTY_EVENTS: CoreEvent[] = [];

/** Lifecycle frames that move authoritative snapshot detail → re-fetch (useRunModel's rule). */
const LIFECYCLE: ReadonlySet<string> = new Set([
  'sessionStarted', 'unitPlanned', 'unitDistributed', 'unitExecuting', 'gateDecided',
  'unitDone', 'unitDenied', 'awaitingHuman', 'resumed', 'runCancelled', 'sessionFailed',
  'sessionCompleted',
]);

function DockRun({ runId }: { runId: string }): React.ReactElement {
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY_EVENTS;
  const lifecycleTick = useRunEventStore((s) => {
    const evs = s.byRun[runId];
    if (evs === undefined) return 0;
    let n = 0;
    for (const e of evs) if (LIFECYCLE.has(e.type)) n += 1;
    return n;
  });
  const [view, setView] = useState<SessionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getRun(runId)
      .then(({ run }) => {
        if (!cancelled) setView(run);
      })
      .catch(() => {
        /* snapshot unavailable (daemon restart, test fixture) — the honest launched line stays */
      });
    return () => {
      cancelled = true;
    };
  }, [runId, lifecycleTick]);

  const session = view?.session;
  const units = useMemo(() => view?.units ?? [], [view]);
  const ordered = useMemo(() => [...units].sort((a, b) => a.ord - b.ord), [units]);
  const executingUnitOrd = useMemo(
    () => (session === undefined ? null : executingOrd(session, units)),
    [session, units],
  );
  const byOrd = useMemo(() => new Map(ordered.map((u) => [u.ord, u])), [ordered]);
  const phaseOf = useCallback(
    (ord: number | null | undefined): string => {
      if (typeof ord !== 'number') return 'this phase';
      const unit = byOrd.get(ord);
      return unit === undefined ? `unit ${ord}` : phaseName(runId, unit);
    },
    [byOrd, runId],
  );
  const ctx: NarratorContext = useMemo(
    () => ({ phaseOf, intent: session?.problem ?? null }),
    [phaseOf, session?.problem],
  );
  const lastLine = useMemo(() => lastNarration(events, ctx), [events, ctx]);
  const artifacts = useMemo(() => deriveArtifacts(events, view, ctx), [events, view, ctx]);

  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const jumpToLatest = useCallback(() => {
    const el = feedScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  return (
    <div
      data-testid="assist-run"
      data-run-id={runId}
      className="flex flex-col overflow-hidden rounded-lg"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
    >
      {view === null || session === undefined ? (
        <p data-testid="assist-run-waiting" className="px-3 py-2 font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Run <span className="font-semibold">{runId.slice(0, 8)}</span> launched — it narrates here
          the moment its events arrive, and its gates pin below.
        </p>
      ) : (
        <>
          <NowBar
            status={session.status}
            orderedUnits={ordered}
            executingUnitOrd={executingUnitOrd}
            phaseOf={phaseOf}
            lastLine={lastLine}
            artifacts={artifacts}
            onJumpToLatest={jumpToLatest}
          />
          {/* The feed scrolls INSIDE this fixed-height block — the dock's thread stays one column. */}
          <div className="flex h-72 flex-col overflow-hidden">
            <NarratorFeed
              view={view}
              orderedUnits={ordered}
              executingUnitOrd={executingUnitOrd}
              phaseOf={phaseOf}
              lens="feed"
              scrollRef={feedScrollRef}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── The inline chat block — a governed chat session streaming into the thread ────────────────

type DockSeatState = 'ready' | 'failed';

interface DockChatMsg {
  cliKey: string;
  text: string;
  pending: boolean;
  ok: boolean;
}

/**
 * One launched CHAT session (the GroupChat seat machinery's wire — `POST /chats` +
 * `POST /chats/:id/messages`, replies streaming back as `chatDelta`/`chatReply` frames).
 * The block folds ONLY frames whose `chat` matches, per-seat FIFO (the GroupChat §7.9-3
 * correlation: a seat's frames belong to its oldest unfinished turn; the terminal
 * `chatReply` text is authoritative and replaces the accumulated deltas). Seats come from
 * the one `GET /chats/:id` snapshot — frames that streamed before this block mounted are
 * healed by the authoritative reply, never re-invented.
 */
function DockChat({ chatId }: { chatId: string }): React.ReactElement {
  const [seats, setSeats] = useState<Record<string, DockSeatState>>({});
  const [msgs, setMsgs] = useState<DockChatMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // §11.5: gates/elicitations the daemon keys by THIS chat id must survive the
  // run-list reconcile (a chat id is never in GET /runs) — pin for the block's lifetime.
  useEffect(() => pinAwaiting(chatId), [chatId]);

  // The seats snapshot — one GET; an empty answer means the daemon no longer holds it.
  useEffect(() => {
    let cancelled = false;
    void api
      .getChat(chatId)
      .then(({ seats: warm }) => {
        if (cancelled) return;
        setSeats((prev) => ({
          ...Object.fromEntries(warm.map((k) => [k, 'ready' as DockSeatState])),
          ...prev,
        }));
      })
      .catch(() => {
        /* snapshot unavailable — the frames below still speak for themselves */
      });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  /** A seat's streaming chunk belongs to its OLDEST pending bubble (FIFO — the wire
   *  carries no turn field); a chunk with no pending bubble opens its own. */
  const append = (cliKey: string, text: string): void => {
    setMsgs((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i += 1) {
        const m = next[i];
        if (m !== undefined && m.cliKey === cliKey && m.pending) {
          next[i] = { ...m, text: m.text + text };
          return next;
        }
      }
      next.push({ cliKey, text, pending: true, ok: false });
      return next;
    });
  };

  /** The terminal reply is authoritative — it REPLACES the oldest pending bubble's deltas. */
  const finalize = (cliKey: string, text: string, ok: boolean): void => {
    setMsgs((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i += 1) {
        const m = next[i];
        if (m !== undefined && m.cliKey === cliKey && m.pending) {
          next[i] = { ...m, text, pending: false, ok };
          return next;
        }
      }
      next.push({ cliKey, text, pending: false, ok });
      return next;
    });
  };

  useEventStream((ev: CoreEvent) => {
    const frame = ev as { type: string; chat?: string; cliKey?: string; text?: string; ok?: boolean; reason?: string };
    if (frame.chat !== chatId) return;
    switch (frame.type) {
      case 'chatSessionReady':
        if (frame.cliKey !== undefined) setSeats((s) => ({ ...s, [frame.cliKey!]: 'ready' }));
        break;
      case 'chatSessionFailed':
        if (frame.cliKey !== undefined) setSeats((s) => ({ ...s, [frame.cliKey!]: 'failed' }));
        break;
      case 'chatDelta':
        if (frame.cliKey !== undefined && frame.text !== undefined && frame.text !== '') append(frame.cliKey, frame.text);
        break;
      case 'chatReply':
        if (frame.cliKey !== undefined) finalize(frame.cliKey, frame.text ?? '', frame.ok ?? false);
        break;
      default:
        break;
    }
  });

  // Tail-pinned inside the block — replies stream long; the dock thread stays one column.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  return (
    <div
      data-testid="assist-chat"
      data-chat-id={chatId}
      className="flex flex-col gap-1.5 overflow-hidden rounded-lg px-3 py-2"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--ink-dim)' }}>
          chat session
        </span>
        {Object.entries(seats).map(([k, st]) => (
          <span
            key={k}
            data-testid="assist-chat-seat"
            data-agent={k}
            data-state={st}
            title={st === 'failed' ? `${k} could not hold a session` : `${k} — connected`}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)', opacity: st === 'failed' ? 0.5 : 1 }}
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: st === 'failed' ? 'var(--status-fail)' : 'var(--status-run)' }}
            />
            {k}
          </span>
        ))}
      </div>
      <div ref={scrollRef} className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {msgs.length === 0 ? (
          <p data-testid="assist-chat-waiting" className="font-mono text-[11px]" style={{ color: 'var(--ink-dim)' }}>
            Sent — the agents answer here as their replies stream in.
          </p>
        ) : (
          msgs.map((m, i) => (
            <div key={i} data-testid="assist-chat-msg" data-agent={m.cliKey} data-pending={m.pending}>
              <span className="font-mono text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>
                {m.cliKey}
              </span>
              <p
                className="whitespace-pre-wrap text-[11px] leading-relaxed"
                style={{ color: m.pending || m.ok ? 'var(--ink-body)' : 'var(--status-fail)' }}
              >
                {m.text}
                {m.pending && <span aria-hidden className="animate-pulse"> …</span>}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── The dock ──────────────────────────────────────────────────────────────────────────────────

export function AssistDock({ context, verbs, importable, open, onOpenChange, onError }: {
  context: AssistContext;
  verbs: AssistVerbs;
  /** Which attachments offer the Import-directly fork. Absent ⇒ everything is analysis-only. */
  importable?: ((name: string) => boolean) | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional error tap (the surface may also surface send failures its own way). */
  onError?: ((message: string) => void) | undefined;
}): React.ReactElement {
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The ACTIVE launch: the newest run/chat item — its gates/elicitations pin below the
  // thread (the daemon keys chat-session gates by the chat id, §11.5).
  const activeId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item !== undefined && item.kind === 'run') return item.runId;
      if (item !== undefined && item.kind === 'chat') return item.chatId;
    }
    return null;
  }, [items]);

  // Pinned to the tail as items land (the live-follow posture, DES-RUN-NARRATOR).
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  // ChatInput's auto-resize idiom (5-line cap).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 20 * 5)}px`;
  }, [text]);

  const push = (item: ThreadItem): void => setItems((cur) => [...cur, item]);
  const note = (tone: NarrationTone, textLine: string): void => push({ kind: 'note', tone, text: textLine });

  const onFiles = (files: File[]): void => {
    for (const f of files) {
      void readFileText(f)
        .then((content) => {
          const forkable = importable !== undefined && verbs.importDirect !== undefined && importable(f.name);
          setAttachments((cur) => [...cur, { name: f.name, content, mode: forkable ? 'ask' : 'analyze' }]);
          if (!forkable) note('info', `Attached ${f.name} for analysis — it rides your next message.`);
        })
        .catch(() => note('fail', `Could not read ${f.name}.`));
    }
  };

  const importNow = (att: PendingAttachment): void => {
    const importDirect = verbs.importDirect;
    if (importDirect === undefined) return;
    setAttachments((cur) => cur.filter((a) => a !== att));
    note('work', `Importing ${att.name} directly…`);
    void importDirect({ name: att.name, content: att.content })
      .then((notes) => {
        for (const n of notes) note(n.tone, n.text);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        note('fail', msg);
        onError?.(msg);
      });
  };

  const send = async (): Promise<void> => {
    const body = text.trim();
    if (body === '' || sending) return;
    setSending(true);
    // An attachment still sitting at the fork when the operator hits send rides as analysis —
    // they attached it and asked; silently dropping it would run a different request.
    const documents = attachments.map((a) => ({ name: a.name, content: a.content }));
    try {
      const launched = await verbs.send(body, documents);
      push({ kind: 'user', text: body, files: documents.map((d) => d.name) });
      if ('chatId' in launched) {
        // One chat block per SESSION: a later send into the same warm session streams
        // into the block that already exists — never a duplicate block per message.
        setItems((cur) =>
          cur.some((it) => it.kind === 'chat' && it.chatId === launched.chatId)
            ? cur
            : [...cur, { kind: 'chat', chatId: launched.chatId }],
        );
      } else {
        push({ kind: 'run', runId: launched.runId });
      }
      setText('');
      setAttachments([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push({ kind: 'user', text: body, files: documents.map((d) => d.name) });
      note('fail', msg);
      onError?.(msg);
    } finally {
      setSending(false);
    }
  };

  const onGateResolved = (): void => {
    note('human', 'Answered — the run continues; this page reloads when its work lands.');
    verbs.onRunResolved?.();
  };

  // ── Collapsed: a slim re-open rail ──────────────────────────────────────────────────────────
  if (!open) {
    return (
      <div
        data-testid="assist-dock-rail"
        className="flex shrink-0 flex-col items-center gap-2 py-3"
        style={{ width: '2.25rem', borderLeft: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
      >
        <button
          type="button"
          data-testid="assist-dock-toggle"
          aria-label={`Open ${context.title}`}
          aria-expanded={false}
          title={`Open ${context.title}`}
          onClick={() => onOpenChange(true)}
          className="rounded px-1 py-1 text-sm focus:outline-none focus-visible:ring-1"
          style={{ color: 'var(--accent)' }}
        >
          «
        </button>
        <span
          className="select-none font-mono text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--ink-dim)', writingMode: 'vertical-rl' }}
        >
          {context.title}
        </span>
      </div>
    );
  }

  return (
    <aside
      data-testid="assist-dock"
      data-surface={context.surface}
      aria-label={context.title}
      className="flex h-full w-96 shrink-0 flex-col overflow-hidden"
      style={{
        borderLeft: `1px solid ${dragOver ? 'var(--accent)' : 'var(--surface-raised)'}`,
        background: 'var(--surface-rail)',
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--surface-raised)' }}>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>{context.title}</span>
        <span data-testid="assist-context" className="truncate font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          {context.contextLabel}
        </span>
        <button
          type="button"
          data-testid="assist-dock-toggle"
          aria-label={`Collapse ${context.title}`}
          aria-expanded
          title="Collapse (remembered)"
          onClick={() => onOpenChange(false)}
          className="ml-auto rounded px-1 text-sm focus:outline-none focus-visible:ring-1"
          style={{ color: 'var(--ink-dim)' }}
        >
          »
        </button>
      </div>

      {/* Thread — the ONE scrolling region (run blocks scroll inside themselves). */}
      <div ref={threadRef} data-testid="assist-thread" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        {items.length === 0 && (
          <>
            <p data-testid="assist-empty" className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
              {context.hint ?? 'Type below, or drop documents here.'}
            </p>
            {context.prompts !== undefined && context.prompts.length > 0 && (
              <div data-testid="assist-prompts" className="flex flex-wrap gap-1.5">
                {context.prompts.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    data-testid="assist-prompt"
                    data-prompt={p.label}
                    title="Prefills the composer — nothing sends until you do"
                    onClick={() => {
                      setText(p.text);
                      textareaRef.current?.focus();
                    }}
                    className="rounded-full px-2.5 py-1 text-left text-[10px] focus:outline-none focus-visible:ring-1"
                    style={{ border: '1px solid var(--surface-overlay)', color: 'var(--accent)', background: 'transparent' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {items.map((item, i) => {
          if (item.kind === 'user') {
            return (
              <div key={i} data-testid="assist-user-msg" className="self-end max-w-[85%] rounded-2xl px-3 py-2" style={{ background: 'var(--accent-subtle)', color: 'var(--ink-high)' }}>
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed">{item.text}</p>
                {item.files.length > 0 && (
                  <p className="mt-1 font-mono text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                    📎 {item.files.join(' · ')}
                  </p>
                )}
              </div>
            );
          }
          if (item.kind === 'note') {
            return (
              <p key={i} data-testid="assist-note" data-tone={item.tone} className="font-mono text-[11px] leading-relaxed" style={{ color: TONE_COLOR[item.tone] }}>
                · {item.text}
              </p>
            );
          }
          if (item.kind === 'chat') {
            return <DockChat key={item.chatId} chatId={item.chatId} />;
          }
          return <DockRun key={item.runId} runId={item.runId} />;
        })}
      </div>

      {/* The pinned approval dock — anything the ACTIVE run asks of the human answers HERE,
          a structural sibling of the thread scroll (it can never scroll away). Capped at 60%
          of the panel with its OWN scroll: a long propose prompt must never push the composer
          below the fold (caught on the gated evidence pass). */}
      {activeId !== null && (
        <div className="max-h-[60%] shrink-0 overflow-y-auto" style={{ borderTop: '1px solid var(--surface-raised)' }}>
          <ApprovalDock chatId={activeId} onResolved={onGateResolved} />
        </div>
      )}

      {/* Pending attachments + the import-vs-analyze fork */}
      {attachments.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1 px-3 pt-2">
          {attachments.map((a, i) => (
            <div key={`${a.name}-${i}`} data-testid="assist-attachment-chip" data-mode={a.mode} className="flex flex-wrap items-center gap-1.5 rounded px-2 py-1" style={{ background: 'var(--surface-raised)' }}>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px]" style={{ color: 'var(--ink-muted)' }}>{a.name}</span>
              {a.mode === 'ask' ? (
                <>
                  <button
                    type="button"
                    data-testid="assist-import-now"
                    title="POST this file through the import wire now — results echo into the thread"
                    onClick={() => importNow(a)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold focus:outline-none focus-visible:ring-1"
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    Import directly
                  </button>
                  <button
                    type="button"
                    data-testid="assist-analyze"
                    title="Attach as source material for the next message's governed run"
                    onClick={() => setAttachments((cur) => cur.map((x) => (x === a ? { ...x, mode: 'analyze' } : x)))}
                    className="rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus-visible:ring-1"
                    style={{ color: 'var(--accent)', border: '1px solid var(--surface-overlay)' }}
                  >
                    Analyze with chat
                  </button>
                </>
              ) : (
                <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>analysis — rides the next message</span>
              )}
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((cur) => cur.filter((x) => x !== a))}
                className="text-[11px] leading-none"
                style={{ color: 'var(--ink-dim)' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer — the ChatInput idioms: + attach, auto-resize textarea, Cmd/Ctrl+Enter. */}
      <div className="flex shrink-0 items-end gap-2 px-3 py-3">
        <input
          ref={fileInput}
          data-testid="assist-attach"
          type="file"
          multiple
          aria-label="Attach files"
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            onFiles(picked);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          aria-label="Attach files"
          title="Attach files (or drop them anywhere on the panel)"
          onClick={() => fileInput.current?.click()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base font-light focus:outline-none focus-visible:ring-1"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-dim)' }}
        >
          +
        </button>
        <div className="flex min-w-0 flex-1 items-end gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}>
          <textarea
            ref={textareaRef}
            data-testid="assist-input"
            aria-label={context.placeholder}
            className="min-w-0 flex-1 resize-none border-0 bg-transparent text-[12px] leading-5 outline-none"
            style={{ minHeight: '20px', color: 'var(--ink-high)' }}
            placeholder={context.placeholder}
            value={text}
            rows={1}
            disabled={sending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            data-testid="assist-send"
            aria-label="Send"
            disabled={text.trim() === '' || sending}
            onClick={() => void send()}
            className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-opacity disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </aside>
  );
}
