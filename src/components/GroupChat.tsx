import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project, RosterSeat } from '../api/types.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { getCachedRoster, setCachedRoster } from '../store/rosterCache.js';
import { Markdown } from './Markdown.js';
import { NewProjectModal } from './NewProjectModal.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';

/**
 * CHAT (crew#165 / core#134): warm persistent CLI sessions + fan-out.
 *
 * NOT a run — no council, no gates, no units. Each user message fans out to
 * every warm seat and the replies stream back side by side (`chatDelta` tokens,
 * `chatReply` terminal). Sessions hold conversation memory across turns; they
 * live until "Close" (or daemon shutdown) — leaving the page keeps them warm.
 *
 * NOTHING warms on mount (DES-UXFIX-001 §2.4, F6). First-run is a calm teaching
 * state: one line on what Chat is, a focused composer, and the DEFAULT agent
 * chips (DES-FEEDBACK-001 §6.2): the agents that WILL join, rendered
 * synchronously from the cached roster (never fetched on mount — §6.1's
 * reconciliation of "agents by default" with zero-requests-on-mount), each
 * removable for this run via its ✕, extendable via [+ Add] (the roster
 * picker — its fetch rides that user action). The first send warms exactly
 * the selected set. The warm-and-rejoin machinery (FINDING-027) is preserved
 * verbatim — it still runs on opt-in, not on mount: a stored chat the daemon
 * still holds is rejoined exactly as before, because warm seats someone paid
 * for must not be orphaned.
 */

/**
 * The hardcoded fallback default set (§6.2) — used ONLY when the roster cache
 * is empty (nothing has fetched the roster yet this session). These are the
 * ONLY hardcoded agent names in the agent layer; everything else comes from
 * the roster cache or user action.
 */
export const DEFAULT_CHAT_AGENTS = ['writer', 'reviewer', 'planner'];

/**
 * The default chip selection for a chat being created (§6.2): the cached
 * roster when the app has one (fetched at startup by the launch form, or by
 * any other roster consumer), else the hardcoded fallback trio. Synchronous
 * by construction — reading it can never fire a request.
 */
function defaultSelection(): string[] {
  const cached = getCachedRoster();
  return cached !== null && cached.length > 0
    ? cached.map((s) => s.key)
    : [...DEFAULT_CHAT_AGENTS];
}

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
  /**
   * The project shell's context (DES-FEEDBACK-001 §4.3/§5.1, slice B): when set,
   * the chat is FILED into this project at open time (`projectId` on the POST
   * body) with no switcher UI — the shell already IS the project context, and
   * resolving its display name would cost a mount request Chat must not make
   * (DES-UXFIX-001 §2.4). When absent, the create flow renders a ProjectSwitcher
   * defaulting to Unfiled (§5.2); its project list loads on the dropdown's first
   * OPEN — a user action — never on mount.
   */
  projectId?: string | null;
  /** App-level route navigation — needed only by the "+ New project" hand-off. */
  navigate?: (path: string) => void;
}

