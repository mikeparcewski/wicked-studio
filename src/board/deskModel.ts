import type { RosterSeat, SessionView } from '../api/types.js';
import { mcpPath } from '../api/mcp.js';
import { skillsPath } from '../api/skills.js';
import type { NeedRow } from './needsYou.js';
import { DELIVERED_LINE, KEPT_LINE, jobTitle, jobTitleFull, keptLocally } from './deskWords.js';
import { PAGE_NAMES } from './pageNames.js';
import { agentFixPath } from '../hooks/useRoute.js';
import { foldReviewers } from './agentsModel.js';
import { sessionIdOf, sessionPath, sessionState as stateOfStatus, summarize, type SessionState } from './sessionModel.js';
import { statusWord, type StatusTone, type StatusWord } from './statusWords.js';
import { absTime, relTime } from './relTime.js';

/**
 * THE DESK's model (DES-STUDIO-REBUILD-001 §5.5, slice S4) — pure folds over what studio already
 * reads; the Desk components only render them.
 *
 *  - The count is the needs-you fold's (`useNeedsRows` → `needCount`): the Desk sentence, the Desk
 *    rail badge and the list all read it, so they can never disagree (§10). Chores are NOT in it.
 *  - A session is a chat and the runs launched from it, grouped by the runs' `chat_id` (C1) when
 *    the daemon says `capabilities.runChatId`; else one run, `run:<id>` (§7 "chat_id absent"). Its
 *    badge is the fold's items that name any of its runs (board/sessionModel.ts).
 *  - "For whoever runs studio" holds only what the wire carries: a seat whose sign-in lapsed
 *    (`GET /roster`). Disk pressure has no wire field, so no disk chore exists (§2 non-goals).
 */

// ── The greeting and the one sentence ────────────────────────────────────────

/**
 * What the Desk can say about its work, from the runs read alone (studio#459, #466):
 * `checking` before the first answer, `failed` when the first read failed (nothing to show),
 * `stale` when a later read failed (the last good list stays, said to be the last read), `known`
 * otherwise. A failed read is never an empty list.
 */
export type DeskReadState = 'checking' | 'failed' | 'stale' | 'known';
export function deskReadState(runsLoaded: boolean, runsError: string | null): DeskReadState {
  if (runsError !== null) return runsLoaded ? 'stale' : 'failed';
  return runsLoaded ? 'known' : 'checking';
}

export function deskGreeting(now: number): { hello: string; date: string } {
  const d = new Date(now);
  const h = d.getHours();
  const hello = h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return { hello, date };
}

/** "4 things need you." — the count is the fold's, in words. */
export function needsHeadline(count: number): string {
  if (count <= 0) return 'Nothing needs you.';
  return count === 1 ? '1 thing needs you.' : `${count} things need you.`;
}

// ── Needs per session ────────────────────────────────────────────────────────

/** The fold's row kinds whose key suffix is a run id (`needsYou.ts` keys). */
const RUN_KEY_PREFIXES = ['gate:', 'fail:', 'stall-esc:', 'stalled:', 'stranded:', 'orphaned:', 'elicit:', 'steer:'] as const;

/** The run a needs-you row is about, or null for a row that belongs to no run. */
export function needRunId(row: NeedRow): string | null {
  for (const p of RUN_KEY_PREFIXES) if (row.key.startsWith(p)) return row.key.slice(p.length) || null;
  return null;
}

function leaves(rows: readonly NeedRow[]): NeedRow[] {
  return rows.flatMap((r) => r.members ?? [r]);
}

