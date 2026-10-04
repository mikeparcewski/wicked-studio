import type { RosterSeat, SessionView } from '../api/types.js';
import { mcpPath } from '../api/mcp.js';
import { skillsPath } from '../api/skills.js';
import { testingPath } from '../api/testing.js';
import type { NeedRow } from './needsYou.js';
import { DELIVERED_LINE, KEPT_LINE, keptLocally } from './deskWords.js';
import { sessionIdOf, sessionPath, summarize, type SessionState } from './sessionModel.js';

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
const RUN_KEY_PREFIXES = ['gate:', 'fail:', 'stall-esc:', 'stalled:', 'stranded:', 'elicit:', 'steer:'] as const;

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
  state: SessionState;
  /** Needs-you items that name any of its runs. */
  badge: number;
  line: string;
  /** `/s/:id` (S6a). */
  path: string;
}

export interface RailGroup {
  projectId: string | null;
  name: string;
  sessions: RailSession[];
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
    const kept = !deliveredJustNow && sum.state === 'done' && sum.badge === 0 && newestView !== undefined && keptLocally(newestView);
    return {
      id,
      runId,
      runIds: sum.runIds,
      title: sum.title,
      state: sum.state,
      badge: sum.badge,
      line: deliveredJustNow && sum.badge === 0 && sum.state === 'done' ? DELIVERED_LINE : kept ? KEPT_LINE : sessionLine(sum.state, sum.badge, texts[runId] ?? null),
      path: sessionPath(id),
    };
  });
}

/** The newest few — but never drop a session that needs you: its badge is part of the count. */
function capSessions(list: RailSession[], max: number): RailSession[] {
  const needy = list.filter((s) => s.badge > 0).length;
  return list.slice(0, Math.max(max, needy));
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
 * Empty groups are dropped — a project with nothing in it has no session to show.
 */
export function railGroups(
  projects: readonly { project: { id: string; name: string }; runs: readonly SessionView[] }[],
  unfiled: readonly SessionView[],
  badges: Record<string, number>,
  max: number = RAIL_SESSIONS_MAX,
  texts: Record<string, string> = {},
  runChatId = false,
  deliveredNow: ReadonlySet<string> = new Set(),
): RailGroup[] {
  const groups: RailGroup[] = projects.map((p) => ({
    projectId: p.project.id,
    name: p.project.name,
    sessions: capSessions(orderSessions(toSessions(p.runs, badges, texts, runChatId, deliveredNow)), max),
  }));
  groups.push({
    projectId: null,
    name: 'Not in a project',
    sessions: capSessions(orderSessions(toSessions(unfiled, badges, texts, runChatId, deliveredNow)), max),
  });
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
  /** The fallback address (Configuration); the Desk opens the sign-in panel in place instead. */
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
  return roster
    .filter(signInLapsed)
    .map((s) => {
      const name = s.display_name || s.key;
      return {
        key: `seat:${s.key}`,
        seat: s.key,
        rosterSeat: s,
        title: `An AI helper (${name}) needs signing in again`,
        line: 'No sign-in seen for it — work given to it may pause or move to another helper',
        action: { label: 'Sign in', path: '/system' },
      };
    });
}

// ── Start something, and where the rail reaches ──────────────────────────────

/** The Start row: each chip puts its first words in the composer; nothing is sent. */
export const START_CHIPS: readonly { label: string; seed: string }[] = [
  { label: 'Research', seed: 'Research ' },
  { label: 'Brainstorm', seed: 'Brainstorm ' },
  { label: 'Plan', seed: 'Plan ' },
  { label: 'Build', seed: 'Build ' },
  { label: 'Write a proposal', seed: 'Write a proposal for ' },
  { label: 'Make a demo', seed: 'Make a demo of ' },
  { label: 'Test', seed: 'Test ' },
  { label: 'Just ask', seed: '' },
];

/**
 * THE RAIL'S FIXED ENTRIES (DES-STUDIO-REBUILD-001 Amendment 5, as revised). Skills, MCP tools and
 * Steering sit in the rail itself — they change what in-flight work does, so they are one click
 * away; Steering is the Rules page (`/rules`, S12), the steering grid one link behind it.
 */
export const DESK_RAIL_LINKS: readonly { dest: string; label: string; path: string; testId: string }[] = [
  { dest: 'section:skills', label: 'Skills', path: skillsPath(), testId: 'desk-rail-skills' },
  { dest: 'section:mcp', label: 'MCP tools', path: mcpPath(), testId: 'desk-rail-mcp' },
  { dest: 'section:steering', label: 'Steering', path: '/rules', testId: 'desk-rail-steering' },
];

/**
 * "ADDITIONAL SETTINGS" (Amendment 5, as revised), in this order: Configuration (today's Settings),
 * Repositories, Workflows, Evals, Theme — plus the orders/away and freeze controls the rail renders
 * under them. Nothing that redirects is here; Testing (campaigns) is reached by ⌘K and from
 * Configuration.
 */
export const ADDITIONAL_SETTINGS: readonly { dest: string; label: string; path: string }[] = [
  { dest: 'settings:/system', label: 'Configuration', path: '/system' },
  { dest: 'section:repos', label: 'Repositories', path: '/repos' },
  { dest: 'settings:/workflows', label: 'Workflows', path: '/workflows' },
  { dest: 'section:testing', label: 'Evals', path: testingPath('evals') },
  { dest: 'settings:/theme', label: 'Theme', path: '/theme' },
];
