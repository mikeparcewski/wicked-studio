import type { SystemSnapshot } from '../api/system.js';
import { helperRuntimeDown } from './agentsCopy.js';
import { boundaryHolds, type AgentRow } from './agentsModel.js';

/** First use stays open until the live helper, skills, code map and runtime checks pass,
 * and there is somewhere to work. Only an explicit skip hides incomplete setup. */

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

export function setupSettled(s: SetupState, facts?: SetupFacts): boolean {
  // Landing decisions use the saved choice. The guide may reopen for a confirmed failure,
  // but an older service or a probe that did not answer cannot undo a completed setup.
  if (s.skippedAt !== undefined) return true;
  if (s.completedAt === undefined) return false;
  if (facts === undefined) return true;
  const checks = facts.checks;
  return checks?.skills !== false && checks?.estate !== false
    && !(checks?.runtimeRequired === true && checks.runtime === false);
}

export interface SetupChecks {
  skills: boolean | null;
  estate: boolean | null;
  runtime: boolean | null;
  runtimeRequired: boolean | null;
}

export const UNCHECKED_SETUP: SetupChecks = { skills: null, estate: null, runtime: null, runtimeRequired: null };

/** Reuse the Nerve Center's normalized probes, never their raw error prose. */
export function setupChecks(snapshot: SystemSnapshot | null, health?: unknown, diagnostics?: unknown): SetupChecks {
  const infra = snapshot?.infra ?? [];
  const state = (key: string): boolean | null => {
    const s = infra.find((r) => r.key === key)?.state;
    return s === undefined || s === 'unknown' ? null : s === 'ok';
  };
  const images = infra.find((r) => r.key === 'seat_images');
  // seat_images is explicitly off when helpers run on this computer. An answered image probe
  // (ok/degraded) reached the runtime; degraded can mean an image needs preparing, not a stopped runtime.
  const runtimeRequired = images === undefined || images.state === 'unknown' ? null : images.state !== 'off';
  const runtime = images === undefined || images.state === 'unknown' ? null
    : images.state === 'ok' || images.state === 'degraded';
  const h = health !== null && typeof health === 'object' ? health as Record<string, unknown> : {};
  const warnings = Array.isArray(h['warnings']) ? h['warnings'] : [];
  const skillsBlocked = warnings.some((w: unknown) => {
    if (w === null || typeof w !== 'object') return false;
    const b = w as Record<string, unknown>;
    return typeof b['kind'] === 'string' && b['kind'].startsWith('skills.') && b['severity'] === 'error';
  });
  const d = diagnostics !== null && typeof diagnostics === 'object' ? diagnostics as Record<string, unknown> : {};
  const skills = d['skills'] !== null && typeof d['skills'] === 'object' ? d['skills'] as Record<string, unknown> : {};
  const skillState = typeof skills['state'] === 'string' ? skills['state'] : null;
  const components = d['components'] !== null && typeof d['components'] === 'object' ? d['components'] as Record<string, unknown> : {};
  const binaries = components['engineBinaries'] !== null && typeof components['engineBinaries'] === 'object' ? components['engineBinaries'] as Record<string, unknown> : {};
  const estateVersion = binaries['wicked-estate'];
  // A missing binary is null in diagnostics. Newer services also name a missing installation
  // in the estate row; other down states can describe its data store and do not prove absence.
  const estateRow = infra.find((r) => r.key === 'estate');
  const estateMissing = estateRow?.state === 'down' && /isn.t installed|not installed/i.test(estateRow.reason ?? '');
  const estate = estateMissing || estateVersion === null ? false : typeof estateVersion === 'string' && estateVersion.trim() !== '' ? true : null;
  const skillsReady = skillState === null ? state('skills')
    : skillState !== 'published' ? false : skills['current'] === undefined ? null : skills['current'] !== null;
  return {
    skills: skillsBlocked || state('skills') === false ? false : skillsReady,
    estate, runtime, runtimeRequired,
  };
}

/**
 * The container runtime as the Helpers rows read it (first-run N3): a container helper whose check says the runtime
 * is stopped ("Docker isn't running") means it is down; a container helper whose sign-in check answered (signed in
 * or out) means it answered. The system snapshot's seat-image probe can time out on a loaded host and is read once,
 * so it only fills in when no row has said either. `downReason` is the rows' own sentence.
 */
export function withRowRuntime(checks: SetupChecks, rows: readonly AgentRow[]): SetupChecks & { downReason: string | null } {
  const container = rows.filter((r) => r.seat.sign_in === 'container');
  if (container.length === 0) return { ...checks, downReason: null };
  const down = container.map(helperRuntimeDown).find((m) => m !== null) ?? null;
  if (down !== null) return { ...checks, runtime: false, runtimeRequired: true, downReason: down };
  const answered = container.some((r) => r.seat.auth === 'signed_in' || r.seat.auth === 'signed_out');
  return { ...checks, runtime: answered ? true : checks.runtime, runtimeRequired: true, downReason: null };
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

export interface SetupFacts { rows: readonly AgentRow[]; repos: number; projects: number; checks?: SetupChecks }

export function goodEnough(f: SetupFacts): boolean {
  return setupAgents(f.rows).length >= 1 && (f.repos >= 1 || f.projects >= 1)
    && f.checks?.skills === true && f.checks.estate === true
    && (f.checks.runtimeRequired === false || f.checks.runtimeRequired === true && f.checks.runtime === true);
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