export function GroupChat({ repoId, onBack, projectId = null, navigate }: Props): React.ReactElement {
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

  // ── Default agent chips (DES-FEEDBACK-001 §6, slice C) ─────────────────────
  // The agents that will join on the first send: defaults (cached roster or
  // the fallback trio) + picker additions − ✕ removals. Per-run only, never
  // persisted (§6.2). Initialized synchronously — zero requests (§6.1).
  const [selectedAgents, setSelectedAgents] = useState<string[]>(defaultSelection);
  const selectedAgentsRef = useRef<string[]>(selectedAgents);
  selectedAgentsRef.current = selectedAgents;
  // [+ Add] opens the roster picker; ITS roster read is allowed to fetch —
  // opening the picker is a user action, not a mount (§2.4).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRoster, setPickerRoster] = useState<RosterSeat[]>(() => getCachedRoster() ?? []);
  const pickerAnchorRef = useRef<HTMLDivElement>(null);

  // ── Project binding (DES-FEEDBACK-001 §5, slice B) ─────────────────────────
  // `null` = Unfiled: no `projectId` key in the open body, the backend default.
  // The list loads on the dropdown's first OPEN (§2.4: zero requests on mount).
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const projectsRequested = useRef(false);
  const selectedProjectRef = useRef<string | null>(null);
  selectedProjectRef.current = selectedProjectId;

  function loadProjects(): void {
    if (projectsRequested.current) return;
    projectsRequested.current = true;
    api
      .listProjects()
      .then(({ projects: ps }) =>
        setProjects([...ps].sort((a, b) => b.updated_at - a.updated_at)))
      .catch(() => {
        projectsRequested.current = false; // transient — retry on the next open
      });
  }

  /** Toggle the roster picker; on first open with a cold cache, fetch (a user action — §2.4-safe). */
  function togglePicker(): void {
    const opening = !pickerOpen;
    setPickerOpen(opening);
    if (!opening) return;
    const cached = getCachedRoster();
    if (cached !== null) {
      setPickerRoster(cached);
      return;
    }
    api
      .getRoster()
      .then(({ roster }) => {
        setCachedRoster(roster);
        setPickerRoster(roster);
      })
      .catch(() => {
        /* transient — the picker shows its empty state; the next open retries */
      });
  }

  useEffect(() => {
    if (!pickerOpen) return;
    function onOutside(e: MouseEvent): void {
      if (pickerAnchorRef.current && !pickerAnchorRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [pickerOpen]);

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
    // The project selection belongs to the chat being CREATED — a repo switch
    // starts a new create flow, so the binding resets to Unfiled (§5.1).
    setSelectedProjectId(null);
    // So does the chip selection (§6.2: per-run, never persisted): the new
    // repo's create flow starts from the defaults again.
    setSelectedAgents(defaultSelection());
    setPickerOpen(false);
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
   * `agents` is the chip selection (DES-FEEDBACK-001 §6.2: defaults + picker
   * additions − ✕ removals) and goes into the open body's `clis` array exactly
   * as the pre-slice-C opt-in sent it — the wire shape is unchanged. No roster
   * fetch here any more: the selection IS the answer (§6.1). Reuses the live
   * chat id when there is one: `chat_open` ensures per seat, so warming MORE
   * seats into an existing chat reuses the warm ones and adds only the missing.
   * Returns the seat keys that came up ready.
   */
  async function armChat(agents: string[]): Promise<string[]> {
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
      // Optimistic chips: each seat being warmed shows as warming while the open is in
      // flight; ready/failed events (and the open response) correct them as truth arrives.
      setSeats((prev) => ({
        ...prev,
        ...Object.fromEntries(
          agents.filter((k) => prev[k] !== 'ready').map((k) => [k, 'warming' as SeatState]),
        ),
      }));
      try {
        const body: { chatId: string; repoRef?: string; clis?: string[]; projectId?: string } = { chatId: id };
        if (repoId) body.repoRef = repoId;
        // §5.1/§4.3: the binding rides the OPEN — shell context wins, then the
        // switcher's selection; Unfiled omits the key (the backend default).
        const boundProject = projectId ?? selectedProjectRef.current;
        if (boundProject) body.projectId = boundProject;
        // An empty selection omits `clis` — the daemon warms its own default
        // roster (the pre-existing wire semantics for an absent array).
        if (agents.length > 0) body.clis = agents;
        const { seats: opened } = await api.openChat(body);
        // A repo switch mid-arm resets `chatIdRef` (the mount effect) — re-check
        // after the await so nothing is attributed to a repo we already left.
        if (chatIdRef.current !== id) return [];
        const st: Record<string, SeatState> = {};
        const errs: Record<string, string> = {};
        for (const s of opened) {
          st[s.cliKey] = s.ok ? 'ready' : 'failed';
          if (!s.ok && s.error) errs[s.cliKey] = s.error;
        }
        setSeats((prev) => ({ ...prev, ...st }));
        setSeatErrors((prev) => ({ ...prev, ...errs }));
        const ready = opened.filter((s) => s.ok).map((s) => s.cliKey);
        // §6.2 recoverable error: a default chip may name an agent the daemon no
        // longer has (stale cache or a fallback name with no seat behind it).
        // When NOTHING came up, say WHICH names were rejected — the chips bar is
        // back on screen (no seat is ready), so the user can remove the stale
        // chip and send again; the retry re-arms into the same chat id.
        if (ready.length === 0 && opened.length > 0) {
          const rejected = opened.map((s) => `"${s.cliKey}"`).join(', ');
          setOpenError(
            `The daemon rejected agent${opened.length > 1 ? 's' : ''} ${rejected} — ` +
              `remove the stale chip${opened.length > 1 ? 's' : ''} (✕) and send again.`,
          );
        }
        return ready;
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
    let warm = Object.entries(seats)
      .filter(([, st]) => st === 'ready')
      .map(([k]) => k);
    // Nothing ready with nothing selected: nobody would receive this (§6.2's
    // selection is the send's audience) — the disabled Send already says so.
    if (warm.length === 0 && chatIdRef.current === null && selectedAgentsRef.current.length === 0) return;
    setInput('');
    setMessages((prev) => [...prev, { kind: 'user', text }]);
    if (warm.length === 0) {
      // Typing IS the opt-in (§2.4): the first send warms the SELECTED agents —
      // the §6.2 chips (defaults + additions − removals). Also the retry path
      // after a rejected open (stale default chip): the re-arm reuses the same
      // chat id with the corrected selection, so recovery is just "send again".
      warm = await armChat(selectedAgentsRef.current);
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
  // The §6.2 default chips: shown while the send's audience is still the chip
  // SELECTION — before anything is warm (and not mid-arm, when the header's
  // warming seat chips take over, nor mid-probe, when this may not be first-run
  // at all). After a fully rejected open the bar returns: no seat is ready, and
  // removing the stale chip + sending again is the §6.2 recovery path.
  const showChipsBar = !ended && !resolving && !arming && !anyReady;
  // Not first-run while the rejoin probe is unresolved — teaching "nothing here yet"
  // over a chat that may be about to pop back in would be a lie held for milliseconds.
  const firstRun =
    messages.length === 0 && Object.keys(seats).length === 0 && openError === null && !resolving;
  // The create-flow project field (§5.2) shows only while the chat is still being
  // CREATED (binding happens at open time) and only outside the project shell —
  // in the shell the context IS the project (§4.3) and rides `projectId` silently.
  const showProjectField = projectId == null && chatId === null && !resolving && !ended;
  const currentProject = projects.find((p) => p.id === selectedProjectId) ?? null;

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
        {/* §5.2: the project field sits ABOVE the intent input, Unfiled default. */}
        {showProjectField && (
          <div className="flex items-center gap-2 pb-2" data-testid="chat-project-row">
            <span
              className="text-[10px] font-mono uppercase tracking-widest"
              style={{ color: 'var(--ink-dim)' }}
            >
              Project
            </span>
            <ProjectSwitcher
              current={currentProject}
              projects={projects}
              onSelect={setSelectedProjectId}
              onNewProject={() => setShowNewProject(true)}
              onOpen={loadProjects}
              dropUp
            />
          </div>
        )}
        {showNewProject && (
          <NewProjectModal
            navigate={navigate ?? ((): void => undefined)}
            onClose={() => setShowNewProject(false)}
          />
        )}
        {/* §6.2/§6.3: the default agent chips — the agents that WILL join the
            first send. Rendered from the cached roster / fallback constant,
            never a fetch (§6.1). Each chip is an agent that IS included; the
            ✕ removes it for THIS run only. [+ Add] is the separate affordance
            (dashed vs solid, --ink-dim vs --ink-body) opening the roster
            picker. Chip text reads in the SANS (EC13: labels in sans — these
            are selection labels, not narration data). */}
        {showChipsBar && (
          <div
            data-testid="agent-chips-bar"
            data-count={selectedAgents.length}
            className="flex items-center gap-1.5 flex-wrap pb-2"
          >
            {selectedAgents.map((key) => (
              <span
                key={key}
                data-testid="agent-chip"
                data-agent={key}
                className="wk-disclose inline-flex items-center gap-1"
                style={{
                  background: 'var(--surface-raised)',
                  // §6.2 writes `border: 1px solid rgba(255,255,255,0.08)` literally;
                  // that raw color would fail the §2.11 no-raw-color lint (ERROR), so
                  // the hairline rides the token that carries that role one step above
                  // a raised surface — --surface-overlay — exactly as the composer and
                  // the Close pill already draw theirs.
                  border: '1px solid var(--surface-overlay)',
                  borderRadius: 'var(--radius-full)',
                  color: 'var(--ink-body)',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-sans)',
                  padding: '3px 8px 3px 6px',
                }}
              >
                <button
                  type="button"
                  aria-label={`Remove ${key}`}
                  title={`Remove ${key} from this chat`}
                  onClick={() => setSelectedAgents((prev) => prev.filter((a) => a !== key))}
                  // §6.3: 12×12, transparent, --ink-dim → --ink-high on hover
                  // (the wk-chip-x pair in global.css — hover needs CSS).
                  className="wk-chip-x inline-flex items-center justify-center leading-none"
                  style={{ width: '12px', height: '12px', background: 'transparent', border: 'none', padding: 0, fontSize: 'var(--text-2xs)', cursor: 'pointer' }}
                >
                  ✕
                </button>
                {key}
              </span>
            ))}
            <div ref={pickerAnchorRef} className="relative inline-block">
              <button
                type="button"
                data-testid="add-agent"
                aria-haspopup="listbox"
                aria-expanded={pickerOpen}
                title="Add an agent from the roster to this chat"
                onClick={togglePicker}
                className="inline-flex items-center"
                style={{
                  background: 'transparent',
                  border: '1px dashed var(--surface-overlay)',
                  borderRadius: 'var(--radius-full)',
                  color: 'var(--ink-dim)',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-sans)',
                  padding: '3px 8px',
                  cursor: 'pointer',
                }}
              >
                + Add
              </button>
              {pickerOpen && (
                <div
                  role="listbox"
                  data-testid="agent-picker"
                  className="absolute left-0 bottom-full mb-1 w-48 rounded-lg py-1 z-50 max-h-64 overflow-y-auto"
                  style={{
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--surface-overlay)',
                    boxShadow: 'var(--shadow-raised)',
                  }}
                >
                  {pickerRoster.length === 0 ? (
                    <p className="px-3 py-1.5 text-xs font-mono italic m-0" style={{ color: 'var(--ink-dim)' }}>
                      No roster loaded
                    </p>
                  ) : (
                    pickerRoster.map((seat) => {
                      const included = selectedAgents.includes(seat.key);
                      return (
                        <button
                          key={seat.key}
                          type="button"
                          role="option"
                          aria-selected={included}
                          disabled={included}
                          data-testid="agent-picker-option"
                          data-agent-key={seat.key}
                          onClick={() => {
                            setSelectedAgents((prev) => (prev.includes(seat.key) ? prev : [...prev, seat.key]));
                            setPickerOpen(false);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors hover:bg-surface-card disabled:opacity-40"
                          style={{ color: included ? 'var(--ink-dim)' : 'var(--ink-body)' }}
                        >
                          {seat.key}
                          {included ? ' ✓' : ''}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}
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
            // Typing is how the selected agents warm — so text alone enables Send,
            // including the §6.2 retry after a rejected open (send re-arms). The
            // holds: `resolving` (the stored chat is still being probed — not
            // first-run yet), `arming` (an open is in flight), and an EMPTY chip
            // selection with nothing warm (nobody would receive the message).
            disabled={input.trim() === '' || arming || resolving || (showChipsBar && selectedAgents.length === 0)}
            className="px-4 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderRadius: 'var(--radius-xl)' }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
