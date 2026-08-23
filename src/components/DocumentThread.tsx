import { useEffect, useRef, useState } from 'react';
import { createDoc, getVersions, injectDocMessage, interactiveUrl, postEvent, postFork } from '../api/interactive.js';
import { ComposerContext } from './ComposerContext.js';
import { DemoWizard } from './DemoWizard.js';
import { recordFromThread } from '../interactive/demoWire.js';
import { runExport } from '../interactive/exportWire.js';
import { retryBatchInject } from '../interactive/feedbackBatch.js';
import { scrollToWid } from '../interactive/widScroller.js';
import { scrollStripToVersion } from './threadAnchor.js';
import { modePath, versionPath, type Navigate } from '../hooks/useRoute.js';
import { nextMsgId, threadKey, useDocThreadStore, type DocMsg, type GenState } from '../store/docThread.js';

// Document mode's half of the ONE conversation (DES-MERGE-001 §2, §6.3 slice 10).
//
// Same thread contract as Build's (`data-testid="thread"` + `data-message-id`, the seam
// slice 9's version→message cross-link resolves through), one composer, and what Enter
// DOES is a pure function of the generation's state (§2.2) — the user never picks a verb:
//
//   idle       no document in the route → CREATE: `POST /api/docs` seeds the brief and
//              the doc's generation run opens with this message as its first line.
//   generating → STEER: `wicked.interactive.chat.posted` injects into the live agent.
//   gated      → ANSWER: the question is answerable in the transcript, where it was asked.
//   terminal   → CONTINUE: fork + inject as ONE atomic composer action (§7.10). The thread
//              renders the linked run as a continuation — a version divider, no new header.
//
// There is no dead composer state and no synthetic liveness: no whimsy filler (filtered in
// the store, §3.2), no `status.requested` heartbeat (never emitted at all).

// DES-VISION-001 §5.5 token usage: the thread sits on --surface-base; agent
// bubbles on --surface-card, user messages transparent with a hairline (the
// same pair Chat wears, §5.3 — one language across modes). Cross-links and
// primary actions speak the brand accent; live/steering state speaks the §2.6
// run-emerald; gates and actionables the gate-amber; failures the fail-red.
// Version tags are history, so they read --status-done (§5.5, mirrored by
// Video's "recording complete" tag).
const S = {
  panel:  'var(--surface-base)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  body:   'var(--ink-body)',
  muted:  'var(--ink-muted)',
  faint:  'var(--ink-dim)',
  accent: 'var(--accent)',
  card:   'var(--surface-card)',
  footer: 'var(--surface-rail)',
  live:   'var(--status-run)',
  danger: 'var(--status-fail)',
  done:   'var(--status-done)',
};

/** What the composer says it will do — the affordance, in words (§2.2, §3.3). */
const COMPOSER: Record<GenState, { placeholder: string; submit: string }> = {
  idle:       { placeholder: 'Describe the document you want…',        submit: 'Create' },
  generating: { placeholder: 'Steer the document agent…',              submit: 'Send' },
  gated:      { placeholder: 'Answer the question above…',             submit: 'Answer' },
  terminal:   { placeholder: 'Ask for a change — it lands as a new version…', submit: 'Send' },
};

// ── Message renderers ────────────────────────────────────────────────────────

/** DES-UX-001 §6.1: where one user message sits in its send lifecycle. Derived from
 *  the store's pending FIFO — head = being worked, rest = queued behind the current
 *  run — plus the message's own `failed` flag. `undefined` = resolved (or historic). */
export type SendState = 'generating' | 'queued' | 'failed';

