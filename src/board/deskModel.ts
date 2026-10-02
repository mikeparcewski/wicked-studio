import type { RosterSeat, SessionView } from '../api/types.js';
import { mcpPath } from '../api/mcp.js';
import { skillsPath } from '../api/skills.js';
import { steeringDashboardPath } from '../api/steering.js';
import { testingPath } from '../api/testing.js';
import { humanTitle } from '../components/runIdentity.js';
import type { NeedRow } from './needsYou.js';

/**
 * THE DESK's model (DES-STUDIO-REBUILD-001 §5.5, slice S4) — pure folds over what studio already
 * reads; the Desk components only render them.
 *
 *  - The count is the needs-you fold's (`useNeedsRows` → `needCount`): the Desk sentence, the Desk
 *    rail badge and the list all read it, so they can never disagree (§10). Chores are NOT in it.
 *  - A session, until crew stamps `chat_id` on runs (C1, `capabilities.runChatId`), is one run:
 *    `run:<id>` (§7 "chat_id absent"). Its badge is the fold's items that name that run.
 *  - "For whoever runs studio" holds only what the wire carries: a seat whose sign-in lapsed
 *    (`GET /roster`). Disk pressure has no wire field, so no disk chore exists (§2 non-goals).
 */

// ── The greeting and the one sentence ────────────────────────────────────────

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
    if (id !== null && out[id] === undefined) out[id] = r.text;
  }
  return out;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export type SessionState = 'working' | 'waiting' | 'blocked' | 'done' | 'quiet';

export function sessionState(status: string): SessionState {
  switch (status) {
    case 'awaiting_human': return 'waiting';
    case 'failed': return 'blocked';
    case 'completed': return 'done';
    case 'cancelled': return 'quiet';
    default: return 'working';
  }
}

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
  /** `run:<id>` — a run with no chat is its own session (§5.2). */
  id: string;
  runId: string;
  title: string;
  state: SessionState;
  /** Needs-you items that name this run. */
  badge: number;
  line: string;
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

function toSession(v: SessionView, badges: Record<string, number>, texts: Record<string, string>): RailSession {
  const id = v.session.id;
  const state = sessionState(v.session.status);
  const badge = badges[id] ?? 0;
  return {
    id: `run:${id}`,
    runId: id,
    title: humanTitle(v.session.problem || id),
    state,
    badge,
    line: sessionLine(state, badge, texts[id] ?? null),
    path: `/runs/${encodeURIComponent(id)}`,
  };
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
): RailGroup[] {
  const groups: RailGroup[] = projects.map((p) => ({
    projectId: p.project.id,
    name: p.project.name,
    sessions: capSessions(orderSessions(p.runs.map((v) => toSession(v, badges, texts))), max),
  }));
  groups.push({
    projectId: null,
    name: 'Not in a project',
    sessions: capSessions(orderSessions(unfiled.map((v) => toSession(v, badges, texts))), max),
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
  title: string;
  line: string;
  action: { label: string; path: string };
}

/** The roster reads this seat's sign-in as lapsed: `auth: signed_out` (crew#533), or, from a daemon
 *  that predates `auth`, `signed_in: false`. Whether it is also benched does not matter here. */
export function signInLapsed(seat: RosterSeat): boolean {
  const auth = (seat as Record<string, unknown>)['auth'];
  if (typeof auth === 'string') return auth === 'signed_out';
  return seat.signed_in === false;
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
 * Every destination the other skins' nav reaches (the skin contract: every route reachable under
 * every skin, by its nav or ⌘K). The Desk rail lists them under "Everything else"; the old pages
 * keep rendering until the flip (S15b).
 */
export const DESK_DESTINATIONS: readonly { dest: string; label: string; path: string }[] = [
  { dest: 'section:projects', label: 'Projects', path: '/projects' },
  { dest: 'section:execute', label: 'Execute', path: '/execute' },
  { dest: 'section:test', label: 'Test', path: testingPath('campaigns') },
  { dest: 'section:vibe', label: 'Vibe', path: '/vibe' },
  { dest: 'section:demo', label: 'Demo', path: '/demo' },
  { dest: 'section:chat', label: 'Chats', path: '/chats' },
  { dest: 'section:repos', label: 'Repositories', path: '/repos' },
  { dest: 'section:skills', label: 'Skills', path: skillsPath() },
  { dest: 'section:mcp', label: 'MCP tools', path: mcpPath() },
  { dest: 'section:steering', label: 'Rules (steering)', path: steeringDashboardPath() },
  { dest: 'section:testing', label: 'Evals', path: testingPath('evals') },
  { dest: 'settings:/theme', label: 'Theme', path: '/theme' },
  { dest: 'settings:/workflows', label: 'Workflows', path: '/workflows' },
  { dest: 'settings:/system', label: 'Settings', path: '/system' },
];