/** Items per run — a group counts its members, exactly as `needCount` does. */
export function needsByRun(rows: readonly NeedRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of leaves(rows)) {
    const id = needRunId(r);
    if (id !== null) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** The first (highest-ranked) row's line per run — what a project card says is waiting. */
export function needTextByRun(rows: readonly NeedRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of leaves(rows)) {
    const id = needRunId(r);
    if (id !== null && out[id] === undefined) out[id] = r.question ?? r.text;
  }
  return out;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export { sessionState, type SessionState } from './sessionModel.js';

/** The card's sentence for a session. Never "checked": that word needs evidence (WT). A session
 *  with a needs-you item says that item's own line (it already says what is waiting), whatever
 *  the run's status — a live run can be asking a question, a finished one can be stranded. */
export function sessionLine(state: SessionState, badge: number, needText: string | null): string {
  if (badge > 0 && needText) return state === 'blocked' ? `Stopped: ${needText}` : needText;
  switch (state) {
    case 'waiting': return 'Waiting on you';
    case 'working': return 'Being worked on';
    case 'blocked': return 'Stopped';
    case 'done': return 'Finished';
    default: return 'Quiet';
  }
}

export interface RailSession {
  /** The session id (§5.2): the chat's id when the daemon stamps `chat_id` (C1), else `run:<id>`. */
  id: string;
  /** The run a needs-you item names (the first such), else the newest run. */
  runId: string;
  /** Every run of the session, oldest launch first. */
  runIds: string[];
  title: string;
  /** The title uncut, for the row's hover/focus title (the row clamps at two lines). */
  fullTitle?: string;
  state: SessionState;
  /** Needs-you items that name any of its runs. */
  badge: number;
  line: string;
  /** `/s/:id` (S6a). */
  path: string;
  /** The rail dot: the one status word and tone (`statusWord`) of the run that sets the session's
   *  state — the dot's hue and the row's label say the same thing (an answered ask at its turn gate
   *  is "Answered", tone ok, though its `state` stays `waiting`). */
  status: { word: StatusWord; tone: StatusTone };
  /** When the session last changed (its newest run's end, else its launch), ms; null when unknown. */
  at: number | null;
  /** When its first run launched, ms; null when no run says. Orders the "#n" tags. */
  launchedAt: number | null;
  /** Set only when another session in the same group has the same title: the short words that tell
   *  them apart ("29d", else "14:04", else "#2"; `disambiguate`). */
  tag: string | null;
}

export interface RailGroup {
  projectId: string | null;
  name: string;
  /** The rail's first few (`max`): needs-you and live work first. */
  sessions: RailSession[];
  /** The rest, in the same order — the rail's "Show N more". Empty when `max` is Infinity. */
  more: RailSession[];
}

// Live work before old failures: a failure that still needs you already sorts first by its badge.
const STATE_ORDER: Record<SessionState, number> = { waiting: 0, working: 1, blocked: 2, done: 3, quiet: 4 };

/** Sessions per rail group — the newest few, the ones that need you first. */
export const RAIL_SESSIONS_MAX = 5;

/**
 * The sessions of one group's runs: runs that share a chat are one session when the daemon says
 * `capabilities.runChatId` (C1); otherwise each run is its own. Ordered by the group's run order
 * (the newest run of a session places it).
 */
function toSessions(
  runs: readonly SessionView[],
  badges: Record<string, number>,
  texts: Record<string, string>,
  runChatId: boolean,
  deliveredNow: ReadonlySet<string> = new Set(),
): RailSession[] {
  const order: string[] = [];
  const byId = new Map<string, SessionView[]>();
  for (const v of runs) {
    const id = sessionIdOf(v, runChatId);
    const list = byId.get(id);
    if (list === undefined) { byId.set(id, [v]); order.push(id); } else list.push(v);
  }
  return order.map((id) => {
    const sum = summarize(id, byId.get(id)!, badges);
    const needy = sum.runIds.find((r) => (badges[r] ?? 0) > 0);
    const newest = sum.runIds[sum.runIds.length - 1]!;
    const runId = needy ?? newest;
    const views = byId.get(id)!;
    const newestView = views.find((v) => v.session.id === newest);
    // A post-hoc delivery that just landed (this session's store) is delivered, even before the run
    // list catches up: no lifecycle frame follows it, so the DTO can say `stranded` until a reload.
    const deliveredJustNow = deliveredNow.has(newest);
    // The dot's word: the newest run whose own state is the session's (live work first, as `summarize`).
    // A run that really waits on you outranks an answered ask parked at its turn gate.
    const matching = [...views].reverse().filter((v) => stateOfStatus(v.session.status) === sum.state);
    const setter = matching.find((v) => statusWord(v).word !== 'Answered') ?? matching[0] ?? newestView ?? views[0]!;
    const kept = !deliveredJustNow && sum.state === 'done' && sum.badge === 0 && newestView !== undefined && keptLocally(newestView);
    return {
      id,
      runId,
      runIds: sum.runIds,
      title: sum.title,
      fullTitle: (() => {
        const v = views.find((x) => jobTitle(x.session) === sum.title);
        return v === undefined ? sum.title : jobTitleFull(v.session);
      })(),
      state: sum.state,
      badge: sum.badge,
      line: deliveredJustNow && sum.badge === 0 && sum.state === 'done' ? DELIVERED_LINE : kept ? KEPT_LINE : sessionLine(sum.state, sum.badge, texts[runId] ?? null),
      // S15e: a gated waiting session links directly to the gate so a click from the Desk lands
      // inside the thread at the answerable row (operator amendment 1 / needsYou.ts pattern).
      path: needy !== undefined && sum.state === 'waiting' ? sessionPath(id) + '#gate' : sessionPath(id),
      status: statusWord(setter),
      at: sum.lastChangeAt > 0 ? sum.lastChangeAt : null,
      launchedAt: firstLaunchMs(views),
      tag: null,
    };
  });
}

/** "1 thing needs you", "2 things need you" — the words behind a rail count. */
export function needsYouWords(n: number): string {
  return n === 1 ? '1 thing needs you' : `${n} things need you`;
}

/**
 * What a rail row says beyond its visible words: the hover `title` (one fact per line, the time also
 * absolute) and the link's accessible label (the same facts, comma-joined). The full title with its tag (the label
 * replaces the visible words, so a twin's tag must be in it), then the status word and
 * when, then how many things need you, then the session's own line when it says more than the word
 * ("Delivered", a question, "Stopped: …").
 */
export function railRowWords(s: RailSession, now: number): { title: string; label: string } {
  const generic = new Set<string>([sessionLine(s.state, 0, null), s.status.word]);
  const when = s.at !== null ? `${s.status.word} · ${relTime(s.at, now)}` : s.status.word;
  const name = s.fullTitle ?? s.title;
  const facts = [s.tag !== null ? `${name} · ${s.tag}` : name, when, s.badge > 0 ? needsYouWords(s.badge) : null, generic.has(s.line) ? null : s.line]
    .filter((x): x is string => x !== null && x !== '');
  // The hover title also says the exact time (UI-CONTRACT: relative words, the absolute time in `title`).
  const title = s.at !== null ? [facts[0], `${when} (${absTime(s.at)})`, ...facts.slice(2)] : facts;
  return { title: title.join('\n'), label: facts.join(', ') };
}

// ── Telling same-named sessions apart ───────────────────────────────────────

/** "now", "5m", "3h", "29d", "4mo", "2y" — the rail's short age. */
export function shortAge(at: number, now: number): string {
  const secs = Math.floor((now - at) / 1000);
  if (!Number.isFinite(secs) || secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** "14:04" — the 24-hour local clock: five characters, no am/pm to crowd the title. */
export function shortClock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const titleKey = (s: RailSession): string => s.title.trim().toLowerCase();

/**
 * Sessions in one group that share a title get a short tag (the operator's "· 2d"): each one's short
 * age when that tells every one of the set apart, else its 24-hour clock time ("14:04", for same-day
 * twins), else its place in launch order ("#1" the oldest) — one rule per set, never a mix, and
 * always short, so the title keeps the row. Sessions with a unique
 * title get no tag; the hover title carries the full time. Pure: `now` is the caller's clock.
 */
export function disambiguate(list: readonly RailSession[], now: number): RailSession[] {
  const sets = new Map<string, RailSession[]>();
  for (const s of list) {
    const k = titleKey(s);
    const set = sets.get(k);
    if (set === undefined) sets.set(k, [s]); else set.push(s);
  }
  const tags = new Map<RailSession, string>();
  for (const set of sets.values()) {
    if (set.length < 2) continue;
    const known = set.every((s) => s.at !== null);
    const distinct = (f: (s: RailSession) => string): boolean => new Set(set.map(f)).size === set.length;
    const age = (s: RailSession): string => shortAge(s.at!, now);
    const clock = (s: RailSession): string => shortClock(s.at!);
    const rule = known && distinct(age) ? age : known && distinct(clock) ? clock : null;
    if (rule !== null) { for (const s of set) tags.set(s, rule(s)); continue; }
    // Launch order: the first launched is #1; an unknown launch sorts first, ties by the list's own order
    // reversed (the list is newest first).
    const order = set.map((s, i) => ({ s, i })).sort((a, b) => (a.s.launchedAt ?? 0) - (b.s.launchedAt ?? 0) || b.i - a.i);
    order.forEach(({ s }, n) => tags.set(s, `#${n + 1}`));
  }
  return list.map((s) => (tags.has(s) ? { ...s, tag: tags.get(s)! } : s));
}

/** The first launch among a session's runs (unix seconds on the wire), ms; null when none says. */
function firstLaunchMs(views: readonly SessionView[]): number | null {
  const at = views
    .map((v) => (v.session as unknown as { created_at?: unknown }).created_at)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0);
  return at.length === 0 ? null : Math.min(...at) * 1000;
}

/** The newest few — but never drop a session that needs you: its badge is part of the count. The rest
 *  go to `more` (the rail's "Show N more"). */
function capSessions(list: RailSession[], max: number): { sessions: RailSession[]; more: RailSession[] } {
  const needy = list.filter((s) => s.badge > 0).length;
  const n = Math.max(max, needy);
  return { sessions: list.slice(0, n), more: list.slice(n) };
}

function orderSessions(list: RailSession[]): RailSession[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) =>
      (b.s.badge > 0 ? 1 : 0) - (a.s.badge > 0 ? 1 : 0)
      || STATE_ORDER[a.s.state] - STATE_ORDER[b.s.state]
      || a.i - b.i)
    .map((x) => x.s);
}