function Bubble({
  msg, projectId, docId, onShowVersion, sendState, onRetrySend,
}: {
  msg: DocMsg; projectId: string; docId: string | null;
  /** The tag's cross-link (DES-UXFIX-001 §2.6 rule 2): show this version on the strip. */
  onShowVersion?: (version: number) => void;
  /** §6.1 lifecycle chip for a user message still in flight (or refused). */
  sendState?: SendState | undefined;
  /** Re-arm a refused send — §6.1's "visible failure with a retry". */
  onRetrySend?: (msg: Extract<DocMsg, { kind: 'user' }>) => void;
}): React.ReactElement | null {
  if (msg.kind === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div
          data-testid="doc-message"
          data-message-id={msg.id}
          data-version={msg.version === undefined ? undefined : String(msg.version)}
          data-items={msg.items === undefined ? undefined : String(msg.items.length)}
          // §5.3's user-message rule, shared across modes: transparent, a
          // hairline keeps the bubble shape without claiming a surface.
          className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
          style={{ background: 'transparent', color: S.ink, border: `1px solid ${S.border}`,
                   fontFamily: 'var(--font-sans)' }}
        >
          {msg.text}
          {/* §4.3: each batched item DEEP-LINKS back to its element — the frame scrolls
              it into view over the same protocol that reported its rect. On-accent:
              a cross-link is an affordance, not a status (§2.5). */}
          {msg.items !== undefined && msg.items.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {msg.items.map((item, i) => (
                <button
                  key={`${item.wid}-${i}`}
                  type="button"
                  data-testid="feedback-item-link"
                  data-wid={item.wid}
                  title={`Show “${item.wid}” in the document`}
                  onClick={() => scrollToWid(item.wid)}
                  className="rounded-full px-2 py-0.5 text-[10px] font-mono"
                  style={{ background: 'transparent', color: S.accent,
                           border: '1px solid var(--accent-subtle)', cursor: 'pointer' }}
                >
                  {i + 1}. {item.wid}
                </button>
              ))}
            </div>
          )}
          {msg.notRecorded === true && docId !== null && (
            <NotRecordedChip projectId={projectId} docId={docId} msgId={msg.id} text={msg.text} />
          )}
        </div>
        {/* §2.6 rule 2 (DES-UXFIX-001, the F9 fix): the message that produced a version
            is TAGGED with it, and the tag cross-links to the strip — the same seam the
            strip's "In thread" crosses the other way. The eye can trace canvas ↔ strip ↔
            thread in both directions. */}
        {/* §5.5: the version marker is HISTORY — --status-done ink on a
            --radius-sm badge (Video's "recording complete" tag mirrors it).
            DES-UX-001 §6.1: `data-caused-by` names the message that produced the
            version — the marker renders ON its causing message, so the anchor is
            structural: no marker can render under an unrelated request (EC36). */}
        {msg.version !== undefined && (
          <button
            type="button"
            data-testid="version-marker"
            data-version={String(msg.version)}
            data-caused-by={msg.id}
            onClick={() => { if (msg.version !== undefined) onShowVersion?.(msg.version); }}
            title={`This message made v${msg.version} — show it on the canvas and the strip`}
            className="px-2 py-0.5 text-[10px] font-mono"
            style={{ background: 'transparent', color: S.done,
                     border: `1px solid ${S.border}`, borderRadius: 'var(--radius-sm)',
                     cursor: 'pointer' }}
          >
            ▤ v{msg.version} landed
          </button>
        )}
        {/* DES-UX-001 §6.1 (EC36): every send resolves VISIBLY. The chip beneath a
            user message says where the send is — being worked now (run-emerald, the
            live pair), queued behind the current run (the honest client-side rendering
            of the bridge's FIFO — §8.4.1 probe 1: the wire acks 200 and queues, but
            carries no queue-position, so the position is the client's own order), or
            refused with a retry (fail-red). It clears when the marker above lands. */}
        {sendState === 'generating' && (
          <span
            data-testid="thread-generating"
            className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-mono"
            style={{ background: 'var(--status-run-dim)', color: S.live,
                     border: '1px solid var(--status-run-dim)' }}
          >
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: S.live }} />
            generating — this message is being worked now
          </span>
        )}
        {sendState === 'queued' && (
          <span
            data-testid="thread-queued"
            className="rounded-full px-2.5 py-0.5 text-[10px] font-mono"
            style={{ background: 'transparent', color: S.muted,
                     border: `1px solid ${S.border}` }}
          >
            queued behind the current run
          </span>
        )}
        {sendState === 'failed' && (
          <span
            data-testid="thread-send-failed"
            className="flex items-center gap-2 rounded-full px-2.5 py-0.5 text-[10px] font-mono"
            style={{ background: 'var(--status-fail-dim)', color: S.danger,
                     border: '1px solid var(--status-fail-dim)' }}
          >
            send failed — nothing landed for this message
            <button
              type="button"
              data-testid="thread-send-retry"
              onClick={() => onRetrySend?.(msg)}
              className="underline font-mono text-[10px]"
              style={{ background: 'transparent', border: 'none', color: S.danger,
                       cursor: 'pointer', padding: 0 }}
            >
              retry
            </button>
          </span>
        )}
      </div>
    );
  }
  if (msg.kind === 'narration') {
    // Narration is data: the mono, body ink (§2.8); the dot is the run-emerald.
    return (
      <div className="flex items-start gap-2 text-xs font-mono" data-testid="doc-narration" style={{ color: S.body }}>
        <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: S.live }} />
        <span>{msg.text}</span>
      </div>
    );
  }
  if (msg.kind === 'divider') {
    // §7.10: the seam between two runs is a version divider, NOT a new thread header.
    return (
      <div className="flex items-center gap-2" data-testid="version-divider" data-version={String(msg.version)}>
        <span className="flex-1 h-px" style={{ background: S.border }} />
        <span className="text-[10px] font-mono shrink-0" style={{ color: S.faint }}>
          continues as v{msg.version}
        </span>
        <span className="flex-1 h-px" style={{ background: S.border }} />
      </div>
    );
  }
  if (msg.kind === 'actionable') {
    return <ActionableCard msg={msg} projectId={projectId} docId={docId} />;
  }
  if (msg.kind === 'agent' || msg.kind === 'verdict') {
    return (
      <div className="self-start max-w-[90%] flex flex-col gap-1" data-testid={`doc-${msg.kind}`}>
        <span className="text-[10px] font-mono uppercase tracking-wide" style={{ color: S.faint }}>
          {msg.kind === 'verdict' ? `${msg.author} · review` : msg.author}
        </span>
        {/* Agent prose on --surface-card in the sans — §5.3's bubble pair. */}
        <div className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
             style={{ background: S.card, border: `1px solid ${S.border}`, color: S.body,
                      fontFamily: 'var(--font-sans)' }}>
          {msg.text}
          {msg.kind === 'agent' && msg.href !== undefined && (
            // Served THROUGH the proxy, on the page's own origin (§5.3) — there is no
            // second origin to download from. `download` names the file the service named
            // (§4.4's doc-slug naming), so what lands on disk is what the message says.
            <a
              data-testid="doc-artifact-download"
              href={interactiveUrl(projectId, msg.href)}
              download={msg.file ?? true}
              className="block mt-2 text-xs font-mono underline"
              style={{ color: S.accent }}
            >
              Download {msg.file ?? ''}
            </a>
          )}
        </div>
      </div>
    );
  }
  return null;
}

