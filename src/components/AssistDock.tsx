import { ExternalLink, Paperclip } from 'lucide-react';
import { VoiceMicButton } from './voice/VoiceMicButton.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { apiStatus } from '../api/errors.js';
import { executingOrd } from '../api/run-state.js';
import type { CoreEvent, SessionView } from '../api/types.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { pinAwaiting } from '../store/awaitingPins.js';
import { useRunEventStore } from '../store/events.js';
import { AnswerInThread, useGateCleared } from './AnswerInThread.js';
import { retainOnFinalize } from './ChatThread.js';
import { readFileText } from './fileText.js';
import { splitAskContext } from '../board/askPack.js';
import { useCapabilities } from '../store/capabilities.js';
import { Markdown } from './Markdown.js';
import { NarratorFeed, phaseName } from './NarratorFeed.js';
import { NowBar } from './NowBar.js';
import { LiveActivity } from './session/LiveActivity.js';
import { workingOrdOf } from '../board/liveTurn.js';
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
 *  - anything awaiting the human is answered in its session thread (S16a-4g): the dock shows
 *    one {@link AnswerInThread} line — the question and "Answer in its thread ›" — and, when
 *    the gate clears, notes it and fires `verbs.onRunResolved`;
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
  /** Surface-owned controls for the EMPTY thread, beside the hint (Ask's scope select —
   *  studio#323 R4: decided before the first send, so shown only while nothing was sent). */
  controls?: React.ReactNode;
  /** Surface-owned controls shown just above the input whatever the thread holds (Ask's helpers
   *  row, studio#840: a refused first send leaves notes in the thread, and the row its refusal
   *  points at must still be there). The surface decides when it applies. */
  composerControls?: React.ReactNode;
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
 *  session (streamed by the chat block — the retired chat page's seat machinery's wire, §11-adjacent). */
export type AssistLaunch = { runId: string } | { chatId: string };

export interface AssistVerbs {
  /** A typed message: launch a governed run OR chat session, return its id —
   *  the dock narrates/streams it inline. */
  send: (text: string, documents: AssistDocument[], files?: File[]) => Promise<AssistLaunch>;
  /** The direct-import fork for rule-shaped attachments; returns notes to echo. Absent ⇒ no fork. */
  importDirect?: (doc: AssistDocument) => Promise<AssistNote[]>;
  /** Fired when the active run's gate clears from the gate store — the surface reloads its data. */
  onRunResolved?: () => void;
}

type ThreadItem =
  | { kind: 'user'; text: string; files: string[]; chip?: string }
  | { kind: 'note'; tone: NarrationTone; text: string }
  | { kind: 'run'; runId: string }
  | { kind: 'chat'; chatId: string; resumed?: boolean };

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
          {/* What its working step is doing now, its meter, and the in-flight check (operator 2026-10-30). */}
          {executingUnitOrd !== null && (
            <div className="wk-assist-live">
              <LiveActivity runId={runId} ord={executingUnitOrd} kind="chat" seat={byOrd.get(executingUnitOrd)?.assigned_cli ?? null} label="this job" />
            </div>
          )}
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
  /** The footer, fixed when the answer landed (later chip changes never rewrite an earlier answer's). */
  foot?: string | null;
  /** An operator turn's attached files, by name (a replayed transcript's `attachments`). */
  files?: string[];
  /** A page chat's operator turn: the item it asked about. */
  chip?: string;
}

/** A page chat's follow-up turn, drawn inside its chat block so it sits above its own answer. */
export interface InlineTurn { id: number; text: string; files: string[]; chip?: string }

/**
 * One launched CHAT session (the retired chat page's seat machinery's wire — `POST /chats` +
 * `POST /chats/:id/messages`, replies streaming back as `chatDelta`/`chatReply` frames).
 * The block folds ONLY frames whose `chat` matches, per-seat FIFO (the retired chat page's §7.9-3
 * correlation: a seat's frames belong to its oldest unfinished turn; the terminal
 * `chatReply` text is authoritative and replaces the accumulated deltas). Seats come from
 * the one `GET /chats/:id` snapshot — frames that streamed before this block mounted are
 * healed by the authoritative reply, never re-invented.
 */
/** A resumed block's replay: the daemon's persisted transcript as dock bubbles. The
 *  user's own turns render as `you`, trimmed of the context pack Ask appends. */