/**
 * The rail: one group per project (the board model's order), then the runs in no project.
 * Empty groups are dropped — a project with nothing in it has no session to show. Same-named
 * sessions in a group carry a `tag` (`disambiguate`); each group keeps its first `max` in
 * `sessions` (never dropping one that needs you) and the rest in `more`.
 */
export function railGroups(
  projects: readonly { project: { id: string; name: string }; runs: readonly SessionView[] }[],
  unfiled: readonly SessionView[],
  badges: Record<string, number>,
  max: number = RAIL_SESSIONS_MAX,
  texts: Record<string, string> = {},
  runChatId = false,
  deliveredNow: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
): RailGroup[] {
  // Tags are decided over the whole group, so "Show N more" never changes a shown row's tag.
  const sessionsOf = (runs: readonly SessionView[]) =>
    capSessions(disambiguate(orderSessions(toSessions(runs, badges, texts, runChatId, deliveredNow)), now), max);
  const groups: RailGroup[] = projects.map((p) => ({ projectId: p.project.id, name: p.project.name, ...sessionsOf(p.runs) }));
  groups.push({ projectId: null, name: 'Not in a project', ...sessionsOf(unfiled) });
  return groups.filter((g) => g.sessions.length > 0);
}

export interface DeskProject {
  projectId: string | null;
  name: string;
  /** The sessions the card shows, each a sentence. */
  shown: RailSession[];
  /** The rest, by name — one line ("and 2 more"), never rows. */
  quiet: string[];
}

