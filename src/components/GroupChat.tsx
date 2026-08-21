import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { Markdown } from './Markdown.js';

/**
 * CHAT (crew#165 / core#134): warm persistent CLI sessions + fan-out.
 *
 * NOT a run — no council, no gates, no units. Each user message fans out to
 * every warm seat and the replies stream back side by side (`chatDelta` tokens,
 * `chatReply` terminal). Sessions hold conversation memory across turns; they
 * live until "Close" (or daemon shutdown) — leaving the page keeps them warm.
 *
 * NOTHING warms on mount (DES-UXFIX-001 §2.4, F6). First-run is a calm teaching
 * state: one line on what Chat is, a focused composer, and ONE disclosure —
 * "Add agents". The first send warms the one default agent; "Add agents" warms
 * the whole roster and turns the header into the multi-agent chip strip. The
 * warm-and-rejoin machinery (FINDING-027) is preserved verbatim — it just runs
 * on opt-in, not on mount: a stored chat the daemon still holds is rejoined
 * exactly as before, because warm seats someone paid for must not be orphaned.
 */

/**
 * Seat identity under the token contract (DES-VISION-001 §2.11): every chip and
 * avatar wears the SAME surface/ink pair, and identity rides the monogram +
 * name, not a per-CLI hue. Color is reserved for signal (§1.5 rule 2): the
 * chip's dot speaks the §2.6 status layer — warming = amber, ready = emerald,
 * failed = red — and nothing else on the seat is colored.
 */
const SEAT_CHIP = { bg: 'var(--surface-raised)', fg: 'var(--ink-body)' } as const;

type SeatState = 'warming' | 'ready' | 'failed';

const SEAT_DOT: Record<SeatState, string> = {
  warming: 'var(--status-gate)',
  ready: 'var(--status-run)',
  failed: 'var(--status-fail)',
};

/**
 * Where a repo's live chat id is parked between mounts (FINDING-027).
 *
 * `sessionStorage`, not `localStorage`: chats belong to the daemon process, and a chat id that
 * outlived a daemon restart would point at a session that no longer exists. Per-tab scope also
 * keeps two tabs on the same repo from fighting over one chat. Keyed by repo because the effect
 * that owns the id is keyed by repo — one live chat per repo per tab.
 */
const CHAT_ID_KEY = (repoId?: string | null): string => `wicked.chat.${repoId ?? '_'}`;

/** All three wrapped: sessionStorage throws in private-mode/blocked-cookie browsers, and a chat
 *  the operator cannot open is a worse outcome than a chat that leaks. Degrades to mint-per-mount,
 *  which is exactly the pre-fix behaviour — no new failure, just no improvement. */
function readStoredChatId(repoId?: string | null): string | null {
  try {
    const v = sessionStorage.getItem(CHAT_ID_KEY(repoId));
    return v !== null && v !== '' ? v : null;
  } catch {
    return null;
  }
}
function writeStoredChatId(repoId: string | null | undefined, chatId: string): void {
  try {
    sessionStorage.setItem(CHAT_ID_KEY(repoId), chatId);
  } catch {
    /* non-fatal — see above */
  }
}
function clearStoredChatId(repoId?: string | null): void {
  try {
    sessionStorage.removeItem(CHAT_ID_KEY(repoId));
  } catch {
    /* non-fatal — see above */
  }
}

interface UserMsg {
  kind: 'user';
  text: string;
}
interface SeatMsg {
  kind: 'seat';
  cliKey: string;
  text: string;
  pending: boolean;
  ok: boolean;
}
type Msg = UserMsg | SeatMsg;

interface Props {
  repoId?: string | null;
  onBack: () => void;
}