function replayDockTranscript(records: readonly unknown[]): DockChatMsg[] {
  const out: DockChatMsg[] = [];
  for (const r of records) {
    const rec = r as { kind?: string; cliKey?: string; text?: string; ok?: boolean };
    if (typeof rec.text !== 'string') continue;
    if (rec.kind === 'user') {
      const files = (r as { attachments?: Array<{ name?: unknown }> }).attachments;
      const names = Array.isArray(files) ? files.map((f) => (typeof f?.name === 'string' ? f.name : '')).filter((n) => n !== '') : [];
      out.push({ cliKey: 'you', text: splitAskContext(rec.text).typed, pending: false, ok: true, ...(names.length > 0 ? { files: names } : {}) });
    } else if (typeof rec.cliKey === 'string') {
      out.push({ cliKey: rec.cliKey, text: rec.text, pending: false, ok: rec.ok ?? true });
    }
  }
  return out;
}

/** What a RESUMED block's one `GET /chats/:id` probe proved (studio#328). */
/** `ended`: the chat was closed but its history is kept (`capabilities.chatList`) — shown, read-only. */
type ResumeProbe = { kind: 'gone' } | { kind: 'ended' } | { kind: 'error'; message: string };

/** A chat's kept history (the system chat's past chats): its records, and whether it has ended. */
export type ChatHistoryLoader = (chatId: string) => Promise<{ records: readonly unknown[]; closed: boolean }>;