/**
 * §3.3's ACTIONABLE kind, rendered: what happened, the service's own fix NAMED verbatim,
 * and the control that runs it again — all in the same block. Both halves are mandatory
 * on purpose: a hint with no button is a dead end, and a button with no command is a
 * retry that fails identically. §4.4's PPTX case is what this exists for — python-pptx
 * absent is a stated install command and a document that never stopped being usable.
 */
function ActionableCard({
  msg, projectId, docId,
}: {
  msg: Extract<DocMsg, { kind: 'actionable' }>; projectId: string; docId: string | null;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const retry = msg.retry;
  return (
    // Actionable = "this needs you": the §2.6 gate-amber pair, exactly the
    // GateChip convention — dim for the block, full for the command text.
    <div
      data-testid="doc-actionable"
      className="rounded-xl px-3.5 py-3 flex flex-col gap-2"
      style={{ background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)' }}
    >
      <p className="text-sm leading-relaxed" style={{ color: S.ink, margin: 0, fontFamily: 'var(--font-sans)' }}>
        {msg.text}
      </p>
      <code data-testid="doc-actionable-hint" className="text-[11px] font-mono whitespace-pre-wrap"
            style={{ color: 'var(--status-gate)' }}>
        {msg.hint}
      </code>
      {retry !== undefined && docId !== null && (
        <button
          type="button"
          data-testid="doc-actionable-retry"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void runExport({ projectId, docId, version: retry.version, format: retry.format })
              .finally(() => setBusy(false));
          }}
          className="self-start rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--status-gate)', color: 'var(--surface-base)',
                   border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
        >
          {busy ? 'Exporting…' : `Export ${retry.format.toUpperCase()} again`}
        </button>
      )}
    </div>
  );
}