export function GroupChat({ repoId, onBack }: Props): React.ReactElement {
  const [chatId, setChatId] = useState<string | null>(null);
  const [seats, setSeats] = useState<Record<string, SeatState>>({});
  const [seatErrors, setSeatErrors] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [openError, setOpenError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  /** An arm (warm) in flight — guards the two opt-in paths against double fire. */
  const [arming, setArming] = useState(false);
  /**
   * The rejoin probe is in flight — a stored id is being checked against the daemon.
   * While it is, this repo is NOT first-run and the opt-ins must wait: `chatId` is
   * still null, so a send in this window would read as a first send, mint a fresh id
   * and write it OVER the stored one — orphaning the warm chat the probe was about
   * to rejoin (the FINDING-027 leak, reintroduced by a fast finger on the focused
   * composer). Never true when nothing is stored, so first-run still fires zero
   * requests and gates nothing.
   */
  const [resolving, setResolving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef<string | null>(null);
  chatIdRef.current = chatId;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // The mount effect REJOINS — it never warms (§2.4 rule 1). Warming moved to
  // `armChat` below, which runs only on the two opt-ins (first send / Add agents).
  //
  // REJOIN, don't re-mint (FINDING-027). The pre-fix component called crypto.randomUUID() on every
  // fire, so each remount or repo switch abandoned a warm chat that nothing would ever close:
  // measured at ~520 MB of pinned CLI processes per orphan, one leaked deterministically per mount,
  // 19 seats warmed against 2 chats ever closed across a campaign. Closing on unmount would have
  // been the wrong fix — it deletes the "sessions outlive the page" feature this component exists
  // to provide. Instead the id is persisted per repo and the previous session is rejoined if the
  // daemon still holds it. This is deliberately agnostic to WHAT remounts us: any cause, including
  // a full page reload, lands on the same stored id.
  useEffect(() => {
    let cancelled = false;

    // `repoId` is a dep, so this effect also fires on a repo SWITCH with the component still
    // mounted. Everything below is per-chat, and none of it survives that switch: leaving the
    // previous repo's transcript on screen under a newly rejoined chat would misattribute it.
    setMessages([]);
    setSeats({});
    setSeatErrors({});
    setOpenError(null);
    setEnded(false);
    // The id goes too, and it is the one reset that is not cosmetic. Resolving the new repo's chat
    // is ASYNC — a stored id costs a probe round-trip — and until it lands, a `chatId` still holding
    // the PREVIOUS repo's chat is actively wrong in three places: the event-stream guard below would
    // accept that chat's frames and render them under this repo; `send` would post this repo's
    // message into it; and `endChat` would close it while clearing the NEW repo's stored key,
    // orphaning the old chat's seats behind an id nothing points at any more — the exact leak this
    // change exists to close. Null is the honest value for "which chat is this repo on": all three
    // already treat it as not-ready and wait.
    setChatId(null);
    chatIdRef.current = null;

    // A stored id is a claim, not a fact — the daemon reaps idle chats and enforces a pool cap,
    // so it may have reclaimed this one underneath us. Ask before trusting it. With nothing
    // stored, this is first-run: NO probe, NO roster fetch, NO warming — zero requests (§2.4).
    // Read SYNCHRONOUSLY, and park the opt-ins while the probe runs (see `resolving`).
    const stored = readStoredChatId(repoId);
    setResolving(stored !== null);

    void (async () => {
      if (stored === null) return;
      // Three distinct answers, and collapsing them is how the leak comes back. `chat_seats`
      // returns an empty list (a 200, not an error) for a chat the daemon no longer holds, so
      // ONLY that means reclaimed. A thrown error means we do not know — and "do not know" must
      // not forget the id, because forgetting on a transient 5xx orphans a chat that is still
      // warm and burns the one id that could have reached it.
      const probe = await api
        .getChat(stored)
        .then(({ seats }) => ({ seats }))
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      if (cancelled) return;

      if ('error' in probe) {
        setChatId(stored);
        chatIdRef.current = stored;
        setOpenError(
          `Could not reach the daemon to check the previous chat (${probe.error}). Keeping it — ` +
            `reload to retry, or Close to disconnect the agents.`,
        );
        setResolving(false);
        return;
      }
      if (probe.seats.length > 0) {
        setChatId(stored);
        chatIdRef.current = stored;
        // Warm seats only — the transcript is not persisted server-side, so a rejoined chat
        // starts with an empty log. The SESSIONS carry the conversation memory, which is the
        // expensive part; re-minting would have thrown that away as well as leaking it.
        setSeats(Object.fromEntries(probe.seats.map((k) => [k, 'ready' as SeatState])));
        setResolving(false);
        return;
      }
      // Reclaimed → back to the calm first-run state, not a re-mint: warming is the
      // user's call now, and the next opt-in mints fresh.
      clearStoredChatId(repoId);
      setResolving(false);
      // (On the cancelled path `resolving` is deliberately left alone: the next effect
      // run has already set its own value for the new repo.)
    })();

    return () => {
      cancelled = true;
    };
    // (The exhaustive-deps suppression that used to sit here is gone: the effect now closes over
    // nothing but `repoId` and module-scope helpers, so the dep list is genuinely complete.)
  }, [repoId]);

  useEventStream((ev) => {
    const frame = ev as { type: string; chat?: string; cliKey?: string; text?: string; ok?: boolean; reason?: string };
    if (frame.chat !== chatIdRef.current) return;
    switch (frame.type) {
      case 'chatSessionReady':
        if (frame.cliKey) setSeats((s) => ({ ...s, [frame.cliKey!]: 'ready' }));
        break;
      case 'chatSessionFailed':
        if (frame.cliKey) {
          setSeats((s) => ({ ...s, [frame.cliKey!]: 'failed' }));
          setSeatErrors((e) => ({ ...e, [frame.cliKey!]: frame.reason ?? 'session failed' }));
        }
        break;
      case 'chatDelta':
        if (frame.cliKey && frame.text) appendToPending(frame.cliKey, frame.text);
        break;
      case 'chatReply':
        if (frame.cliKey) finalizePending(frame.cliKey, frame.text ?? '', frame.ok ?? false);
        break;
      default:
        break;
    }
  });

  /** Deltas attach to the seat's LATEST pending bubble (one in-flight turn per seat). */
  function appendToPending(cliKey: string, text: string): void {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i];
        if (m && m.kind === 'seat' && m.cliKey === cliKey && m.pending) {
          next[i] = { ...m, text: m.text + text };
          return next;
        }
      }
      return prev;
    });
  }

  /** The terminal reply text is authoritative — it replaces accumulated deltas. */
  function finalizePending(cliKey: string, text: string, ok: boolean): void {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i];
        if (m && m.kind === 'seat' && m.cliKey === cliKey && m.pending) {
          next[i] = { kind: 'seat', cliKey, text, pending: false, ok };
          return next;
        }
      }
      return prev;
    });
  }

  /**
   * Warm seats — the §2.4 opt-in, and the ONLY place a chat is minted or opened.
   * `'one'` is the first send's path (the single default agent — the first
   * council-enabled roster seat); `'all'` is the "Add agents" disclosure (the
   * whole roster, exactly what the pre-slice-4 mount warmed). Reuses the live
   * chat id when there is one: `chat_open` ensures per seat, so warming MORE
   * seats into an existing chat reuses the warm ones and adds only the missing.
   * Returns the seat keys that came up ready.
   */
  async function armChat(scope: 'one' | 'all'): Promise<string[]> {
    setArming(true);
    try {
      // The chat id is minted CLIENT-side and set before the open call: seats warm
      // serially (~2-3s each), and their chatSessionReady events arrive BEFORE the
      // POST resolves — a server-minted id would drop every one of them.
      let id = chatIdRef.current;
      if (id === null) {
        id = crypto.randomUUID();
        setChatId(id);
        chatIdRef.current = id;
        writeStoredChatId(repoId, id);
      }
      const roster = await api
        .getRoster()
        .then(({ roster: r }) => r)
        .catch(() => []);
      // A repo switch mid-arm resets `chatIdRef` (the mount effect) — every await
      // below re-checks it so nothing is attributed to a repo we already left.
      if (chatIdRef.current !== id) return [];
      const keys = roster.flatMap((s) => (typeof s.key === 'string' ? [s.key] : []));
      const one = roster.find((s) => s.enabled_for_council)?.key ?? keys[0];
      const chosen = scope === 'one' ? (one !== undefined ? [one] : []) : keys;
      // Optimistic chips: each seat being warmed shows as warming while the open is in
      // flight; ready/failed events (and the open response) correct them as truth arrives.
      setSeats((prev) => ({
        ...prev,
        ...Object.fromEntries(
          chosen.filter((k) => prev[k] !== 'ready').map((k) => [k, 'warming' as SeatState]),
        ),
      }));
      try {
        const body: { chatId: string; repoRef?: string; clis?: string[] } = { chatId: id };
        if (repoId) body.repoRef = repoId;
        // 'all' omits `clis` on purpose — the daemon warms its own full roster, exactly
        // as the pre-slice-4 mount did. 'one' names the single default agent; with no
        // roster answer it also omits, and the daemon's roster decides.
        if (scope === 'one' && chosen.length > 0) body.clis = chosen;
        const { seats: opened } = await api.openChat(body);
        if (chatIdRef.current !== id) return [];
        const st: Record<string, SeatState> = {};
        const errs: Record<string, string> = {};
        for (const s of opened) {
          st[s.cliKey] = s.ok ? 'ready' : 'failed';
          if (!s.ok && s.error) errs[s.cliKey] = s.error;
        }
        setSeats((prev) => ({ ...prev, ...st }));
        setSeatErrors((prev) => ({ ...prev, ...errs }));
        return opened.filter((s) => s.ok).map((s) => s.cliKey);
      } catch (e: unknown) {
        // The id stays stored on purpose: an open that failed at the HTTP layer may still have
        // warmed seats server-side, and dropping the id here would orphan exactly what
        // FINDING-027 exists to stop orphaning. The next mount re-checks it and clears it if dead.
        if (chatIdRef.current === id) setOpenError(e instanceof Error ? e.message : String(e));
        return [];
      }
    } finally {
      setArming(false);
    }
  }

  async function send(): Promise<void> {
    const text = input.trim();
    // `resolving` waits out the rejoin probe: until it answers, "no chat id" does NOT
    // mean first-run, and treating it as one would mint over the stored id (FINDING-027).
    if (text === '' || ended || arming || resolving) return;
    const firstSend = chatIdRef.current === null;
    let warm = Object.entries(seats)
      .filter(([, st]) => st === 'ready')
      .map(([k]) => k);
    if (!firstSend && warm.length === 0) return;
    setInput('');
    setMessages((prev) => [...prev, { kind: 'user', text }]);
    if (firstSend) {
      // Typing IS the opt-in (§2.4): the first send warms the one default agent.
      warm = await armChat('one');
      if (warm.length === 0) return; // armChat surfaced why (openError / failed chip)
    }
    const id = chatIdRef.current;
    if (id === null) return; // repo switched under the send
    setMessages((prev) => [
      ...prev,
      ...warm.map((cliKey): SeatMsg => ({ kind: 'seat', cliKey, text: '', pending: true, ok: false })),
    ]);
    try {
      await api.sendChatMessage(id, text);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setMessages((prev) =>
        prev.map((m) => (m.kind === 'seat' && m.pending ? { ...m, pending: false, ok: false, text: `(send failed: ${err})` } : m)),
      );
    }
  }

  async function endChat(): Promise<void> {
    // Forget the id FIRST. If the DELETE fails we still must not rejoin a chat the operator has
    // ended — and the daemon's idle reaper will collect it either way. The reverse order would
    // leave a "live" id pointing at a chat the UI has already walked away from.
    clearStoredChatId(repoId);
    if (chatId !== null) {
      try {
        await api.closeChat(chatId);
      } catch {
        /* teardown is best-effort */
      }
    }
    setEnded(true);
    onBack();
  }

  const seatChip = (cliKey: string, st: SeatState): React.ReactElement => (
    // wk-disclose: the roster disclosure animates in at --dur-base ease-out
    // (§5.3 motion) — once per chip mount, never a loop (§1.6).
    <span
      key={cliKey}
      title={st === 'failed' ? seatErrors[cliKey] : st}
      className="wk-disclose inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-mono"
      style={{ background: SEAT_CHIP.bg, color: SEAT_CHIP.fg, opacity: st === 'failed' ? 0.5 : 1 }}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${st === 'warming' ? 'animate-pulse' : ''}`}
        style={{ background: SEAT_DOT[st] }}
      />
      {cliKey}
      {st === 'failed' ? ' ✕' : ''}
    </span>
  );

  const anyReady = Object.values(seats).some((st) => st === 'ready');
  // V8: a teardown control exists only once there is something armed to tear down —
  // warm agents, or a kept-on-error chat id the operator may want to disconnect.
  const closable = chatId !== null && (anyReady || openError !== null);
  // The ONE disclosure (§2.4): shown until the roster is warmed in (0 seats =
  // first-run, 1 seat = the single default agent the first send warmed).
  const showAddAgents = !ended && Object.keys(seats).length <= 1;
  // Not first-run while the rejoin probe is unresolved — teaching "nothing here yet"
  // over a chat that may be about to pop back in would be a lie held for milliseconds.
  const firstRun =
    messages.length === 0 && Object.keys(seats).length === 0 && openError === null && !resolving;

  return (
    // The surface's own ink (§2.4); labels read in the sans by inheritance —
    // only data (seat keys, narration) opts into the mono below (§2.8).
    <div className="flex flex-col h-full" style={{ color: 'var(--ink-body)', fontFamily: 'var(--font-sans)' }}>
      {/* Header: seats + close */}
      <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0" style={{ borderColor: 'var(--surface-raised)' }}>
        <button type="button" onClick={onBack} className="text-sm font-mono opacity-60 hover:opacity-100">←</button>
        <span className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Chat</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {Object.entries(seats).map(([k, st]) => seatChip(k, st))}
        </div>
        <div className="flex-1" />
        {closable && (
          <button
            type="button"
            data-testid="chat-close"
            title="Disconnect the agents and end this chat"
            onClick={() => void endChat()}
            className="text-[11px] px-2.5 py-1 rounded-lg"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)', border: '1px solid var(--surface-overlay)' }}
          >
            Close
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
        {openError !== null && (
          <p className="text-[12px] font-mono" style={{ color: 'var(--status-fail)' }}>Could not open chat: {openError}</p>
        )}
        {firstRun && (
          // §2.4: the first-run state TEACHES — what Chat is, what typing does, and the
          // product's central trick (choose a mode by conversation). Never a warmed roster.
          // §5.3: the instruction reads as prose — the sans, body ink.
          <div
            data-testid="chat-firstrun"
            className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8"
          >
            <p style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semi)', color: 'var(--ink-high)', fontFamily: 'var(--font-sans)', margin: 0 }}>
              Chat with an agent about this project.
            </p>
            <p data-testid="chat-firstrun-instruction" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-body)', fontFamily: 'var(--font-sans)', margin: 0, maxWidth: '480px' }}>
              No run, no gates — just talk. Ask for a deck or some code and I’ll switch
              you to the right mode.
            </p>
          </div>
        )}
        {messages.map((m, i) =>
          m.kind === 'user' ? (
            // §5.3 token usage: user messages are transparent — the hairline
            // keeps the bubble shape without claiming a surface of its own.
            <div
              key={i}
              className="self-end max-w-[70%] rounded-xl px-4 py-2 text-[13px]"
              style={{ background: 'transparent', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            >
              {m.text}
            </div>
          ) : (
            <div key={i} className="self-start max-w-[80%] flex gap-2">
              <span
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold mt-0.5"
                style={{ background: SEAT_CHIP.bg, color: SEAT_CHIP.fg }}
              >
                {m.cliKey.slice(0, 2).toUpperCase()}
              </span>
              <div
                // §5.3 token usage: agent bubbles sit on --surface-card; the
                // border speaks status while a reply is pending or failed.
                className="rounded-xl px-4 py-2 text-[13px] min-w-[60px]"
                style={{
                  background: 'var(--surface-card)',
                  border: `1px solid ${m.pending ? 'var(--status-run-dim)' : m.ok ? 'var(--surface-raised)' : 'var(--status-fail-dim)'}`,
                }}
              >
                {m.pending && m.text === '' ? (
                  <span className="opacity-50 font-mono text-[11px] animate-pulse">thinking…</span>
                ) : (
                  <Markdown>{m.text}</Markdown>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input — §5.3 token usage: the composer sits on --surface-raised at
          --radius-xl; its focus ring is --accent-dim (wk-composer in
          global.css), never the full accent (§5.3 motion: too dominant). */}
      <div className="px-6 py-3 border-t shrink-0" style={{ borderColor: 'var(--surface-raised)' }}>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            autoFocus
            placeholder="Describe what you want… (Enter to send, Shift+Enter for newline)"
            className="wk-composer flex-1 px-4 py-2 text-[13px] outline-none resize-none"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--surface-overlay)',
              borderRadius: 'var(--radius-xl)',
              color: 'var(--ink-high)',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <button
            type="button"
            onClick={() => void send()}
            // Before any chat exists, typing is how the first agent warms — so text alone
            // enables Send. Once a chat exists, sending needs a ready seat, as before.
            // (`resolving`: the stored chat is still being checked — not first-run yet.)
            disabled={input.trim() === '' || arming || resolving || (chatId !== null && !anyReady)}
            className="px-4 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderRadius: 'var(--radius-xl)' }}
          >
            Send
          </button>
        </div>
        {showAddAgents && (
          <button
            type="button"
            data-testid="add-agents"
            disabled={arming || resolving}
            title="Warm every agent on the roster into this chat — replies stream side by side"
            onClick={() => void armChat('all')}
            // §5.3: low-key but ON-ACCENT — color alone signals it's interactive.
            className="mt-2 text-[11px] px-1 py-1 disabled:opacity-40"
            style={{ background: 'transparent', color: 'var(--accent)', border: 'none', cursor: 'pointer' }}
          >
            + Add agents
          </button>
        )}
      </div>
    </div>
  );
}