function DockChat({ chatId, resumed = false, onResumeProbe, onStatus, answerFooter, loadHistory, turns }: {
  chatId: string;
  /** A page chat's follow-ups (AssistDock `inlineTurns`): each joins the block in order, so a question sits
   *  above its answer. */
  turns?: readonly InlineTurn[] | undefined;
  resumed?: boolean;
  /** Resumed blocks only: the probe found the session reclaimed, or could not tell. */
  onResumeProbe?: ((outcome: ResumeProbe) => void) | undefined;
  /** A reply started streaming (`thinking`) or landed (`answered`) — the system chat's tray says so. */
  onStatus?: ((status: 'ready' | 'thinking' | 'answered') => void) | undefined;
  /** The footer under a landed answer ("Answered by Claude Code · saw 3 sources"); absent = none. */
  answerFooter?: ((cliKey: string, replayed?: boolean) => string | null) | undefined;
  /** A resumed block replays the chat's KEPT history from here (open or ended) instead of the live
   *  transcript; an ended chat is shown read-only. */
  loadHistory?: ChatHistoryLoader | undefined;
}): React.ReactElement {
  const onResumeProbeRef = useRef(onResumeProbe);
  onResumeProbeRef.current = onResumeProbe;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const footRef = useRef(answerFooter);
  footRef.current = answerFooter;
  const [seats, setSeats] = useState<Record<string, DockSeatState>>({});
  const [msgs, setMsgs] = useState<DockChatMsg[]>([]);
  /** The chat's ask run (its `path`, once the first message launched it): its working step shows live below. */
  const [pathRun, setPathRun] = useState<string | null>(null);
  const [pathPa, setPathPa] = useState<string | null>(null);
  const pathEvents = useRunEventStore((s) => (pathRun !== null ? s.byRun[pathRun] : undefined));
  const liveOrd = useMemo(() => workingOrdOf(pathEvents), [pathEvents]);
  const waiting = msgs.length === 0 || msgs.some((m) => m.pending) || msgs[msgs.length - 1]?.cliKey === 'you';
  // Until the path is known, read the chat again while it may be answering (a fresh chat has no path at first).
  useEffect(() => {
    if (pathRun !== null || !useCapabilities.getState().askPath) return;
    let live = true;
    const read = (): void => {
      api.getChat(chatId)
        .then((d) => {
          const path = (d as { path?: { runId?: unknown; pa?: unknown } }).path;
          if (live && typeof path?.runId === 'string') {
            setPathRun(path.runId);
            if (typeof path.pa === 'string') setPathPa(path.pa);
          }
        })
        .catch(() => undefined);
    };
    read();
    const t = waiting ? setInterval(read, 5000) : null;
    return () => { live = false; if (t !== null) clearInterval(t); };
  }, [chatId, pathRun, waiting]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // §11.5: gates/elicitations the daemon keys by THIS chat id must survive the
  // run-list reconcile (a chat id is never in GET /runs) — pin for the block's lifetime.
  useEffect(() => pinAwaiting(chatId), [chatId]);

  // The seats snapshot — one GET; an empty answer means the daemon no longer holds it. A resumed block
  // on a daemon that keeps history reads that first: an ended chat is shown from it, read-only.
  const loadHistoryRef = useRef(loadHistory);
  loadHistoryRef.current = loadHistory;
  useEffect(() => {
    let cancelled = false;
    const footed = (records: readonly unknown[]): DockChatMsg[] =>
      replayDockTranscript(records).map((m) => (m.cliKey !== 'you' && m.ok ? { ...m, foot: footRef.current?.(m.cliKey, true) ?? null } : m));
    // No history for the id (404) falls back to the live probe; any other failure is "could not tell".
    const history = resumed && loadHistoryRef.current !== undefined
      ? loadHistoryRef.current(chatId).catch((e: unknown) => (apiStatus(e) === 404 ? null : Promise.reject(e)))
      : Promise.resolve(null);
    let replayedFromHistory = false;
    void history
      .then((h) => {
        if (cancelled || h === null) return 'live' as const;
        replayedFromHistory = true;
        setMsgs((prev) => (prev.length > 0 ? prev : footed(h.records)));
        if (h.closed) {
          onResumeProbeRef.current?.({ kind: 'ended' });
          return 'ended' as const;
        }
        return 'live' as const;
      })
      .then((state) => (state === 'ended' || cancelled ? null : api.getChat(chatId)))
      .then((detail) => {
        if (cancelled || detail === null) return;
        const warm = detail.seats;
        // the retired chat page's rejoin rule: ONLY a 200 with no seats means reclaimed — a resumed
        // block must not keep presenting a session the daemon no longer holds.
        if (resumed && warm.length === 0) {
          // A chat replayed from its kept history that no longer holds seats has ENDED: its transcript
          // stays on screen, read-only — never wiped as if it were gone.
          onResumeProbeRef.current?.({ kind: replayedFromHistory ? 'ended' : 'gone' });
          return;
        }
        setSeats((prev) => ({
          ...Object.fromEntries(warm.map((k) => [k, 'ready' as DockSeatState])),
          ...prev,
        }));
        // A RESUMED block (studio#323 R3) replays what the session already said —
        // only then: a fresh block streams its own frames, and replaying a reply
        // those frames will also deliver would double it.
        const messages = (detail as { messages?: unknown }).messages;
        if (resumed && !replayedFromHistory && Array.isArray(messages)) {
          const replayed = footed(messages);
          setMsgs((prev) => (prev.length > 0 ? prev : replayed));
        }
      })
      .catch((e: unknown) => {
        // A fresh block: the frames speak for themselves. A RESUMED block: "do not
        // know" keeps the session, but says so rather than claiming it is live.
        if (!cancelled && resumed) {
          onResumeProbeRef.current?.({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, resumed]);

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

  /** The terminal reply finalizes the oldest pending bubble — through
   *  {@link retainOnFinalize}: the wire keeps no history, so a terminal text
   *  SHORTER than the accumulated deltas never clobbers what streamed (E4);
   *  the longer text stands, ties to the terminal reply (the healing path for
   *  a block that mounted mid-stream, intact). */
  const finalize = (cliKey: string, text: string, ok: boolean): void => {
    setMsgs((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i += 1) {
        const m = next[i];
        if (m !== undefined && m.cliKey === cliKey && m.pending) {
          // ASK-S1 (codex #9): on a path the relay's `chatReply` IS the canonical answer — the stored
          // output with the control lines stripped, so SHORTER than the deltas by design; it replaces
          // them. The retain rule stays for the pool-era fan-out (no capability).
          next[i] = { ...m, text: useCapabilities.getState().askPath ? text : retainOnFinalize(m.text, text), pending: false, ok, foot: ok ? footRef.current?.(cliKey) ?? null : null };
          return next;
        }
      }
      next.push({ cliKey, text, pending: false, ok, foot: ok ? footRef.current?.(cliKey) ?? null : null });
      return next;
    });
  };

  // A page chat's follow-up joins the block where it was asked: after what has streamed so far.
  const turnsSeen = useRef(0);
  useEffect(() => {
    if (turns === undefined || turns.length <= turnsSeen.current) return;
    const fresh = turns.slice(turnsSeen.current);
    turnsSeen.current = turns.length;
    setMsgs((prev) => [...prev, ...fresh.map((t) => ({ cliKey: 'you', text: t.text, pending: false, ok: true, ...(t.files.length > 0 ? { files: t.files } : {}), ...(t.chip !== undefined ? { chip: t.chip } : {}) }))]);
  }, [turns]);

  useEventStream((ev: CoreEvent) => {
    const frame = ev as { type: string; chat?: string; cliKey?: string; text?: string; ok?: boolean; reason?: string };
    if (frame.chat !== chatId) return;
    switch (frame.type) {
      case 'chatSessionReady':
        if (frame.cliKey !== undefined) setSeats((s) => ({ ...s, [frame.cliKey!]: 'ready' }));
        break;
      case 'chatSessionFailed':
        if (frame.cliKey !== undefined) setSeats((s) => ({ ...s, [frame.cliKey!]: 'failed' }));
        onStatusRef.current?.('ready');
        break;
      case 'chatDelta':
        if (frame.cliKey !== undefined && frame.text !== undefined && frame.text !== '') {
          append(frame.cliKey, frame.text);
          onStatusRef.current?.('thinking');
        }
        break;
      case 'chatReply':
        if (frame.cliKey !== undefined) {
          finalize(frame.cliKey, frame.text ?? '', frame.ok ?? false);
          // A failed turn is not an answer: the tray goes back to "ready", never "answer ready".
          onStatusRef.current?.(frame.ok === true ? 'answered' : 'ready');
        }
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
            // A helper's reply is a bubble on the left (operator 2026-10-16), the operator's own on the right.
            <div key={i} data-testid="assist-chat-msg" data-agent={m.cliKey} data-pending={m.pending} className={m.cliKey === 'you' ? 'wk-assist-you self-end max-w-[88%] rounded-2xl rounded-tr-md px-3 py-2' : 'self-start max-w-[92%] rounded-2xl rounded-tl-md px-3 py-2'} style={{ background: m.cliKey === 'you' ? 'var(--accent-subtle)' : 'var(--surface-raised)' }}>
              {m.chip !== undefined && <span className="wk-assist-chip" data-testid="assist-msg-chip">{m.chip}</span>}
              <span className="font-mono text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>
                {m.cliKey}
              </span>
              {!m.pending && !m.ok ? (
                // A failed turn's text is the daemon's error prose — it stays
                // verbatim in the fail ink, never dressed as markdown.
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: 'var(--status-fail)' }}>
                  {m.text}
                </p>
              ) : (
                // E3 (campaign): seat replies ARE markdown — rendered with the
                // SAME component the chat thread already uses (react-markdown +
                // GFM; raw HTML is never parsed, so nothing injects), not
                // dumped as ##-visible raw text.
                <div className="text-[11px] leading-relaxed">
                  <Markdown>{m.text}</Markdown>
                  {m.pending && <span aria-hidden className="animate-pulse"> …</span>}
                </div>
              )}
              {!m.pending && m.ok && m.cliKey !== 'you' && m.foot !== undefined && m.foot !== null && (
                <p data-testid="assist-answer-footer" className="wk-assist-answer-foot">{m.foot}</p>
              )}
              {m.files !== undefined && m.files.length > 0 && (
                <p data-testid="assist-chat-msg-files" className="mt-1 font-mono text-[10px]" style={{ color: 'var(--ink-muted)' }}>📎 {m.files.join(' · ')}</p>
              )}
            </div>
          ))
        )}
      </div>
      {/* Outside the reply box's own scroll, so the check never hides inside it. */}
      {pathRun !== null && liveOrd !== null && (
        <LiveActivity runId={pathRun} ord={liveOrd} kind="chat" seat={pathPa} label="this answer" />
      )}
    </div>
  );
}

// ── The dock ──────────────────────────────────────────────────────────────────────────────────

const RESUMED_NOTE = 'Resumed your earlier session — its agents are still on the line.';

export function AssistDock({ context, verbs, importable, open, onOpenChange, onError, resumeChatId = null, onExpandChat, onResumeGone, fill = false, typeTarget, initialText = '', sendOnOpen = false, headerProps, headerStart, headerExtra, headerEnd, compactHeader = false, onStatus, allowAttach = true, answerFooter, promptsSend = false, notice, fileMode = false, loadHistory, variant, threadTail, seed, onSeedTaken, sendChip, composerRef }: {
  context: AssistContext;
  verbs: AssistVerbs;
  /** Which attachments offer the Import-directly fork. Absent ⇒ everything is analysis-only. */
  importable?: ((name: string) => boolean) | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional error tap (the surface may also surface send failures its own way). */
  onError?: ((message: string) => void) | undefined;
  /** A chat session this dock RESUMES on mount (studio#323 R3) — its block renders
   *  immediately and replays the session's transcript. */
  resumeChatId?: string | null;
  /** The promote door (studio#323 R3): when wired, the header offers "Open in full
   *  chat" for the newest chat session the dock holds. */
  onExpandChat?: ((chatId: string) => void) | undefined;
  /** Fill the container (the floating Ask panel) instead of the fixed `w-96` column —
   *  a narrow container must never clip the composer. */
  fill?: boolean;
  /** The resumed session was reclaimed by the daemon (studio#328) — the surface forgets
   *  it, so the next send opens a fresh session. */
  onResumeGone?: ((chatId: string) => void) | undefined;
  /** Type-to-composer (§5.6 rule 4): which composer this input is for letters typed with
   *  focus elsewhere — `ask` (the app-wide dock) or `page` (the page's own assistant). */
  typeTarget?: 'ask' | 'page' | undefined;
  /** Letters typed before the dock mounted (the keystrokes that opened it). */
  initialText?: string;
  /** `initialText` was already sent by the operator from another composer (the Desk's): send it
   *  once on mount. Only ever set from an explicit send — typed letters never send. */
  sendOnOpen?: boolean;
  /** Spread onto the header (the system chat window's drag handle). */
  headerProps?: React.HTMLAttributes<HTMLDivElement> | undefined;
  /** Before the title (the system chat's past-chats toggle). */
  headerStart?: React.ReactNode;
  /** Before the header's Close (the system chat's CLI picker). */
  headerExtra?: React.ReactNode;
  /** Replaces the header's own Close (the system chat window's controls). */
  headerEnd?: React.ReactNode;
  /** A crowded header (the system chat's picker and window controls): "Open in full chat" is an icon. */
  compactHeader?: boolean;
  /** The conversation is thinking, or an answer landed (the system chat's tray). */
  onStatus?: ((status: 'ready' | 'thinking' | 'answered') => void) | undefined;
  /** Offer attachments (paperclip, drop). A surface whose send cannot carry files turns it off. */
  allowAttach?: boolean;
  /** The footer under each landed answer (`replayed`: an answer from a kept transcript). */
  answerFooter?: ((cliKey: string, replayed?: boolean) => string | null) | undefined;
  /** A suggested prompt SENDS when clicked (the system chat, DES-SYSTEM-CHAT §7); otherwise it prefills. */
  promptsSend?: boolean;
  /** One line under the composer (an older crew's "past chats and uploads need…"). */
  notice?: React.ReactNode;
  /** Attachments are FILES the send uploads as they are (the system chat on a crew with
   *  `chatAttachments`): images, text and pdfs by paperclip, drop or paste — never read as text here. */
  fileMode?: boolean;
  /** A resumed chat's kept history (the system chat's past chats). */
  loadHistory?: ChatHistoryLoader | undefined;
  /** `page`: drawn inside a page (DES-LEARN §6.2): the context label is its own line under the header, the
   *  chat block is not boxed or capped, follow-ups sit above their answers, and the thread follows the tail. */
  variant?: 'page' | undefined;
  /** Drawn at the end of the thread (a page chat's "What next?" after an answer). */
  threadTail?: React.ReactNode;
  /** Words to put in the box now (a page's "Ask about this"), sent when `send` (the person pressed Ask). */
  seed?: { nonce: number; text: string; send: boolean } | null | undefined;
  /** The seed was taken (put in the box, or sent). */
  onSeedTaken?: ((nonce: number) => void) | undefined;
  /** The item the next message is about: shown on its bubble. */
  sendChip?: string | null | undefined;
  /** The composer's text box (a page chat's "Ask a follow-up" focuses it). */
  composerRef?: React.MutableRefObject<HTMLTextAreaElement | null> | undefined;
}): React.ReactElement {
  const page = variant === 'page';
  const [items, setItems] = useState<ThreadItem[]>(() =>
    resumeChatId !== null
      ? [
          { kind: 'note', tone: 'info', text: RESUMED_NOTE },
          { kind: 'chat', chatId: resumeChatId, resumed: true },
        ]
      : [],
  );
  const [text, setText] = useState(initialText);
  /** A page chat's follow-ups, by chat: drawn inside that chat's block. */
  const [inlineTurns, setInlineTurns] = useState<Record<string, InlineTurn[]>>({});
  const turnSeq = useRef(0);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  /** File mode: the files the next send uploads (removable chips above the input). Each has its own id:
   *  two different files may share a name and a size. */
  const [files, setFiles] = useState<Array<{ id: number; file: File }>>([]);
  const fileSeq = useRef(0);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const setTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (composerRef !== undefined) composerRef.current = el;
  }, [composerRef]);

  // Opened by typing (§5.6 rule 4): the typed letters are already in the box — keep typing there.
  const typedOpen = useRef(initialText !== '');
  useEffect(() => {
    if (!typedOpen.current) return;
    typedOpen.current = false;
    const el = textareaRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // The ACTIVE launch: the newest run/chat item — its gates/elicitations pin below the
  // thread (the daemon keys chat-session gates by the chat id, §11.5).
  const active = useMemo<{ kind: 'run'; runId: string } | { kind: 'chat'; chatId: string } | null>(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item !== undefined && item.kind === 'run') return { kind: 'run', runId: item.runId };
      if (item !== undefined && item.kind === 'chat') return { kind: 'chat', chatId: item.chatId };
    }
    return null;
  }, [items]);
  // S16a-4g: the active gate is answered in its thread; when the gate store clears it (open, then
  // gone) the dock notes it and the surface reloads its data — the card's onResolved, from the store.
  useGateCleared(active === null ? null : active.kind === 'run' ? active.runId : active.chatId, () => {
    note('human', 'Answered — the run continues; this page reloads when its work lands.');
    verbs.onRunResolved?.();
  });

  /** The newest CHAT session in the thread — what the promote door opens. */
  const latestChatId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
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

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const push = (item: ThreadItem): void => setItems((cur) => [...cur, item]);
  const note = (tone: NarrationTone, textLine: string): void => push({ kind: 'note', tone, text: textLine });

  const onFiles = (picked: File[]): void => {
    if (fileMode) {
      // Pasted screenshots all arrive as "image.png": give each its own name so the chips tell them apart.
      const named = picked.map((f, i) => (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)
        ? new File([f], `pasted-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}${picked.length > 1 ? `-${i + 1}` : ''}.${f.name.split('.').pop()}`, { type: f.type })
        : f));
      setFiles((cur) => {
        // Two pastes in one second must not read the same: a clash gets the next free "-2", "-3"…
        const taken = new Set(cur.map((c) => c.file.name));
        const fresh = named.map((file) => {
          let name = file.name;
          for (let n = 2; taken.has(name); n += 1) name = file.name.replace(/(\.[^.]+)?$/, `-${n}$1`);
          taken.add(name);
          return { id: (fileSeq.current += 1), file: name === file.name ? file : new File([file], name, { type: file.type }) };
        });
        return [...cur, ...fresh];
      });
      return;
    }
    for (const f of picked) {
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

  // Re-entry guard: `sending` is state, so two calls in one tick would both read it as false.
  const inFlight = useRef(false);
  const send = async (override?: string): Promise<void> => {
    const body = (override ?? text).trim();
    if (body === '' || sending || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    onStatus?.('thinking');
    // An attachment still sitting at the fork when the operator hits send rides as analysis —
    // they attached it and asked; silently dropping it would run a different request.
    const documents = attachments.map((a) => ({ name: a.name, content: a.content }));
    // Snapshot what this send carries: a file attached while it is in flight waits for the next one.
    const sentEntries = files;
    const sentFiles = sentEntries.map((f) => f.file);
    const fileNames = [...documents.map((d) => d.name), ...sentFiles.map((f) => f.name)];
    try {
      // Files ride only in file mode (the system chat); every other surface keeps its two-argument send.
      const chip = sendChip ?? undefined;
      const launched = await (fileMode ? verbs.send(body, documents, sentFiles) : verbs.send(body, documents));
      const into = 'chatId' in launched ? launched.chatId : null;
      // A page chat's follow-up into a chat already on screen joins that chat's block (above its answer).
      if (page && into !== null && itemsRef.current.some((it) => it.kind === 'chat' && it.chatId === into)) {
        setInlineTurns((cur) => ({ ...cur, [into]: [...(cur[into] ?? []), { id: (turnSeq.current += 1), text: body, files: fileNames, ...(chip !== undefined ? { chip } : {}) }] }));
      } else {
        push({ kind: 'user', text: body, files: fileNames, ...(chip !== undefined ? { chip } : {}) });
      }
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
      setFiles((cur) => cur.filter((f) => !sentEntries.includes(f)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push({ kind: 'user', text: body, files: fileNames });
      note('fail', msg);
      onStatus?.('ready');
      onError?.(msg);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  // The Desk composer's handoff (S4): the operator pressed Send there — send it here, once.
  const sentOnOpen = useRef(false);
  useEffect(() => {
    if (!sendOnOpen || sentOnOpen.current) return;
    sentOnOpen.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount, with the handed-over text
  }, []);

  // A page's seed (its "Ask about this", or a question pressed there): into the box, or sent when pressed.
  const onSeedTakenRef = useRef(onSeedTaken);
  onSeedTakenRef.current = onSeedTaken;
  useEffect(() => {
    if (seed === null || seed === undefined) return;
    onSeedTakenRef.current?.(seed.nonce);
    setText(seed.text);
    if (seed.send && seed.text.trim() !== '') {
      void send(seed.text);
      return;
    }
    const el = textareaRef.current;
    if (el !== null) {
      el.focus();
      el.setSelectionRange(seed.text.length, seed.text.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per seed
  }, [seed?.nonce]);

  // A page chat follows its tail while an answer streams in, unless the person scrolled up to read.
  useEffect(() => {
    const el = threadRef.current;
    if (!page || el === null || typeof MutationObserver === 'undefined') return undefined;
    let pinned = true;
    const onScroll = (): void => { pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 48; };
    const mo = new MutationObserver(() => { if (pinned) el.scrollTop = el.scrollHeight; });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('scroll', onScroll);
    return () => { mo.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, [page]);

  /** studio#328: a resumed block's probe answered. Reclaimed → drop the resumed block
   *  (and its "still on the line" note), say so, and let the surface forget it; could
   *  not tell → keep it and show the transient error. */
  const onResumeProbe = (chatId: string, outcome: ResumeProbe): void => {
    if (outcome.kind === 'ended') {
      // Closed with its history kept: the block stays (read-only), and the next question starts anew.
      setItems((cur) => [
        ...cur.filter((it) => !(it.kind === 'note' && it.text === RESUMED_NOTE)),
        { kind: 'note', tone: 'info', text: 'This chat has ended — shown from its history. Your next question starts a new chat.' },
      ]);
      onResumeGone?.(chatId);
      return;
    }
    if (outcome.kind === 'gone') {
      setItems((cur) => [
        ...cur.filter(
          (it) => !(it.kind === 'chat' && it.chatId === chatId) && !(it.kind === 'note' && it.text === RESUMED_NOTE),
        ),
        { kind: 'note', tone: 'info', text: 'Your earlier session has ended — your next question opens a new one.' },
      ]);
      onResumeGone?.(chatId);
    } else {
      note('fail', `Could not check your earlier session (${outcome.message}) — keeping it; your next question retries.`);
    }
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
      data-variant={variant}
      className={`flex h-full ${fill ? 'w-full min-w-0' : 'w-96 shrink-0'} flex-col overflow-hidden${page ? ' wk-assist--page' : ''}`}
      style={{
        borderLeft: `1px solid ${dragOver ? 'var(--accent)' : 'var(--surface-raised)'}`,
        background: 'var(--surface-rail)',
      }}
      onDragOver={allowAttach ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={allowAttach ? () => setDragOver(false) : undefined}
      onDrop={allowAttach ? (e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      } : undefined}
    >
      {/* Header */}
      <div {...headerProps} data-testid="assist-header" className="wk-assist-header flex shrink-0 items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--surface-raised)' }}>
        {headerStart}
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>{context.title}</span>
        {!page && (
        <span
          data-testid="assist-context"
          title={context.contextLabel}
          className="min-w-0 text-[11px]"
          style={{ color: 'var(--ink-muted)', minWidth: 0, overflowWrap: 'anywhere' }}
        >
          {context.contextLabel}
        </span>
        )}
        {onExpandChat !== undefined && latestChatId !== null && (
          <button
            type="button"
            data-testid="assist-dock-expand"
            data-chat-id={latestChatId}
            aria-label="Open in full chat"
            title="Open this conversation in the full chat interface"
            onClick={() => onExpandChat(latestChatId)}
            className={compactHeader ? 'ml-auto wk-chatwin-btn' : 'ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] focus:outline-none focus-visible:ring-1'}
            style={compactHeader ? undefined : { color: 'var(--accent)', border: '1px solid var(--surface-overlay)' }}
          >
            {compactHeader ? <ExternalLink size={14} aria-hidden /> : 'Open in full chat ↗'}
          </button>
        )}
        {headerExtra !== undefined && (
          <span className={`${onExpandChat !== undefined && latestChatId !== null ? '' : 'ml-auto '}flex shrink-0 items-center`}>{headerExtra}</span>
        )}
        {headerEnd !== undefined ? (
          <span className={`${(onExpandChat !== undefined && latestChatId !== null) || headerExtra !== undefined ? '' : 'ml-auto '}flex shrink-0 items-center gap-1`}>{headerEnd}</span>
        ) : (
          <button
            type="button"
            data-testid="assist-dock-toggle"
            aria-label={`Close ${context.title}`}
            aria-expanded
            title="Close (your conversation is kept)"
            onClick={() => onOpenChange(false)}
            className={`${(onExpandChat !== undefined && latestChatId !== null) || headerExtra !== undefined ? '' : 'ml-auto '}wk-btn wk-btn--quiet wk-btn--sm`}
          >
            Close
          </button>
        )}
      </div>

      {page && context.contextLabel !== '' && (
        <p data-testid="assist-context" className="wk-pagechat-scope">{context.contextLabel}</p>
      )}

      {/* Thread — the ONE scrolling region (run blocks scroll inside themselves). */}
      <div ref={threadRef} data-testid="assist-thread" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        {items.length === 0 && (
          <>
            <p data-testid="assist-empty" className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
              {context.hint ?? 'Type below, or drop documents here.'}
            </p>
            {context.controls}
            {context.prompts !== undefined && context.prompts.length > 0 && (
              <div data-testid="assist-prompts" className="flex flex-wrap gap-1.5">
                {context.prompts.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    data-testid="assist-prompt"
                    data-prompt={p.label}
                    title={promptsSend ? 'Asks this now' : 'Prefills the composer — nothing sends until you do'}
                    onClick={() => {
                      if (promptsSend) {
                        setText(p.text);
                        void send(p.text);
                        return;
                      }
                      setText(p.text);
                      textareaRef.current?.focus();
                    }}
                    className="wk-assist-prompt rounded-full px-2.5 py-1 text-left text-[11px] focus:outline-none focus-visible:ring-1"
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
                {item.chip !== undefined && <span className="wk-assist-chip" data-testid="assist-msg-chip">{item.chip}</span>}
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
            return (
              <DockChat
                key={item.chatId}
                chatId={item.chatId}
                resumed={item.resumed === true}
                onResumeProbe={item.resumed === true ? (outcome) => onResumeProbe(item.chatId, outcome) : undefined}
                onStatus={onStatus}
                answerFooter={answerFooter}
                loadHistory={loadHistory}
                turns={page ? inlineTurns[item.chatId] : undefined}
              />
            );
          }
          return <DockRun key={item.runId} runId={item.runId} />;
        })}
        {threadTail}
      </div>

      {/* S16a-4g: what the ACTIVE run or chat asks of the human is answered in its session thread;
          the dock says so in one line (the question and "Answer in its thread ›") — never a card. */}
      {active !== null && (
        <div className="shrink-0 px-3 pt-2" style={{ borderTop: '1px solid var(--surface-raised)' }}>
          <AnswerInThread subject={active} />
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

      {fileMode && files.length > 0 && (
        <div data-testid="assist-files" className="flex shrink-0 flex-wrap gap-1.5 px-3 pt-2">
          {files.map(({ id, file: f }) => (
            <span key={id} data-testid="assist-file-chip" className="wk-chatscope-chip wk-chatscope-chip--on" title={`${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB`}>
              📎 <span className="wk-assist-file-name">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} data-testid="assist-file-remove" className="wk-assist-file-x" onClick={() => setFiles((cur) => cur.filter((x) => x.id !== id))}>×</button>
            </span>
          ))}
        </div>
      )}

      {context.composerControls !== undefined && context.composerControls !== null && (
        <div className="shrink-0 px-3 pt-2">{context.composerControls}</div>
      )}

      {/* Composer — the ChatInput idioms: + attach, auto-resize textarea, Cmd/Ctrl+Enter. */}
      <div className="flex shrink-0 items-end gap-2 px-3 py-3">
        {allowAttach && <>
        <input
          ref={fileInput}
          data-testid="assist-attach"
          type="file"
          multiple
          {...(fileMode ? { accept: 'image/png,image/jpeg,image/gif,image/webp,text/*,application/pdf,.txt,.md,.log,.csv' } : {})}
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
          className="wk-btn wk-btn--icon wk-btn--quiet shrink-0"
        >
          <Paperclip size={15} aria-hidden />
        </button>
        </>}
        <div className="flex min-w-0 flex-1 items-end gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}>
          <textarea
            ref={setTextarea}
            data-testid="assist-input"
            {...(typeTarget !== undefined ? { 'data-type-target': typeTarget } : {})}
            aria-label={context.placeholder}
            className="min-w-0 flex-1 resize-none border-0 bg-transparent text-[12px] leading-5 outline-none"
            style={{ minHeight: '20px', color: 'var(--ink-high)' }}
            placeholder={context.placeholder}
            value={text}
            rows={1}
            disabled={sending}
            onChange={(e) => setText(e.target.value)}
            onPaste={allowAttach && fileMode ? (e) => {
              // A pasted screenshot (or any file) attaches. Pasted WORDS always type: rich text from an
              // office app carries a preview image too, and that image is not what the user pasted.
              const pasted = Array.from(e.clipboardData?.files ?? []);
              if (pasted.length === 0 || (e.clipboardData?.getData('text/plain') ?? '') !== '') return;
              e.preventDefault();
              onFiles(pasted);
            } : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <VoiceMicButton size="xs" testId="assist-voice-open" />
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
      {notice !== undefined && notice !== null && (
        <p data-testid="assist-notice" className="wk-assist-notice">{notice}</p>
      )}
    </aside>
  );
}
