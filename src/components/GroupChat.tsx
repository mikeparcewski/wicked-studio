import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project, RosterSeat } from '../api/types.js';
import { useEventStream } from '../hooks/useEventStream.js';
import { getCachedRoster, setCachedRoster, subscribeRoster } from '../store/rosterCache.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
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

/**
 * The explicit seat lifecycle (DES-UX-001 §7.9-4, EC44): connecting (an open
 * in flight) → ready (the seat answered ok) → working (a reply is pending) →
 * replied (its turn finished) — and failed-with-reason, whose reason is the
 * daemon's own open-time answer (`POST /chats` per-seat `error`) or a
 * `chatSessionFailed` frame's reason. The wire carries NO per-seat mid-stream
 * lifecycle (BRIDGE-UX-1 probe 4: seat identity is absent from the interactive
 * vocabulary), so mid-stream failure reasons beyond those two wires are not
 * invented here — the state machine ships, the reasons stay honest.
 */
type SeatState = 'connecting' | 'ready' | 'working' | 'replied' | 'failed';

/** States in which the seat can receive a message (warm on the daemon). */
const WARM_STATES: ReadonlySet<SeatState> = new Set(['ready', 'working', 'replied']);

const SEAT_DOT: Record<SeatState, string> = {
  connecting: 'var(--status-gate)',
  ready: 'var(--status-run)',
  working: 'var(--status-gate)',
  replied: 'var(--status-run)',
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

export interface UserMsg {
  kind: 'user';
  text: string;
  /** The send ordinal this message opened (1-based) — §7.9-3 turn identity. */
  turn?: number;
}
export interface SeatMsg {
  kind: 'seat';
  cliKey: string;
  text: string;
  pending: boolean;
  ok: boolean;
  /** The send ordinal this reply answers — chunk routing keys on seat+turn. */
  turn?: number;
}
export type Msg = UserMsg | SeatMsg;

// ── Chat layout: list vs columns (DES-FEEDBACK-002 §6, slice K) ──────────────
//
// A round = a user message plus every seat message before the next user message
// (§6.1: the flat `messages` array already groups naturally — a send appends one
// UserMsg then N pending SeatMsgs that fill in place). Columns mode re-renders
// each round as a grid; the grouping below is PURE derivation over transcript
// state — it can never fire a request (§6.3: the toggle reads and re-arranges
// `messages` only).

export type ChatLayout = 'list' | 'columns';

export interface ChatRound {
  user: UserMsg | null;
  seats: SeatMsg[];
}

/** §6.1's grouping rule: a new round starts at each user message; replies to
 *  DIFFERENT prompts (non-siblings) land in different rounds and stay linear —
 *  only same-round (same-prompt) replies ever sit side by side. */
export function groupRounds(messages: Msg[]): ChatRound[] {
  const rounds: ChatRound[] = [];
  for (const m of messages) {
    if (m.kind === 'user') {
      rounds.push({ user: m, seats: [] });
    } else {
      let last = rounds[rounds.length - 1];
      if (last === undefined) {
        // Defensive: a seat message with no user message before it (cannot
        // happen via `send`, but the grouping must not throw on it).
        last = { user: null, seats: [] };
        rounds.push(last);
      }
      last.seats.push(m);
    }
  }
  return rounds;
}

/** §6.2: column order is stable across rounds — first-seen seat order — so the
 *  same agent is always in the same column. */
export function seatColumnOrder(messages: Msg[]): string[] {
  const order: string[] = [];
  for (const m of messages) {
    if (m.kind === 'seat' && !order.includes(m.cliKey)) order.push(m.cliKey);
  }
  return order;
}

/** §6.2: the choice persists per-session — a reading posture, not configuration,
 *  so it is deliberately NOT a crew setting (a settings write would violate the
 *  surface's request frugality). sessionStorage, wrapped like the chat id above:
 *  private-mode browsers degrade to per-mount state, never to a broken surface. */
const CHAT_LAYOUT_KEY = 'wicked.chat.layout';
function readStoredLayout(): ChatLayout {
  try {
    return sessionStorage.getItem(CHAT_LAYOUT_KEY) === 'columns' ? 'columns' : 'list';
  } catch {
    return 'list';
  }
}
function writeStoredLayout(layout: ChatLayout): void {
  try {
    sessionStorage.setItem(CHAT_LAYOUT_KEY, layout);
  } catch {
    /* non-fatal — see readStoredChatId */
  }
}

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
  /** App-level route navigation — the "+ New project" hand-off and the J4
   *  URL reflection (which replaces, so Back never walks through /chat/new). */
  navigate?: (path: string, opts?: { replace?: boolean }) => void;
  /**
   * The chat session id the URL names (`/chat/:id`, J4/C6) — the surface
   * REJOINS it if the daemon still holds it, and says honestly that it is
   * gone if not. `null` on `/chat/new` and in the project shell.
   */
  routedChatId?: string | null;
  /**
   * When true (the flat `/chat/*` routes) the live session's id is reflected
   * into the URL the moment it exists — mint, rejoin, or routed — so the
   * session is findable again after navigating away (J4/C6). The project
   * shell passes false: its chat lives at `/p/:pid/chat`.
   */
  reflectUrl?: boolean;
}

