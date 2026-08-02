import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { Markdown } from './Markdown.js';

/**
 * GROUP CHAT (crew#165 / core#134): warm persistent CLI sessions + fan-out.
 *
 * NOT a run — no council, no gates, no units. On mount the daemon warms one ACP
 * session per roster seat; each user message fans out to every warm seat and the
 * replies stream back side by side (`chatDelta` tokens, `chatReply` terminal).
 * Sessions hold conversation memory across turns; they live until "End chat"
 * (or daemon shutdown) — leaving the page keeps them warm.
 */

const SEAT_COLORS: Record<string, { bg: string; fg: string }> = {
  claude: { bg: 'rgba(139,92,246,0.25)', fg: '#c4b5fd' },
  codex: { bg: 'rgba(59,130,246,0.25)', fg: '#93c5fd' },
  agy: { bg: 'rgba(34,197,94,0.2)', fg: '#86efac' },
  pi: { bg: 'rgba(234,179,8,0.2)', fg: '#fde68a' },
};
const SEAT_FALLBACK = { bg: 'rgba(230,237,243,0.1)', fg: 'rgba(230,237,243,0.55)' };

type SeatState = 'warming' | 'ready' | 'failed';

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef<string | null>(null);
  chatIdRef.current = chatId;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Open once on mount; sessions OUTLIVE the page (explicit End chat closes them).
  // The chat id is minted CLIENT-side and set before the open call: seats warm
  // serially (~2-3s each), and their chatSessionReady events arrive BEFORE the
  // POST resolves — a server-minted id would drop every one of them.
  //
  // REJOIN, don't re-mint (FINDING-027). This effect used to call crypto.randomUUID() on every
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

    // Started now so the network round-trip overlaps the probe below, but APPLIED only on the mint
    // path. Optimistic chips are a stand-in for an open that is in flight; after a rejoin there is
    // no open and no incoming seat events, so a roster seat that is not warm in the rejoined chat
    // would sit at `warming` forever with nothing left to correct it.
    const rosterP = api
      .getRoster()
      .then(({ roster }) => roster)
      .catch(() => []);

    void (async () => {
      // A stored id is a claim, not a fact — the daemon reaps idle chats and enforces a pool cap,
      // so it may have reclaimed this one underneath us. Ask before trusting it.
      const stored = readStoredChatId(repoId);
      if (stored !== null) {
        // Three distinct answers, and collapsing them is how the leak comes back. `chat_seats`
        // returns an empty list (a 200, not an error) for a chat the daemon no longer holds, so
        // ONLY that means reclaimed. A thrown error means we do not know — and "do not know" must
        // not mint, because minting on a transient 5xx orphans a chat that is still warm and burns
        // the one id that could have reached it.
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
              `reload to retry, or End chat to release its seats.`,
          );
          return;
        }
        if (probe.seats.length > 0) {
          setChatId(stored);
          chatIdRef.current = stored;
          // Warm seats only — the transcript is not persisted server-side, so a rejoined chat
          // starts with an empty log. The SESSIONS carry the conversation memory, which is the
          // expensive part; re-minting would have thrown that away as well as leaking it.
          setSeats(Object.fromEntries(probe.seats.map((k) => [k, 'ready' as SeatState])));
          return;
        }
        clearStoredChatId(repoId);
      }

      const id = crypto.randomUUID();
      if (cancelled) return;
      setChatId(id);
      chatIdRef.current = id;
      writeStoredChatId(repoId, id);

      // Optimistic chips: every enabled roster seat shows as warming while the open is in flight;
      // ready/failed events (and the open response) correct them as truth arrives.
      const roster = await rosterP;
      if (cancelled) return;
      setSeats(
        Object.fromEntries(
          roster.flatMap((seat) =>
            typeof seat.key === 'string' ? [[seat.key, 'warming' as SeatState]] : [],
          ),
        ),
      );

      try {
        const { seats } = await api.openChat(repoId ? { chatId: id, repoRef: repoId } : { chatId: id });
        if (cancelled) return;
        const st: Record<string, SeatState> = {};
        const errs: Record<string, string> = {};
        for (const s of seats) {
          st[s.cliKey] = s.ok ? 'ready' : 'failed';
          if (!s.ok && s.error) errs[s.cliKey] = s.error;
        }
        setSeats(st);
        setSeatErrors(errs);
      } catch (e: unknown) {
        // The id stays stored on purpose: an open that failed at the HTTP layer may still have
        // warmed seats server-side, and dropping the id here would orphan exactly what this
        // change exists to stop orphaning. The next mount re-checks it and clears it if dead.
        if (!cancelled) setOpenError(e instanceof Error ? e.message : String(e));
      }
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

  async function send(): Promise<void> {
    const text = input.trim();
    const anyReady = Object.values(seats).some((st) => st === 'ready');
    if (text === '' || chatId === null || ended || !anyReady) return;
    setInput('');
    const warm = Object.entries(seats)
      .filter(([, st]) => st === 'ready')
      .map(([k]) => k);
    setMessages((prev) => [
      ...prev,
      { kind: 'user', text },
      ...warm.map((cliKey): SeatMsg => ({ kind: 'seat', cliKey, text: '', pending: true, ok: false })),
    ]);
    try {
      await api.sendChatMessage(chatId, text);
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

  const seatChip = (cliKey: string, st: SeatState): React.ReactElement => {
    const c = SEAT_COLORS[cliKey] ?? SEAT_FALLBACK;
    return (
      <span
        key={cliKey}
        title={st === 'failed' ? seatErrors[cliKey] : st}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-mono"
        style={{ background: c.bg, color: c.fg, opacity: st === 'failed' ? 0.5 : 1 }}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${st === 'warming' ? 'animate-pulse' : ''}`}
          style={{ background: st === 'failed' ? '#f85149' : st === 'warming' ? '#d29922' : '#3fb950' }}
        />
        {cliKey}
        {st === 'failed' ? ' ✕' : ''}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full" style={{ color: '#e6edf3' }}>
      {/* Header: seats + end */}
      <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0" style={{ borderColor: 'rgba(230,237,243,0.08)' }}>
        <button type="button" onClick={onBack} className="text-sm font-mono opacity-60 hover:opacity-100">←</button>
        <span className="text-sm font-mono font-semibold">Group chat</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {Object.entries(seats).map(([k, st]) => seatChip(k, st))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void endChat()}
          className="text-[11px] font-mono px-2.5 py-1 rounded-lg"
          style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149', border: '1px solid rgba(248,81,73,0.25)' }}
        >
          End chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
        {openError !== null && (
          <p className="text-[12px] font-mono" style={{ color: '#f85149' }}>Could not open chat: {openError}</p>
        )}
        {Object.keys(seats).length === 0 && openError === null && (
          <p className="text-[12px] font-mono opacity-60">Warming seats…</p>
        )}
        {messages.map((m, i) =>
          m.kind === 'user' ? (
            <div key={i} className="self-end max-w-[70%] rounded-xl px-4 py-2 text-[13px]" style={{ background: 'rgba(88,166,255,0.15)' }}>
              {m.text}
            </div>
          ) : (
            <div key={i} className="self-start max-w-[80%] flex gap-2">
              <span
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold mt-0.5"
                style={{ background: (SEAT_COLORS[m.cliKey] ?? SEAT_FALLBACK).bg, color: (SEAT_COLORS[m.cliKey] ?? SEAT_FALLBACK).fg }}
              >
                {m.cliKey.slice(0, 2).toUpperCase()}
              </span>
              <div
                className="rounded-xl px-4 py-2 text-[13px] min-w-[60px]"
                style={{
                  background: 'rgba(230,237,243,0.05)',
                  border: `1px solid ${m.pending ? 'rgba(210,153,34,0.35)' : m.ok ? 'rgba(230,237,243,0.08)' : 'rgba(248,81,73,0.35)'}`,
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

      {/* Input */}
      <div className="px-6 py-3 border-t shrink-0" style={{ borderColor: 'rgba(230,237,243,0.08)' }}>
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
            placeholder="Message every warm seat… (Enter to send, Shift+Enter for newline)"
            className="flex-1 rounded-xl px-4 py-2 text-[13px] font-mono outline-none resize-none"
            style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.12)' }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!Object.values(seats).some((st) => st === 'ready') || input.trim() === ''}
            className="px-4 rounded-xl text-sm font-mono font-semibold disabled:opacity-40"
            style={{ background: 'rgba(88,166,255,0.2)', color: '#79c0ff' }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
