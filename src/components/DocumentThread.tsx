import { useEffect, useRef, useState } from 'react';
import { createDoc, getVersions, interactiveUrl, postEvent, postFork } from '../api/interactive.js';
import { versionPath, type Navigate } from '../hooks/useRoute.js';
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

const S = {
  panel:  '#161b22',
  border: 'rgba(230,237,243,0.1)',
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
  faint:  'rgba(230,237,243,0.35)',
  accent: '#ffda19',
  user:   '#224a5e',
  card:   '#1b222e',
  footer: '#161c26',
  live:   '#79c0ff',
  danger: '#f85149',
};

/** What the composer says it will do — the affordance, in words (§2.2, §3.3). */
const COMPOSER: Record<GenState, { placeholder: string; submit: string }> = {
  idle:       { placeholder: 'Describe the document you want…',        submit: 'Create' },
  generating: { placeholder: 'Steer the document agent…',              submit: 'Send' },
  gated:      { placeholder: 'Answer the question above…',             submit: 'Answer' },
  terminal:   { placeholder: 'Ask for a change — it lands as a new version…', submit: 'Send' },
};

// ── Message renderers ────────────────────────────────────────────────────────

function Bubble({ msg, projectId }: { msg: DocMsg; projectId: string }): React.ReactElement | null {
  if (msg.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div
          data-testid="doc-message"
          data-message-id={msg.id}
          data-version={msg.version === undefined ? undefined : String(msg.version)}
          className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
          style={{ background: S.user, color: S.ink, border: `1px solid ${S.border}` }}
        >
          {msg.text}
        </div>
      </div>
    );
  }
  if (msg.kind === 'narration') {
    return (
      <div className="flex items-start gap-2 text-xs font-mono" data-testid="doc-narration" style={{ color: S.faint }}>
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
  if (msg.kind === 'agent' || msg.kind === 'verdict') {
    return (
      <div className="self-start max-w-[90%] flex flex-col gap-1" data-testid={`doc-${msg.kind}`}>
        <span className="text-[10px] font-mono uppercase tracking-wide" style={{ color: S.faint }}>
          {msg.kind === 'verdict' ? `${msg.author} · review` : msg.author}
        </span>
        <div className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
             style={{ background: S.card, border: `1px solid ${S.border}`, color: S.ink }}>
          {msg.text}
          {msg.kind === 'agent' && msg.href !== undefined && (
            <a
              data-testid="doc-artifact-download"
              href={interactiveUrl(projectId, msg.href)}
              download
              className="block mt-2 text-xs font-mono underline"
              style={{ color: S.accent }}
            >
              Download
            </a>
          )}
        </div>
      </div>
    );
  }
  return null;
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
    <div
      data-testid="doc-gate"
      data-request-id={msg.requestId}
      className="rounded-xl px-3.5 py-3 flex flex-col gap-2"
      style={{ background: 'rgba(255,218,25,0.06)', border: '1px solid rgba(255,218,25,0.2)' }}
    >
      <p className="text-sm" style={{ color: S.accent, margin: 0 }}>{msg.question}</p>
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
              style={{ background: S.accent, color: '#0d1117', border: 'none', cursor: 'pointer' }}
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
}

export function DocumentThread({ projectId, docId, selectedVersion, navigate }: DocumentThreadProps): React.ReactElement {
  const key = docId === null ? null : threadKey(projectId, docId);
  const messages = useDocThreadStore((s) => (key === null ? EMPTY : s.messages[key] ?? EMPTY));
  const streamed = useDocThreadStore((s) => (key === null ? undefined : s.genState[key]));
  // A document that exists with nothing in flight IS case 4: complete, and editable (§7.10).
  const state: GenState = docId === null ? 'idle' : streamed ?? 'terminal';

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        await inject(projectId, docId, body, msgId);
        setText('');
        navigate(versionPath(projectId, docId, forked.version));
        return;
      }

      // 2 / 3 — STEER, and answer a gate WITH a steer in the same submit.
      store.addUserMsg(key, msgId, body);
      if (state === 'gated' && gate !== null) {
        await postEvent(projectId, {
          event_type: 'wicked.interactive.question.answered',
          payload: { request_id: gate.requestId, answer: body, document_id: docId },
        });
        store.setGenState(key, 'generating');
      } else {
        await inject(projectId, docId, body, msgId);
      }
      setText('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const { placeholder, submit: label } = COMPOSER[state];

  return (
    <div
      data-testid="thread"
      data-composer-state={state}
      className="flex flex-col shrink-0"
      style={{ width: '340px', background: S.panel, borderLeft: `1px solid ${S.border}` }}
    >
      <div className="flex-1 overflow-y-auto px-3.5 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-xs leading-relaxed" style={{ color: S.muted }}>
            {docId === null
              ? 'Describe the document you want — “a deck for the Q3 review”, “write this up as a report” — and it is created from that message.'
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
            : <Bubble key={m.id} msg={m} projectId={projectId} />,
        )}
        <div ref={bottom} />
      </div>

      <div className="shrink-0 px-3.5 py-3 flex flex-col gap-2"
           style={{ borderTop: `1px solid ${S.border}`, background: S.footer }}>
        {state === 'generating' && (
          <span
            data-testid="steering-chip"
            className="self-start flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-mono"
            style={{ background: 'rgba(121,192,255,0.08)', color: S.live, border: '1px solid rgba(121,192,255,0.2)' }}
          >
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: S.live }} />
            steering the live document run
          </span>
        )}
        <div className="flex items-end gap-2 rounded-2xl px-3 py-2"
             style={{ background: S.card, border: `1px solid ${S.border}` }}>
          <textarea
            data-testid="doc-composer"
            className="flex-1 resize-none text-sm outline-none border-0 bg-transparent leading-6"
            style={{ color: S.ink, fontFamily: 'inherit', minHeight: '28px' }}
            placeholder={placeholder}
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
            style={{ background: S.accent, color: '#0d1117', border: 'none', cursor: 'pointer' }}
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

/** The doc's name is DERIVED from the ask (§4.1) — the bridge slugifies what it gets. */
function docName(brief: string): string {
  return brief.split(/\s+/).slice(0, 6).join(' ').slice(0, 60);
}

/** Steering = one `chat.posted` carrying the anchor id (§7.6) into the agent's session. */
function inject(projectId: string, docId: string, text: string, msgId: string): Promise<unknown> {
  return postEvent(projectId, {
    event_type: 'wicked.interactive.chat.posted',
    payload: { role: 'user', text, document_id: docId, source_message_id: msgId },
  });
}