/** "Your projects": each card shows its first few sessions; the rest fold into one line. */
export function deskProjects(groups: readonly RailGroup[], perCard = 2): DeskProject[] {
  return groups.map((g) => ({
    projectId: g.projectId,
    name: g.name,
    shown: g.sessions.slice(0, perCard),
    quiet: g.sessions.slice(perCard).map((s) => s.title),
  }));
}

// ── Chores for whoever runs studio ───────────────────────────────────────────

export interface DeskChore {
  key: string;
  seat: string;
  /** The roster row itself — the sign-in panel reads its `login_invocation`. */
  rosterSeat: RosterSeat;
  title: string;
  line: string;
  /** The fallback address (`/agents?fix=<key>`); the Desk opens the agent's modal in place instead. */
  action: { label: string; path: string };
}

/** The roster reads this seat's sign-in as lapsed: `auth: signed_out` (crew#533), or, from a daemon
 *  that predates `auth`, `signed_in: false`. Whether it is also benched does not matter here. */
export function signInLapsed(seat: RosterSeat): boolean {
  const auth = (seat as Record<string, unknown>)['auth'];
  if (typeof auth === 'string') return auth === 'signed_out';
  return seat.signed_in === false;
}

/**
 * A FIRST-RUN DESK WITH NO SIGNED-IN HELPER leads with the sign-in (Amendment 5, decision 5): the
 * roster is known and not one seat is usable — every seat's sign-in has lapsed, or the roster is
 * empty. `null` roster (not read yet, or unreadable) → false: never a guessed first run.
 */