/**
 * §7.7's failure shape, made actionable (§3.3). The bus event landed — the document IS
 * regenerating — so this never blocks the batch or offers to "undo" it. It says exactly
 * what did not happen (the run has no record of the message) and retries that one wire.
 */
function NotRecordedChip({
  projectId, docId, msgId, text,
}: { projectId: string; docId: string; msgId: string; text: string }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      data-testid="feedback-not-recorded"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        // A retry that fails again is not a new failure to report — the chip IS the
        // report, and it stays up. Swallowed deliberately rather than left to reject
        // unhandled into the console.
        void retryBatchInject(projectId, docId, msgId, text)
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
      className="mt-2 block rounded-full px-2 py-0.5 text-[10px] font-mono disabled:opacity-40"
      style={{ background: 'var(--status-fail-dim)', color: S.danger,
               border: '1px solid var(--status-fail-dim)', cursor: 'pointer' }}
    >
      {busy ? 'retrying…' : 'not recorded in the run — retry'}
    </button>
  );
}

/**
 * §2.2 case 3 — the gate is answered WHERE IT WAS ASKED. Options answer in one click;
 * free text answers with a steer in the same submit. Either way one bus emit.
 */
function GateCard({
  msg, projectId, docId, onAnswered,
}: {
  msg: Extract<DocMsg, { kind: 'gate' }>;
  projectId: string;
  docId: string;
  onAnswered: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(text: string): Promise<void> {
    if (busy || text.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await postEvent(projectId, {
        event_type: 'wicked.interactive.question.answered',
        payload: { request_id: msg.requestId, answer: text.trim(), document_id: docId },
      });
      onAnswered();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    // A gate speaks the §2.6 gate-amber pair (the GateChip convention); the
    // question itself is prose → sans.
    <div
      data-testid="doc-gate"
      data-request-id={msg.requestId}
      className="rounded-xl px-3.5 py-3 flex flex-col gap-2"
      style={{ background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)' }}
    >
      <p className="text-sm" style={{ color: 'var(--status-gate)', margin: 0, fontFamily: 'var(--font-sans)' }}>
        {msg.question}
      </p>
      {msg.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {msg.options.map((option) => (
            <button
              key={option}
              type="button"
              data-testid="doc-gate-option"
              disabled={busy}
              onClick={() => void answer(option)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-40"
              style={{ background: 'var(--status-gate)', color: 'var(--surface-base)',
                       border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {error !== null && (
        <p data-testid="doc-gate-error" className="text-[11px] font-mono" style={{ color: S.danger, margin: 0 }}>
          Not sent: {error} — the question is still open; answer again.
        </p>
      )}
    </div>
  );
}

// ── The thread ───────────────────────────────────────────────────────────────

export interface DocumentThreadProps {
  projectId: string;
  /** `null` on `/p/:projectId/document` — nothing generated yet, so the composer creates. */
  docId: string | null;
  /** The routed `?v=N`; `null` means the head, which fork resolves from the manifest. */
  selectedVersion: number | null;
  navigate: Navigate;
  /**
   * Which artifact this thread's composer is launching (§6.4 slice 14). A demo IS a
   * document, so this is the SAME thread with the same four states — what differs is
   * only case 1: a demo's steps are ordered, so the launch discloses the wizard (§4.1)
   * instead of taking the message as a brief. Default keeps Document mode untouched.
   */
  mode?: 'document' | 'video';
}

export function DocumentThread({ projectId, docId, selectedVersion, navigate, mode = 'document' }: DocumentThreadProps): React.ReactElement {
  const key = docId === null ? null : threadKey(projectId, docId);
  const messages = useDocThreadStore((s) => (key === null ? EMPTY : s.messages[key] ?? EMPTY));
  const streamed = useDocThreadStore((s) => (key === null ? undefined : s.genState[key]));
  // §6.1: the send FIFO — head is being worked, the rest are queued behind it.
  const pendingIds = useDocThreadStore((s) => (key === null ? EMPTY_IDS : s.pending[key] ?? EMPTY_IDS));
  // §6.3: whether this thread's text was rehydrated from the conversation read.
  const hydratedFromWire = useDocThreadStore((s) => (key === null ? false : s.hydrated[key] === true));
  // A document that exists with nothing in flight IS case 4: complete, and editable (§7.10).
  const state: GenState = docId === null ? 'idle' : streamed ?? 'terminal';
  // NOTE (issue #65): slice 16's picked theme no longer rides here. The `theme_id` it
  // put on the create body and the injected message was consumed by NOTHING — the theme
  // registry it named never existed on the bridge. A document's look is learned per-doc
  // (`requestThemeLearn`) and applied server-side at every version creation.

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The demo path's ordered disclosure (§4.1), seeded by the message that opened it. The
  // anchor id is minted BEFORE the wizard so the version it lands tags the same message
  // the transcript shows (§7.6) — the wizard is a longer way to write case 1, not a
  // different case.
  const [wizard, setWizard] = useState<{ seed: string; msgId: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const gate = state === 'gated'
    ? [...messages].reverse().find((m): m is Extract<DocMsg, { kind: 'gate' }> => m.kind === 'gate') ?? null
    : null;

  async function submit(): Promise<void> {
    const body = text.trim();
    if (body === '' || busy) return;
    const store = useDocThreadStore.getState();
    const msgId = nextMsgId();
    setBusy(true);
    setError(null);
    try {
      // 1 — LAUNCH, the demo path (§4.5): the ask names the demo, and the wizard collects
      // the steps it is made of, in order. Nothing is created until the wizard submits.
      if ((docId === null || key === null) && mode === 'video') {
        setWizard({ seed: body, msgId });
        setText('');
        return;
      }

      // 1 — LAUNCH. The message IS the brief; the doc's generation run opens with it.
      if (docId === null || key === null) {
        const created = await createDoc(projectId, {
          name: docName(body), kind: 'source', brief: body, project: projectId,
          source_message_id: msgId,
        });
        const opened = threadKey(projectId, created.name);
        store.addUserMsg(opened, msgId, body);
        store.addNarration(opened, `Generating “${created.name}” from your brief.`);
        store.setGenState(opened, 'generating');
        setText('');
        navigate(versionPath(projectId, created.name, null));
        return;
      }

      // 4 — CONTINUE (§7.10). Fork + inject is ONE composer action: the branch lands, the
      // divider marks it, and the same message steers the run that continues from it. The
      // seam is hidden in the UI; underneath it is still two governed runs (§2.4).
      if (state === 'terminal') {
        const from = selectedVersion ?? (await getVersions(projectId, docId)).head;
        const forked = await postFork(projectId, docId, from, msgId);
        store.addDivider(key, forked.version);
        store.addUserMsg(key, msgId, body);
        store.setGenState(key, 'generating');
        // §6.1 (EC36): once the message is ON the thread, a refused send fails
        // THERE — the failed chip with its retry, never a silent transcript row.
        try {
          await injectDocMessage(projectId, docId, body, msgId);
        } catch {
          failVisibly(msgId);
        }
        setText('');
        navigate(versionPath(projectId, docId, forked.version));
        return;
      }

      // 2 / 3 — STEER, and answer a gate WITH a steer in the same submit.
      store.addUserMsg(key, msgId, body);
      try {
        if (state === 'gated' && gate !== null) {
          await postEvent(projectId, {
            event_type: 'wicked.interactive.question.answered',
            payload: { request_id: gate.requestId, answer: body, document_id: docId },
          });
          store.setGenState(key, 'generating');
        } else {
          await injectDocMessage(projectId, docId, body, msgId);
        }
      } catch {
        failVisibly(msgId);
      }
      setText('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** §6.1's visible failure: the message stays on the thread wearing the failed
   *  chip; the working state retires when nothing else is pending behind it. */
  function failVisibly(msgId: string): void {
    if (key === null) return;
    const store = useDocThreadStore.getState();
    store.markSendFailed(key, msgId);
    if ((useDocThreadStore.getState().pending[key] ?? []).length === 0
        && useDocThreadStore.getState().genState[key] === 'generating') {
      store.setGenState(key, 'terminal');
    }
  }

  /** §6.1's retry: a re-send is a NEW send — re-enqueued at the tail, re-emitted on
   *  the same wire the message originally rode (the gate's answer wire while the
   *  gate is still open, the inject wire otherwise). */
  async function retrySend(msg: Extract<DocMsg, { kind: 'user' }>): Promise<void> {
    if (docId === null || key === null) return;
    const store = useDocThreadStore.getState();
    store.retrySend(key, msg.id);
    try {
      if (state === 'gated' && gate !== null) {
        await postEvent(projectId, {
          event_type: 'wicked.interactive.question.answered',
          payload: { request_id: gate.requestId, answer: msg.text, document_id: docId },
        });
      } else {
        await injectDocMessage(projectId, docId, msg.text, msg.id);
      }
      useDocThreadStore.getState().setGenState(key, 'generating');
    } catch {
      failVisibly(msg.id);
    }
  }

  /** Where a user message sits in its §6.1 lifecycle (see `SendState`). */
  function sendStateOf(msg: DocMsg): SendState | undefined {
    if (msg.kind !== 'user') return undefined;
    if (msg.failed === true) return 'failed';
    const at = pendingIds.indexOf(msg.id);
    if (at === -1) return undefined;
    return at === 0 ? 'generating' : 'queued';
  }

  // The tag's cross-link (§2.6 rule 2): selecting the version IS a navigation — the
  // same `?v=N` the strip selects by — plus putting its strip entry in view. The strip
  // owns the reverse direction (its select scrolls the thread to the message, §7.6).
  function showVersion(version: number): void {
    if (docId === null) return;
    navigate(versionPath(projectId, docId, version));
    scrollStripToVersion(version);
  }

  const { placeholder, submit: label } = COMPOSER[state];
  // Case 1 is the only state whose words differ by artifact — what the composer DOES is
  // the same function of run state either way (§2.2), it just says what it will make.
  const prompt = mode === 'video' && state === 'idle'
    ? 'Describe the demo you want to record…' : placeholder;

  return (
    <div
      data-testid="thread"
      data-composer-state={state}
      className="flex flex-col shrink-0 relative"
      // §5.5: the thread pane sits on --surface-base; prose defaults to the
      // sans — only data (narration, tags, ids) opts into the mono (§2.8).
      // DES-FEEDBACK-001 §7.3: the pane fills whatever hosts it — its host is
      // now the thread DRAWER, which owns the min(440px, 40vw) width.
      style={{ width: '100%', minHeight: 0, flex: 1, background: S.panel,
               borderLeft: `1px solid ${S.border}`, fontFamily: 'var(--font-sans)' }}
    >
      {wizard !== null && (
        <DemoWizard
          projectId={projectId}
          seed={wizard.seed}
          msgId={wizard.msgId}
          onCancel={() => setWizard(null)}
          onCreated={(name) => {
            setWizard(null);
            // The demo exists with its spec and no recording — so the surface it opens on
            // is the one that OFFERS to record it (§3.3: the control beside the statement).
            navigate(modePath(projectId, 'video', name));
          }}
        />
      )}
      <div className="flex-1 overflow-y-auto px-3.5 py-4 flex flex-col gap-3">
        {/* §6.3's stopgap note, scoped to the ONE gap the wire still has: the thread's
            TEXT is back from `GET /d/:doc/api/conversation` (BRIDGE-UX-1 probe 2 — a
            real read), but the transcript carries no version anchors, so markers are
            session-observed only. A promise with a pointer, never a shrug — and it
            renders only while a restored message actually lacks its marker. */}
        {hydratedFromWire
          && messages.some((m) => m.kind === 'user' && m.restored === true && m.version === undefined)
          && (
            <p
              data-testid="thread-stopgap"
              className="text-[11px] leading-relaxed rounded-lg px-3 py-2"
              style={{ color: S.muted, background: S.card, border: `1px solid ${S.border}`,
                       margin: 0, fontFamily: 'var(--font-sans)' }}
            >
              Thread restored from the document’s transcript. Version markers show what
              this session observed — markers from before this session return when the
              transcript carries version anchors (BRIDGE-UX-1 §8.4.1).
            </p>
          )}
        {messages.length === 0 && (
          <p className="leading-relaxed" style={{ color: S.body, fontSize: 'var(--text-sm)' }}>
            {docId === null
              ? mode === 'video'
                ? 'Describe the demo you want — “a walkthrough of the checkout flow” — and its steps are authored from there, in order.'
                : 'Describe the document you want — “a deck for the Q3 review”, “write this up as a report” — and it is created from that message.'
              : 'Ask for a change and it lands as a new version. Everything the agent says about this document appears here.'}
          </p>
        )}
        {messages.map((m) =>
          m.kind === 'gate'
            ? (docId !== null && key !== null && (
                <GateCard
                  key={m.id}
                  msg={m}
                  projectId={projectId}
                  docId={docId}
                  onAnswered={() => useDocThreadStore.getState().setGenState(key, 'generating')}
                />
              )) || null
            : (
                <Bubble
                  key={m.id}
                  msg={m}
                  projectId={projectId}
                  docId={docId}
                  onShowVersion={showVersion}
                  sendState={sendStateOf(m)}
                  onRetrySend={(msg) => void retrySend(msg)}
                />
              ),
        )}
        <div ref={bottom} />
      </div>

      <div className="shrink-0 px-3.5 py-3 flex flex-col gap-2"
           style={{ borderTop: `1px solid ${S.border}`, background: S.footer }}>
        {/* §2.3: asking for a recording is an input like any other, so it is a MESSAGE —
            the same wire the storyboard's own Record button uses, offered here because
            the composer is where the user already is when they decide to re-run it. */}
        {mode === 'video' && docId !== null && state !== 'generating' && (
          <button
            type="button"
            data-testid="thread-record"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void recordFromThread({ projectId, demoId: docId, ask: `Record “${docId}”.` })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
            className="self-start rounded-full px-2.5 py-0.5 text-[10px] font-mono disabled:opacity-40"
            style={{ background: 'transparent', color: S.accent,
                     border: '1px solid var(--accent-subtle)', cursor: 'pointer' }}
          >
            record this demo
          </button>
        )}
        {/* §4.6/§4.9: what the next generation is MADE OF — the learned theme in effect and
            the folders the service reads in place — stated where the message is composed.
            Document mode only: a demo's look comes from the site it records (§4.5). */}
        {mode === 'document' && <ComposerContext projectId={projectId} docId={docId} />}
        {state === 'generating' && (
          <span
            data-testid="steering-chip"
            className="self-start flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-mono"
            style={{ background: 'var(--status-run-dim)', color: S.live,
                     border: '1px solid var(--status-run-dim)' }}
          >
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: S.live }} />
            steering the live {mode === 'video' ? 'demo' : 'document'} run
          </span>
        )}
        {/* §5.3's composer contract, worn by every mode: --surface-raised at
            --radius-xl, the wk-composer focus ring (--accent-dim via
            :focus-within — never the full accent), an accent-filled submit. */}
        <div className="wk-composer flex items-end gap-2 px-3 py-2"
             style={{ background: 'var(--surface-raised)',
                      border: '1px solid var(--surface-overlay)',
                      borderRadius: 'var(--radius-xl)' }}>
          <textarea
            data-testid="doc-composer"
            className="flex-1 resize-none text-sm outline-none border-0 bg-transparent leading-6"
            style={{ color: S.ink, fontFamily: 'var(--font-sans)', minHeight: '28px' }}
            placeholder={prompt}
            value={text}
            rows={1}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
            }}
          />
          <button
            type="button"
            data-testid="doc-composer-submit"
            onClick={() => void submit()}
            disabled={busy || text.trim() === ''}
            className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ background: S.accent, color: 'var(--accent-fg)', border: 'none',
                     cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          >
            {busy ? '…' : label}
          </button>
        </div>
        {error !== null && (
          <p data-testid="doc-composer-error" className="text-[11px] font-mono" style={{ color: S.danger, margin: 0 }}>
            {error} — nothing was sent; edit and try again.
          </p>
        )}
      </div>
    </div>
  );
}

/** Stable identity for "no messages" so the selector never returns a fresh array. */
const EMPTY: DocMsg[] = [];

/** Stable identity for "nothing pending" — same rule as EMPTY. */
const EMPTY_IDS: string[] = [];

/** The doc's name is DERIVED from the ask (§4.1) — the bridge slugifies what it gets. */
function docName(brief: string): string {
  return brief.split(/\s+/).slice(0, 6).join(' ').slice(0, 60);
}

