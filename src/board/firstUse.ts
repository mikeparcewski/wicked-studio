import { boundaryHolds, type AgentRow } from './agentsModel.js';

/**
 * FIRST USE (DES-seats-page §5): studio opens on the Agents tab's setup steps until the computer is
 * "good enough" — at least one agent ready for new work in a repository, and a repository or a
 * project — and then on the Desk for good (sticky, Q2: a later sign-out never hijacks the landing).
 * Pure; `useFirstUse` feeds it the reads and persists `studio.setup`.
 */

/** `settings['studio.setup']` — a studio-owned key the daemon stores as-is. */
export interface SetupState { completedAt?: number; skippedAt?: number }

export const SETUP_KEY = 'studio.setup';

export function readSetup(settings: Record<string, unknown> | null | undefined): SetupState {
  const v = settings?.[SETUP_KEY];
  if (v === null || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  return {
    ...(typeof o['completedAt'] === 'number' ? { completedAt: o['completedAt'] } : {}),
    ...(typeof o['skippedAt'] === 'number' ? { skippedAt: o['skippedAt'] } : {}),
  };
}

export function setupSettled(s: SetupState): boolean {
  return s.completedAt !== undefined || s.skippedAt !== undefined;
}

/**
 * The agents that count for setup (§5.1 `usableAgents`): picked for new work, not opt-in, signed in
 * or needing no sign-in, not on an active bench, given repository work (crew's `work_admission`
 * when sent, else studio's codex constant), and with a safety claim that holds for repository work.
 * Reviews are a separate capability, so `council_eligible` alone never decides it.
 */
export function setupAgents(rows: readonly AgentRow[]): AgentRow[] {
  return rows.filter((r) => r.picked && !r.optIn && r.usable && r.repoWork && boundaryHolds(r.seat, 'scoped_bound'));
}

/** Projects that count: the synthesized "Unfiled" default (`id: 'default'`) never does. */
export function realProjects(projects: readonly { id: string }[]): number {
  return projects.filter((p) => p.id !== 'default').length;
}

export interface SetupFacts { rows: readonly AgentRow[]; repos: number; projects: number }

export function goodEnough(f: SetupFacts): boolean {
  return setupAgents(f.rows).length >= 1 && (f.repos >= 1 || f.projects >= 1);
}

/** One setup step's state, read from the same predicates as the completion rule (§5.1). */
export interface SetupSteps {
  ready: number;
  total: number;
  agentsDone: boolean;
  placeDone: boolean;
  repos: number;
  projects: number;
}

export function setupSteps(f: SetupFacts): SetupSteps {
  const ready = setupAgents(f.rows).length;
  return { ready, total: f.rows.length, agentsDone: ready >= 1, placeDone: f.repos >= 1 || f.projects >= 1, repos: f.repos, projects: f.projects };
}

/** The one move step 1 offers for an agent, from its top issue (§5.2). `null` = it already counts. */
export function setupMove(r: AgentRow, counted: readonly AgentRow[]): { kind: 'sign-in' | 'fix' | 'use'; label: string } | null {
  if (counted.some((c) => c.key === r.key)) return null;
  if (r.optIn) return null;
  // The top issue decides (issues are sorted): a sign-in offered first only when signing in is the next move (codex #759 r1).
  if (r.issues[0]?.code === 'signed_out') return { kind: 'sign-in', label: `Sign in ${r.name}` };
  if (!r.picked && r.usable && r.issues.every((i) => i.severity === 'note')) return { kind: 'use', label: `Use ${r.name} for new work` };
  return { kind: 'fix', label: `Fix ${r.name}` };
}