export function noSignedInHelper(roster: readonly RosterSeat[] | null): boolean {
  if (roster === null) return false;
  return roster.every(signInLapsed);
}

/** A seat whose sign-in lapsed is the one chore the wire can state today. */
export function lapsedSeatChores(roster: readonly RosterSeat[] | null): DeskChore[] {
  if (roster === null) return [];
  // One chore per agent: a reviewer-only seat named like an agent folds into it (#735), so the
  // Desk never asks to sign "Claude Code (judge)" in beside Claude Code.
  return foldReviewers(roster)
    .map((f) => f.seat)
    .filter(signInLapsed)
    .map((s) => {
      const name = s.display_name || s.key;
      return {
        key: `seat:${s.key}`,
        seat: s.key,
        rosterSeat: s,
        title: `An AI agent (${name}) needs signing in again`,
        line: 'No sign-in seen for it — work given to it may pause or move to another agent',
        action: { label: 'Sign in', path: agentFixPath(s.key) },
      };
    });
}

// ── Where the rail reaches ───────────────────────────────────────────────────

/**
 * THE RAIL'S WORKSPACE GROUP (operator IA 2026-10-13), top to bottom, after the Watchtower pill that
 * heads it: Skills · MCP · Plugins, then the pages the retired "General settings" overview listed —
 * Workflows · Theme · General (the `/system` page, renamed from Configuration). Health sits apart at the
 * foot. Repositories, Steering, Evals and Agents are not rail links: they are Desk tabs, and ⌘K still
 * goes to each. Navigation only: the orders/away and delivery-freeze controls are the Desk's.
 */
export const DESK_RAIL_LINKS: readonly { dest: string; label: string; path: string; testId: string }[] = [
  { dest: 'section:skills', label: PAGE_NAMES.skills, path: skillsPath(), testId: 'desk-rail-skills' },
  { dest: 'section:mcp', label: PAGE_NAMES.mcp, path: mcpPath(), testId: 'desk-rail-mcp' },
  { dest: 'section:plugins', label: PAGE_NAMES.plugins, path: '/plugins', testId: 'desk-rail-plugins' },
  { dest: 'section:workflows', label: PAGE_NAMES.workflows, path: '/workflows', testId: 'desk-rail-workflows' },
  { dest: 'section:theme', label: PAGE_NAMES.theme, path: '/theme', testId: 'desk-rail-theme' },
  { dest: 'section:general', label: PAGE_NAMES.system, path: '/system', testId: 'desk-rail-general' },
];

/**
 * The Desk's "work moved" fingerprint for its cumulative reads (quality, record, spend): every run's
 * own status plus how many of its units are done or rejected, so a run that fails, is cancelled or
 * resumes — with no unit finishing — still invalidates them. A unit merely being handed out does not.
 * Order-stable by run id.
 */
export function workFingerprint(runs: readonly SessionView[]): string {
  return runs
    .map((v) => {
      const units = v.units ?? [];
      const n = (s: 'done' | 'rejected'): number => units.filter((u) => u.status === s).length;
      return `${v.session.id}:${v.session.status}:${n('done')}:${n('rejected')}`;
    })
    .sort()
    .join('|');
}