export function GroupChat({
  repoId, onBack, projectId = null, navigate, routedChatId = null, reflectUrl = false,
}: Props): React.ReactElement {
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
  /**
   * The client REJOINED a live session it did not open on this mount (J4/C6).
   * The wire keeps no transcript (`GET /chats/:id` answers seats only), so a
   * rejoined thread starts empty CLIENT-side — the boundary is stated in the
   * thread, never a silent blank pretending nothing was said.
   */
  const [rejoined, setRejoined] = useState(false);
  /**
   * The URL named a session (`/chat/:id`) the daemon no longer holds (J4/C6):
   * the pool reaped it or it was ended. Rendered as an honest boundary — the
   * transcript is not persisted beyond the live session, so there is nothing
   * to replay; a send starts a NEW session (and the URL follows it).
   */
  const [routedGone, setRoutedGone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatIdRef = useRef<string | null>(null);
  chatIdRef.current = chatId;

  // ── Transcript layout (DES-FEEDBACK-002 §6, slice K) ────────────────────────
  // List is the default; columns re-arranges rounds side by side. Initialized
  // synchronously from sessionStorage — reading it can never fire a request, and
  // switching it touches nothing but how `messages` is rendered (§6.3).
  const [layout, setLayout] = useState<ChatLayout>(readStoredLayout);
  function chooseLayout(next: ChatLayout): void {
    setLayout(next);
    writeStoredLayout(next);
  }

  // ── Default agent chips (DES-FEEDBACK-001 §6, slice C) ─────────────────────
  // The agents that will join on the first send: defaults (cached roster or
  // the fallback trio) + picker additions − ✕ removals. Per-run only, never
  // persisted (§6.2). Initialized synchronously — zero requests (§6.1).
  const [selectedAgents, setSelectedAgents] = useState<string[]>(defaultSelection);
  const selectedAgentsRef = useRef<string[]>(selectedAgents);
  selectedAgentsRef.current = selectedAgents;
  // §7.9-1: whether the operator has EDITED the selection (✕ / picker add).
  // While untouched, a warm roster arriving later re-seeds the chips — the
  // fallback trio only ever reaches the daemon when the cache stayed cold AND
  // the roster proved unreachable at send time. An edit pins the selection.
  const chipsTouchedRef = useRef(false);
  // §7.9-2: a failed send keeps its draft; the failure renders inline with retry.
  const [sendFailed, setSendFailed] = useState<{ text: string; reason: string } | null>(null);
  // §7.9-3: the send ordinal — every bubble is stamped with the turn it belongs to.
  const turnRef = useRef(0);
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
    // J4: `routedChatId` is a dep too, and its one same-mount transition is the
    // URL reflection THIS component issued after minting or rejoining — the
    // state already IS that chat's, and a reset here would wipe the live
    // transcript mid-conversation. Skip exactly that case.
    if (routedChatId !== null && routedChatId === chatIdRef.current) return;
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
    chipsTouchedRef.current = false;
    setSendFailed(null);
    turnRef.current = 0;
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
    setRejoined(false);
    setRoutedGone(false);

    // A stored id is a claim, not a fact — the daemon reaps idle chats and enforces a pool cap,
    // so it may have reclaimed this one underneath us. Ask before trusting it. With nothing
    // stored, this is first-run: NO probe, NO roster fetch, NO warming — zero requests (§2.4).
    // Read SYNCHRONOUSLY, and park the opt-ins while the probe runs (see `resolving`).
    // J4: a URL-routed id WINS over the per-repo stored id — the operator asked
    // for THAT session by address; the stored id is only the tab's memory.
    const stored = routedChatId ?? readStoredChatId(repoId);
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
        // A routed rejoin becomes THIS tab's session for the repo too — /chats
        // → row → send → navigate away → back must land on the same session.
        writeStoredChatId(repoId, stored);
        // Warm seats only — the transcript is not persisted server-side, so a rejoined chat
        // starts with an empty log. The SESSIONS carry the conversation memory, which is the
        // expensive part; re-minting would have thrown that away as well as leaking it.
        // J4/C6: that boundary is STATED in the thread (`rejoined`), never a
        // silent blank pretending the conversation never happened.
        setSeats(Object.fromEntries(probe.seats.map((k) => [k, 'ready' as SeatState])));
        setRejoined(true);
        setResolving(false);
        return;
      }
      // Reclaimed → the id is dead. On `/chat/new` this lands on the calm
      // first-run state; on a routed `/chat/:id` (J4) the page SAYS the session
      // ended (`routedGone`) — the honest boundary, never a wordless empty.
      // Either way warming stays the user's call and the next opt-in mints fresh.
      if (routedChatId !== null) setRoutedGone(true);
      if (readStoredChatId(repoId) === stored) clearStoredChatId(repoId);
      setResolving(false);
      // (On the cancelled path `resolving` is deliberately left alone: the next effect
      // run has already set its own value for the new repo.)
    })();

    return () => {
      cancelled = true;
    };
    // (The exhaustive-deps suppression that used to sit here is gone: the effect closes over
    // nothing but `repoId`/`routedChatId` and module-scope helpers — the list is complete.)
  }, [repoId, routedChatId]);

  // J4/C6 — the URL names the session the moment it exists. Mint, rejoin, or
  // routed: on the flat chat routes the live id is REFLECTED into `/chat/:id`
  // (replace, so Back never re-enters the transient /chat/new), making the
  // session revisitable for its lifetime — from /chats, a bookmark, or Back.
  useEffect(() => {
    if (!reflectUrl || navigate === undefined || chatId === null) return;
    if (routedChatId === chatId) return; // the URL already says so
    navigate(`/chat/${encodeURIComponent(chatId)}`, { replace: true });
  }, [reflectUrl, navigate, chatId, routedChatId]);

  // §7.9-1 (the seeding-order fix): a roster deposited AFTER this surface
  // seeded its chips from the cold-cache fallback re-seeds them — warm roster
  // beats the fallback trio — but only while the selection is still pristine
  // (untouched, nothing warmed, no thread). Never a fetch: this only HEARS
  // deposits other surfaces already paid for (§2.4's budget holds unchanged).
  useEffect(() => {
    return subscribeRoster((roster) => {
      if (chipsTouchedRef.current || chatIdRef.current !== null) return;
      if (roster.length === 0) return;
      setSelectedAgents(roster.map((s) => s.key));
    });
  }, []);

  useEventStream((ev) => {
    const frame = ev as { type: string; chat?: string; cliKey?: string; text?: string; ok?: boolean; reason?: string };
    if (frame.chat !== chatIdRef.current) return;
    switch (frame.type) {
      case 'chatSessionReady':
        // Never demote a working seat: its warm-up ready can arrive after the
        // first fan-out already put a reply in flight.
        if (frame.cliKey) {
          setSeats((s) => (s[frame.cliKey!] === 'working' ? s : { ...s, [frame.cliKey!]: 'ready' }));
        }
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
        if (frame.cliKey) {
          finalizePending(frame.cliKey, frame.text ?? '', frame.ok ?? false);
          setSeats((s) => (s[frame.cliKey!] === 'failed' ? s : { ...s, [frame.cliKey!]: 'replied' }));
        }
        break;
      default:
        break;
    }
  });

  /**
   * §7.9-3 chunk routing: a seat's frames belong to its OLDEST unfinished
   * turn — the wire carries no turn field (chatDelta is {chat, cliKey, text}),
   * and a warm seat answers its queue in send order, so per-seat FIFO IS the
   * turn correlation. The pre-slice-AB code walked backward (newest pending),
   * which spliced a still-streaming turn's chunks into the NEXT turn's bubble
   * the moment a second send appended its pending row — the mid-word splice
   * the review observed. A chunk with no pending bubble opens its own (text
   * is never silently dropped).
   */
  function appendToPending(cliKey: string, text: string): void {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i++) {
        const m = next[i];
        if (m && m.kind === 'seat' && m.cliKey === cliKey && m.pending) {
          next[i] = { ...m, text: m.text + text };
          return next;
        }
      }
      next.push({ kind: 'seat', cliKey, text, pending: true, ok: false, turn: turnRef.current });
      return next;
    });
  }

  /** The terminal reply text is authoritative — it replaces the accumulated
   *  deltas of the seat's OLDEST pending turn (the same FIFO as the chunks). */
  function finalizePending(cliKey: string, text: string, ok: boolean): void {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i++) {
        const m = next[i];
        if (m && m.kind === 'seat' && m.cliKey === cliKey && m.pending) {
          next[i] = { ...m, text, pending: false, ok };
          return next;
        }
      }
      next.push({ kind: 'seat', cliKey, text, pending: false, ok, turn: turnRef.current });
      return next;
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
      // Optimistic chips: each seat being warmed shows as connecting while the open is
      // in flight; ready/failed events (and the open response) correct them as truth arrives.
      setSeats((prev) => ({
        ...prev,
        ...Object.fromEntries(
          agents
            .filter((k) => !WARM_STATES.has(prev[k] ?? 'failed'))
            .map((k) => [k, 'connecting' as SeatState]),
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

  /** One send in flight at a time — Enter held down must not double-post the draft
   *  (the draft now stays in the composer until the daemon ACCEPTS it, §7.9-2). */
  const sendingRef = useRef(false);

  async function send(retryText?: string): Promise<void> {
    const text = (retryText ?? input).trim();
    // `resolving` waits out the rejoin probe: until it answers, "no chat id" does NOT
    // mean first-run, and treating it as one would mint over the stored id (FINDING-027).
    if (text === '' || ended || arming || resolving || sendingRef.current) return;
    let warm = Object.entries(seats)
      .filter(([, st]) => WARM_STATES.has(st))
      .map(([k]) => k);
    // Nothing warm with nothing selected: nobody would receive this (§6.2's
    // selection is the send's audience) — the disabled Send already says so.
    if (warm.length === 0 && chatIdRef.current === null && selectedAgentsRef.current.length === 0) return;
    sendingRef.current = true;
    setSendFailed(null);
    try {
      // §7.9-1 roster-first: a first send from a PRISTINE fallback selection with a
      // still-cold cache fetches the roster ON THIS GESTURE (never on mount — §2.4
      // holds) so the send names seats the daemon accepts. The fallback trio goes
      // to the daemon only when the roster is genuinely unreachable.
      if (warm.length === 0 && chatIdRef.current === null && !chipsTouchedRef.current
        && getCachedRoster() === null) {
        try {
          const { roster } = await api.getRoster();
          setCachedRoster(roster);
          if (roster.length > 0) {
            const keys = roster.map((s) => s.key);
            setSelectedAgents(keys);
            selectedAgentsRef.current = keys;
          }
        } catch {
          /* roster unreachable — the trio is the honest audience (§7.9-1) */
        }
      }
      const turn = turnRef.current + 1;
      turnRef.current = turn;
      setMessages((prev) => [...prev, { kind: 'user', text, turn }]);
      // §7.9-2: a failed send retracts its optimistic bubbles (nothing went out),
      // keeps the draft in the composer, and renders the failure inline with retry.
      const failSend = (reason: string): void => {
        setMessages((prev) => prev.filter((m) => m.turn !== turn));
        setSendFailed({ text, reason });
      };
      if (warm.length === 0) {
        // Typing IS the opt-in (§2.4): the first send warms the SELECTED agents —
        // the §6.2 chips (defaults + additions − removals). Also the retry path
        // after a rejected open (stale chip): the re-arm reuses the same chat id
        // with the corrected selection, so recovery is just "send again".
        warm = await armChat(selectedAgentsRef.current);
        if (warm.length === 0) {
          // armChat surfaced WHY (openError / failed chips); the user bubble
          // retracts and the draft survives — nothing was fanned out.
          setMessages((prev) => prev.filter((m) => m.turn !== turn));
          return;
        }
      }
      const id = chatIdRef.current;
      if (id === null) return; // repo switched under the send
      setMessages((prev) => [
        ...prev,
        ...warm.map((cliKey): SeatMsg => ({ kind: 'seat', cliKey, text: '', pending: true, ok: false, turn })),
      ]);
      // §7.9-4: the fan-out audience is WORKING until its reply lands.
      setSeats((prev) => ({
        ...prev,
        ...Object.fromEntries(warm.filter((k) => prev[k] !== 'failed').map((k) => [k, 'working' as SeatState])),
      }));
      try {
        await api.sendChatMessage(id, text);
        // Accepted — the draft leaves the composer only now (§7.9-2). A mid-flight
        // edit is the operator's newer draft and is left alone.
        setInput((cur) => (cur.trim() === text ? '' : cur));
      } catch (e: unknown) {
        failSend(e instanceof Error ? e.message : String(e));
        // The message never reached the daemon: this turn's audience is not
        // working on it. (A seat still streaming an OLDER turn re-corrects on
        // its next frame — replied/failed arrive from the wire.)
        setSeats((prev) => ({
          ...prev,
          ...Object.fromEntries(
            warm.filter((k) => prev[k] === 'working').map((k) => [k, 'ready' as SeatState]),
          ),
        }));
      }
    } finally {
      sendingRef.current = false;
    }
  }

  /**
   * The conversation→action bridge (§7.9): promote this chat into a BUILD with
   * the transcript as context. Rides the composer's existing prefill machinery
   * (the §4.3 retry store, consumed once at the launch form's mount) — a
   * prefill, never a hidden launch: the operator edits before send. No lineage
   * claim is invented (`retryOf: null` — chats are not runs).
   */
  function promoteToBuild(): void {
    if (navigate === undefined) return;
    const transcript = messages
      .filter((m) => m.kind === 'user' || !m.pending)
      .map((m) => (m.kind === 'user' ? `operator: ${m.text}` : `${m.cliKey}: ${m.text}`))
      .join('\n');
    const MAX = 6000; // keep the prefill a context, not a payload
    const clipped = transcript.length > MAX ? `…${transcript.slice(-MAX)}` : transcript;
    setRetryPrefill({
      retryOf: null,
      problem: `Continue from this chat — the transcript is context, the last ask is the intent:\n\n${clipped}`,
      clis: (() => {
        const warm = Object.entries(seats).filter(([, st]) => WARM_STATES.has(st)).map(([k]) => k);
        return warm.length > 0 ? warm : selectedAgentsRef.current;
      })(),
      workflowId: null,
      repoRef: repoId ?? null,
      entityMode: 'shared',
      humanConfirm: 'none',
      projectId: projectId ?? selectedProjectRef.current,
    });
    navigate('/runs/new');
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

  // §7.9-4 / EC44: every seat chip SAYS its state — connecting / ready /
  // working / replied / failed — and a failed seat carries its reason inline
  // (the daemon's open-time answer or the chatSessionFailed frame), truncated
  // in CSS with the full text on the title. No unlabeled "working" anywhere.
  const seatChip = (cliKey: string, st: SeatState): React.ReactElement => (
    // wk-disclose: the roster disclosure animates in at --dur-base ease-out
    // (§5.3 motion) — once per chip mount, never a loop (§1.6).
    <span
      key={cliKey}
      data-testid="seat-chip"
      data-agent={cliKey}
      data-state={st}
      title={st === 'failed' ? seatErrors[cliKey] : st}
      className="wk-disclose inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-mono"
      style={{ background: SEAT_CHIP.bg, color: SEAT_CHIP.fg, opacity: st === 'failed' ? 0.5 : 1 }}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${st === 'connecting' || st === 'working' ? 'animate-pulse' : ''}`}
        style={{ background: SEAT_DOT[st] }}
      />
      {cliKey}
      <span
        data-testid="seat-state"
        className="truncate"
        style={{ color: st === 'failed' ? 'var(--status-fail)' : 'var(--ink-dim)', maxWidth: '180px' }}
      >
        {st === 'failed' && seatErrors[cliKey] ? `failed — ${seatErrors[cliKey]}` : st}
      </span>
    </span>
  );

  // §6.2: the toggle is visible only when the chat has ≥2 distinct REPLYING
  // seats — a single-agent transcript has nothing to compare, and the toggle
  // would be dead chrome. Derived from the transcript, zero requests.
  const seatOrder = seatColumnOrder(messages);
  const showLayoutToggle = seatOrder.length >= 2;
  const rounds = layout === 'columns' ? groupRounds(messages) : [];

  // §6.4: the segmented pair in the mode-switcher grammar — active segment
  // --surface-raised + --ink-high, inactive --ink-muted.
  const layoutSegment = (value: ChatLayout, glyph: string, label: string): React.ReactElement => (
    <button
      key={value}
      type="button"
      data-testid={`chat-layout-${value}`}
      aria-pressed={layout === value}
      title={value === 'columns'
        ? 'Arrange each prompt’s agent replies side by side'
        : 'Show the transcript as one linear column'}
      // The composer must keep focus and its draft across a layout switch
      // (§6.5): preventDefault on mousedown stops the click from stealing focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => chooseLayout(value)}
      style={{
        background: layout === value ? 'var(--surface-raised)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        color: layout === value ? 'var(--ink-high)' : 'var(--ink-muted)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-2xs)',
        lineHeight: 1.6,
        padding: '1px 7px',
      }}
    >
      {glyph} {label}
    </button>
  );

  /** The list-mode bubbles, verbatim (§6.3: list mode is untouched); columns
   *  mode reuses the same bubble tokens with the avatar promoted to a header. */
  const userBubble = (m: UserMsg, key: React.Key): React.ReactElement => (
    // §5.3 token usage: user messages are transparent — the hairline
    // keeps the bubble shape without claiming a surface of its own.
    <div
      key={key}
      data-testid="user-bubble"
      data-turn={m.turn}
      className="self-end max-w-[70%] rounded-xl px-4 py-2 text-[13px]"
      style={{ background: 'transparent', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
    >
      {m.text}
    </div>
  );

  const bubbleBody = (m: SeatMsg): React.ReactElement => (
    <div
      // §5.3 token usage: agent bubbles sit on --surface-card; the
      // border speaks status while a reply is pending or failed.
      // §7.9-3: the bubble WEARS its seat+turn identity, so chunk routing
      // is assertable in the DOM (data-turn matches the causing send).
      data-testid="seat-bubble"
      data-agent={m.cliKey}
      data-turn={m.turn}
      data-pending={m.pending}
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
  );

  /** §6.2 column header: the seat chip in the existing chip dress — monogram
   *  avatar + cliKey, SEAT_CHIP tokens verbatim. */
  const columnHeader = (cliKey: string): React.ReactElement => (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-mono font-bold"
        style={{ background: SEAT_CHIP.bg, color: SEAT_CHIP.fg }}
      >
        {cliKey.slice(0, 2).toUpperCase()}
      </span>
      <span className="truncate text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>{cliKey}</span>
    </span>
  );

  const anyReady = Object.values(seats).some((st) => WARM_STATES.has(st));
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
    messages.length === 0 && Object.keys(seats).length === 0 && openError === null &&
    sendFailed === null && !resolving && !routedGone;
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
        {/* §6.2: the layout toggle sits right of the seat chips — a two-state
            segmented pair, present only with ≥2 distinct replying seats. */}
        {showLayoutToggle && (
          <div
            data-testid="chat-layout-toggle"
            data-layout={layout}
            role="group"
            aria-label="Transcript layout"
            className="inline-flex items-center gap-0.5 shrink-0"
            style={{
              border: '1px solid var(--surface-raised)',
              borderRadius: 'var(--radius-md)',
              padding: '1px',
            }}
          >
            {layoutSegment('list', '≡', 'list')}
            {layoutSegment('columns', '⫼', 'columns')}
          </div>
        )}
        <div className="flex-1" />
        {/* §7.9 conversation→action: visible once there is a transcript to carry. */}
        {messages.length > 0 && navigate !== undefined && !ended && (
          <button
            type="button"
            data-testid="chat-promote"
            title="Open the Build composer prefilled with this conversation as context — editable before launch"
            onClick={promoteToBuild}
            className="text-[11px] px-2.5 py-1 rounded-lg"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink-body)', border: '1px solid var(--surface-overlay)' }}
          >
            Continue in Build →
          </button>
        )}
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
        {/* J4/C6 — the honest boundary for a routed session that is gone: the
            daemon holds sessions only while they live, and transcripts are not
            persisted beyond that (the wire carries seats, never history). Say
            it; never render a wordless empty that reads as "nothing was said". */}
        {routedGone && chatId === null && (
          <div
            data-testid="chat-session-ended"
            className="rounded-xl px-4 py-3 text-[12px] font-mono"
            style={{ border: '1px dashed var(--surface-overlay)', color: 'var(--ink-muted)' }}
          >
            This chat session is no longer live on the daemon — it was ended or
            reclaimed. Transcripts aren’t stored beyond the live session, so
            there is nothing to replay here. Sending a message starts a new
            session (this page’s address will follow it).
          </div>
        )}
        {/* J4/C6 — the rejoin boundary: the warm session is back, but the wire
            keeps no transcript, so what was said before this page opened is
            not replayed. The agents still hold the conversation memory — the
            thread continues; only the client-side log starts here. */}
        {rejoined && (
          <div
            data-testid="chat-rejoined-note"
            className="rounded-xl px-4 py-3 text-[12px] font-mono"
            style={{ border: '1px dashed var(--surface-overlay)', color: 'var(--ink-muted)' }}
          >
            Rejoined the live session — its agents keep the conversation memory,
            but earlier messages aren’t stored on the wire, so they can’t be
            replayed here. New replies stream below.
          </div>
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
        {layout === 'columns' && showLayoutToggle
          ? // §6.2 columns mode: each round renders its user bubble (unchanged)
            // then a grid of the round's replies — one column per seat, order
            // stable across rounds (first-seen), an empty dimmed cell where a
            // seat did not answer this round (absence is information). The grid
            // scrolls horizontally INSIDE its round container past 3 columns —
            // the page never scrolls horizontally. No motion is added here, so
            // the arrangement is reduced-motion safe by construction.
            rounds.map((round, ri) => (
              <div key={ri} data-testid="chat-round" className="flex flex-col gap-3">
                {round.user !== null && userBubble(round.user, 'u')}
                <div
                  data-testid="chat-round-grid"
                  data-columns={seatOrder.length}
                  style={{
                    display: 'grid',
                    gap: '8px',
                    gridTemplateColumns: `repeat(${seatOrder.length}, minmax(260px, 1fr))`,
                    overflowX: 'auto',
                  }}
                >
                  {seatOrder.map((cliKey) => {
                    const reply = round.seats.find((s) => s.cliKey === cliKey);
                    return reply === undefined ? (
                      <div
                        key={cliKey}
                        data-testid="chat-cell-empty"
                        data-agent={cliKey}
                        className="flex flex-col gap-1.5 min-w-0"
                      >
                        {columnHeader(cliKey)}
                        <div
                          className="rounded-xl px-4 py-2 text-[13px] font-mono"
                          style={{ border: '1px dashed var(--surface-raised)', color: 'var(--ink-dim)' }}
                        >
                          —
                        </div>
                      </div>
                    ) : (
                      <div
                        key={cliKey}
                        data-testid="chat-cell"
                        data-agent={cliKey}
                        className="flex flex-col gap-1.5 min-w-0"
                      >
                        {columnHeader(cliKey)}
                        {bubbleBody(reply)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          : messages.map((m, i) =>
              m.kind === 'user' ? (
                userBubble(m, i)
              ) : (
                <div key={i} className="self-start max-w-[80%] flex gap-2">
                  <span
                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold mt-0.5"
                    style={{ background: SEAT_CHIP.bg, color: SEAT_CHIP.fg }}
                  >
                    {m.cliKey.slice(0, 2).toUpperCase()}
                  </span>
                  {bubbleBody(m)}
                </div>
              ),
            )}
        {/* §7.9-2: a failed send is a visible, retryable fact — the draft is
            still in the composer, nothing was fanned out, and Retry re-sends
            exactly what failed. Never a cleared composer, never silence. */}
        {sendFailed !== null && (
          <div
            data-testid="chat-send-failed"
            className="self-end max-w-[70%] rounded-xl px-4 py-2 text-[12px] font-mono flex items-center gap-3"
            style={{ border: '1px solid var(--status-fail-dim)', color: 'var(--ink-body)' }}
          >
            <span style={{ color: 'var(--status-fail)' }}>
              Send failed — {sendFailed.reason}. Your draft is still in the composer.
            </span>
            <button
              type="button"
              data-testid="chat-send-retry"
              onClick={() => void send(sendFailed.text)}
              className="shrink-0 px-2 py-0.5 rounded-lg"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)', border: '1px solid var(--surface-overlay)' }}
            >
              Retry
            </button>
          </div>
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
            // §7.9-1 honesty: where this seeding came from — the live roster
            // cache, or the cold-cache fallback trio (roster-first, fallback
            // only while nothing has fetched a roster this session).
            data-source={(getCachedRoster()?.length ?? 0) > 0 ? 'roster' : 'fallback'}
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
                  onClick={() => {
                    chipsTouchedRef.current = true; // §7.9-1: an edit pins the selection
                    setSelectedAgents((prev) => prev.filter((a) => a !== key));
                  }}
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
                            chipsTouchedRef.current = true; // §7.9-1: an edit pins the selection
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
